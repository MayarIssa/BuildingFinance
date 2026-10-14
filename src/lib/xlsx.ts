// Minimal .xlsx writer: an xlsx file is a zip of a few XML parts. This
// covers what the app's exports need — several sheets, a bold header row
// that stays frozen, auto-sized columns, real numbers (right-aligned,
// thousands separators), real dates, text kept verbatim (leading zeros,
// Arabic), an auto-filter, and right-to-left sheets for Arabic.

import { zipSync, strToU8 } from "fflate"
import type { ExportSheet, ExportColumn } from "./export"

// style indexes in styles.xml cellXfs
const STYLE_TEXT = 0
const STYLE_HEADER = 1
const STYLE_NUMBER = 2
const STYLE_DATE = 3

function esc(value: string): string {
  return value
    // characters XML 1.0 can't carry at all
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function colLetter(index: number): string {
  let n = index + 1
  let s = ""
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// "YYYY-MM-DD" → Excel serial day number, or null when not a date
function excelDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (isNaN(utc)) return null
  return (utc - Date.UTC(1899, 11, 30)) / 86_400_000
}

function sheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, " ").trim() || "Sheet").slice(0, 31)
  let candidate = base
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function cellXml(ref: string, col: ExportColumn, value: unknown): string {
  if (value === null || value === undefined || value === "") return ""
  if (col.type === "number" && typeof value === "number" && isFinite(value)) {
    return `<c r="${ref}" s="${STYLE_NUMBER}"><v>${value}</v></c>`
  }
  if (col.type === "date" && typeof value === "string") {
    const serial = excelDate(value)
    if (serial !== null) return `<c r="${ref}" s="${STYLE_DATE}"><v>${serial}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr" s="${STYLE_TEXT}"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`
}

function columnWidths(sheet: ExportSheet): number[] {
  return sheet.columns.map((col, i) => {
    let longest = col.header.length
    for (const row of sheet.rows) {
      const v = row[i]
      if (v === null || v === undefined) continue
      const text =
        col.type === "number" && typeof v === "number"
          ? v.toLocaleString("en-US")
          : col.type === "date"
          ? "2026-01-01"
          : String(v)
      longest = Math.max(longest, text.length)
    }
    return Math.min(60, Math.max(8, longest + 2))
  })
}

function worksheetXml(sheet: ExportSheet, rtl: boolean): string {
  const lastCol = colLetter(Math.max(0, sheet.columns.length - 1))
  const lastRow = sheet.rows.length + 1
  const widths = columnWidths(sheet)

  const header =
    `<row r="1">` +
    sheet.columns
      .map(
        (c, i) =>
          `<c r="${colLetter(i)}1" t="inlineStr" s="${STYLE_HEADER}"><is><t xml:space="preserve">${esc(c.header)}</t></is></c>`
      )
      .join("") +
    `</row>`

  const body = sheet.rows
    .map((row, r) => {
      const rowNum = r + 2
      const cells = sheet.columns
        .map((col, i) => cellXml(`${colLetter(i)}${rowNum}`, col, row[i]))
        .join("")
      return `<row r="${rowNum}">${cells}</row>`
    })
    .join("")

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${rtl ? ` rightToLeft="1"` : ""}>` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${header}${body}</sheetData>` +
    (sheet.rows.length > 0 ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : "") +
    `</worksheet>`
  )
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE8F3EE"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="2">` +
  `<border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="thin"><color rgb="FF8AA79A"/></bottom><diagonal/></border>` +
  `</borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  // text: start-aligned, top
  `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>` +
  // header: bold, tinted, bottom border
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
  // number: thousands separators, right-aligned
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
  // date
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`

export function buildXlsx(sheets: ExportSheet[], opts: { rtl?: boolean } = {}): Uint8Array {
  const list = sheets.length > 0 ? sheets : [{ name: "Sheet1", columns: [], rows: [] }]
  const used = new Set<string>()
  const names = list.map((s) => sheetName(s.name, used))

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        list
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join("") +
        `</Types>`
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<bookViews><workbookView/></bookViews>` +
        `<sheets>${names
          .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("")}</sheets>` +
        // the auto-filter needs a hidden defined name per sheet
        (list.some((s) => s.rows.length > 0) ? `<definedNames>` : "") +
        `${list
          .map((s, i) =>
            s.rows.length > 0
              ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!$A$1:$${colLetter(Math.max(0, s.columns.length - 1))}$${s.rows.length + 1}</definedName>`
              : ""
          )
          .join("")}` +
        (list.some((s) => s.rows.length > 0) ? `</definedNames>` : "") +
        `</workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join("") +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`
    ),
    "xl/styles.xml": strToU8(STYLES_XML),
  }
  list.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(worksheetXml(s, !!opts.rtl))
  })

  return zipSync(files, { level: 6 })
}
