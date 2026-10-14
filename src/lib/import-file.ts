// Read an import file (CSV or Excel .xlsx) into row objects keyed by the
// app's canonical column names. Headers are matched loosely so the app's
// own exports (English or Arabic headers), the snake_case import format and
// hand-made spreadsheets with small spelling differences all work.

import { strFromU8, unzipSync } from "fflate"
import { cleanCell, parseCsv } from "./csv"

// Loose form of a header/value for matching: lowercase, Arabic letter
// variants unified (أإآ→ا, ى→ي, ة→ه), diacritics/tatweel removed, any
// "(EGP)"-style suffix dropped, separators collapsed.
export function looseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[_\-.:#/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export type HeaderAliases = Record<string, string[]>

export const APARTMENT_HEADERS: HeaderAliases = {
  unit_number: ["unit_number", "unit", "unit no", "apartment", "apt", "الوحدة", "رقم الوحدة", "الشقة", "رقم الشقة", "شقة"],
  building_no: ["building_no", "building", "building number", "المبنى", "رقم المبنى", "العمارة"],
  floor: ["floor", "الطابق", "الدور"],
  primary_resident_name: ["primary_resident_name", "primary resident name", "resident", "resident name", "name", "owner", "اسم الساكن الرئيسي", "الساكن الرئيسي", "الساكن", "الاسم", "المالك"],
  secondary_resident_name: ["secondary_resident_name", "second inhabitant", "secondary resident", "second resident", "الساكن الثاني"],
  phone: ["phone", "phone 1", "phone1", "mobile", "هاتف 1", "الهاتف", "هاتف", "الموبايل", "رقم الهاتف"],
  phone2: ["phone2", "phone 2", "هاتف 2", "الهاتف 2"],
  email: ["email", "e mail", "البريد الإلكتروني", "البريد", "الايميل"],
  monthly_due_amount: ["monthly_due_amount", "monthly due", "monthly due amount", "due", "الاستحقاق الشهري", "الاستحقاق", "القيمة الشهرية"],
  occupancy_status: ["occupancy_status", "residency status", "status", "حالة الإقامة", "الحالة"],
  notes: ["notes", "note", "الملاحظات", "ملاحظات"],
}

export const PAYMENT_HEADERS: HeaderAliases = {
  unit_number: ["unit_number", "unit", "apartment", "الوحدة", "رقم الوحدة", "الشقة"],
  payer_name: ["payer_name", "payer", "الدافع"],
  payer_relation: ["payer_relation", "relation", "صلة القرابة"],
  amount: ["amount", "المبلغ"],
  method: ["method", "طريقة الدفع"],
  date_paid: ["date_paid", "date paid", "date", "تاريخ التحصيل", "التاريخ"],
  first_month: ["first_month", "from month", "من شهر"],
  last_month: ["last_month", "to month", "إلى شهر"],
  period_start: ["period_start"],
  period_end: ["period_end"],
  recurring: ["recurring"],
  extra: ["extra"],
  on_dashboard: ["on_dashboard"],
  notes: ["notes", "الملاحظات", "ملاحظات"],
}

export const EXPENSE_HEADERS: HeaderAliases = {
  date: ["date", "التاريخ"],
  category: ["category", "الفئة"],
  subcategory: ["subcategory", "الفئة الفرعية"],
  vendor: ["vendor", "المورّد", "المورد"],
  amount: ["amount", "المبلغ"],
  method: ["method", "طريقة الدفع"],
  paid: ["paid", "status", "الحالة"],
  recurring: ["recurring"],
  recurring_interval: ["recurring_interval"],
  notes: ["notes", "الملاحظات", "ملاحظات"],
}

function headerMap(headers: string[], aliases: HeaderAliases): (string | null)[] {
  const lookup = new Map<string, string>()
  for (const [key, names] of Object.entries(aliases)) {
    for (const n of [key, ...names]) {
      const k = looseKey(n)
      if (!lookup.has(k)) lookup.set(k, key)
    }
  }
  const used = new Set<string>()
  return headers.map((h) => {
    const key = lookup.get(looseKey(h)) ?? null
    if (!key || used.has(key)) return null
    used.add(key)
    return key
  })
}

// Turn a table (rows of cells) into objects. The header row is the first
// row (within the first 10) where at least two columns are recognised, so a
// title line above the headers doesn't break the import.
export function tableToObjects(table: string[][], aliases: HeaderAliases): Record<string, string>[] {
  let headerRow = 0
  let mapping: (string | null)[] = []
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const m = headerMap(table[i], aliases)
    if (m.filter(Boolean).length >= 2) {
      headerRow = i
      mapping = m
      break
    }
  }
  if (!mapping.length) return []
  const out: Record<string, string>[] = []
  for (const row of table.slice(headerRow + 1)) {
    if (!row.some((c) => cleanCell(c ?? "") !== "")) continue
    const obj: Record<string, string> = {}
    mapping.forEach((key, i) => {
      if (key) obj[key] = cleanCell(row[i] ?? "")
    })
    out.push(obj)
  }
  return out
}

// ── xlsx reading ──

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
}

// Text of all <t> runs inside a fragment (handles rich text)
function textRuns(xml: string): string {
  let s = ""
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1]
  return decodeXml(s)
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase()
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// Format a numeric cell: whole numbers without ".0"; floating noise trimmed
function numberText(v: string): string {
  const n = Number(v)
  if (!isFinite(n)) return v
  return String(Math.round(n * 1e9) / 1e9)
}

// Built-in Excel number formats that are dates
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57])

function excelSerialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  return new Date(ms).toISOString().slice(0, 10)
}

export function parseXlsx(data: Uint8Array): string[][] {
  const files = unzipSync(data, {
    filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") || f.name.endsWith(".rels"),
  })
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : "")

  // first sheet in workbook order
  const workbook = read("xl/workbook.xml")
  const rels = read("xl/_rels/workbook.xml.rels")
  let sheetPath = ""
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)
  if (firstSheet) {
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstSheet[1]}"[^>]*>`))
    const target = rel?.[0].match(/Target="([^"]+)"/)?.[1]
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`
  }
  if (!files[sheetPath]) sheetPath = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0] ?? ""
  const sheet = read(sheetPath)
  if (!sheet) return []

  const shared: string[] = []
  for (const m of read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]))

  // which cell styles are dates
  const styles = read("xl/styles.xml")
  const customDateFmts = new Set<number>()
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const code = decodeXml(m[2]).replace(/"[^"]*"|\[[^\]]*\]/g, "")
    if (/[dy]/i.test(code)) customDateFmts.add(parseInt(m[1], 10))
  }
  const dateStyles: boolean[] = []
  const xfs = styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? ""
  for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = parseInt(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? "0", 10)
    dateStyles.push(DATE_FMT_IDS.has(id) || customDateFmts.has(id))
  }

  const rows: string[][] = []
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []
    let next = 0
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]
      const body = cm[2] ?? ""
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      const col = ref ? colIndex(ref) : next
      next = col + 1
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "n"
      const style = parseInt(attrs.match(/\bs="(\d+)"/)?.[1] ?? "0", 10)
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let text = ""
      if (type === "s") text = shared[parseInt(v ?? "-1", 10)] ?? ""
      else if (type === "inlineStr") text = textRuns(body)
      else if (type === "str" || type === "e") text = decodeXml(v ?? "")
      else if (type === "b") text = v === "1" ? "TRUE" : "FALSE"
      else if (v !== undefined) {
        text = dateStyles[style] && isFinite(Number(v)) ? excelSerialToDate(Number(v)) : numberText(v)
      }
      while (row.length < col) row.push("")
      row[col] = text
    }
    // the <row r="n"> index may skip empty rows; empty rows are dropped anyway
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
}

function isXlsx(bytes: Uint8Array): boolean {
  // zip signature "PK\x03\x04"
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

// Read a CSV or .xlsx file chosen by the user into canonical row objects.
// Throws a user-facing Error for unsupported files (e.g. old .xls).
export async function readImportFile(file: File, aliases: HeaderAliases): Promise<Record<string, string>[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let table: string[][]
  if (isXlsx(bytes)) {
    table = parseXlsx(bytes)
  } else if (/\.xls$/i.test(file.name) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    throw new Error("old-xls")
  } else {
    let text = new TextDecoder("utf-8").decode(bytes)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    // Arabic Excel sometimes saves CSV with ";" or tab separators
    const first = text.split(/\r?\n/, 1)[0] ?? ""
    const sep = [";", "\t"].find((s) => first.split(s).length > first.split(",").length)
    table = sep ? text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep)) : parseCsv(text)
  }
  return tableToObjects(table, aliases)
}

export const IMPORT_ACCEPT =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// Normalise a floor cell like "الطابق 3", "Floor 3", "الدور M" or "M" to
// the app's floor labels ("3", "M1"). Returns "" when nothing usable.
export function normalizeFloorCell(value: string): string {
  const v = value
    .replace(/الطابق|الطالق|الدور|طابق|دور|floor|mezzanine|ميزانين/gi, " ")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim()
  if (!v) return ""
  if (/^m$/i.test(v)) return "M1"
  if (/^m\s*\d+$/i.test(v)) return "M" + v.replace(/\D/g, "")
  if (/^\d+$/.test(v)) return String(parseInt(v, 10))
  return v
}

// Excel drops the leading 0 of Egyptian mobile numbers stored as numbers
export function normalizePhoneCell(value: string): string {
  const v = value.trim()
  return /^1\d{9}$/.test(v) ? "0" + v : v
}

// Arabic/English payment method text → method
export function normalizeMethodCell(value: string): "cash" | "bank" {
  const v = looseKey(value)
  return v === "bank" || v.includes("بنك") || v.includes("تحويل") || v === "b" ? "bank" : "cash"
}
