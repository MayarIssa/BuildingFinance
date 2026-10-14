// The four reports as tables (summary, breakdown, detail) for the
// Reports preview and its CSV / Excel export. Mirrors the sections of the
// PDF report (report-generation.ts) but in the app language.

import type { DateRange } from "@/components/ui/date-range-picker"
import type { Apartment, BuildingSettings, Expense, ExpenseCategory, Payment, Transfer } from "./types"
import type { ExportSheet } from "./export"
import { CURRENCY_LABEL } from "./utils"
import { monthKey, monthKeyOrNull } from "./months"
import { filterExpensesByRange, filterPaymentsByRange, filterTransfersByRange } from "./date-filters"
import { computeBankBalance, computeCashOnHand } from "./computations"

export type ReportType = "income" | "expense" | "balance" | "collections"

export interface ReportInput {
  type: ReportType
  range: DateRange
  payments: Payment[]
  expenses: Expense[]
  transfers: Transfer[]
  categories: ExpenseCategory[]
  apartments: Apartment[]
  /** starting cash/bank balances and their date (Building Setup) */
  settings?: Partial<BuildingSettings>
  lang: "en" | "ar"
  t: (text: string, vars?: Record<string, string | number>) => string
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export function buildReportSheets(input: ReportInput): ExportSheet[] {
  const { type, range, payments, expenses, transfers, categories, apartments, settings, lang, t } = input
  const cur = CURRENCY_LABEL[lang]
  const money = (label: string) => `${t(label)} (${cur})`
  const aptById = new Map(apartments.map((a) => [a.id, a]))
  const catName = (id: string) => {
    const name = categories.find((c) => c.id === id)?.name ?? "other"
    return capitalize(t(name))
  }
  const methodText = (m: Payment["method"]) => (m === "bank" ? t("Bank") : t("Cash"))
  const summary = (rows: [string, number][]): ExportSheet => ({
    name: t("Summary"),
    columns: [{ header: t("Item") }, { header: t("Value"), type: "number" }],
    rows: rows.map(([label, value]) => [label, value]),
  })

  if (type === "income") {
    const rows = filterPaymentsByRange(payments, range)
    const sum = (list: Payment[]) => list.reduce((s, p) => s + p.amount, 0)
    const byMonth = new Map<string, number>()
    for (const p of rows) {
      const k = monthKey(p.date_paid)
      byMonth.set(k, (byMonth.get(k) ?? 0) + p.amount)
    }
    return [
      summary([
        [money("Total collected"), sum(rows)],
        [t("Payments recorded"), rows.length],
        [money("Collected in cash"), sum(rows.filter((p) => p.method === "cash"))],
        [money("Collected via bank"), sum(rows.filter((p) => p.method === "bank"))],
      ]),
      {
        name: t("By month"),
        columns: [{ header: t("Month") }, { header: money("Collected"), type: "number" }],
        rows: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v]),
      },
      {
        name: t("Payments"),
        columns: [
          { header: t("Date Paid"), type: "date" },
          { header: t("Unit") },
          { header: t("Resident") },
          { header: t("Payer") },
          { header: t("Method") },
          { header: money("Amount"), type: "number" },
          { header: t("From month") },
          { header: t("To month") },
          { header: t("Notes") },
        ],
        rows: [...rows]
          .sort((a, b) => a.date_paid.localeCompare(b.date_paid))
          .map((p) => {
            const apt = aptById.get(p.apartment_id)
            const from = monthKeyOrNull(p.period_start) ?? monthKey(p.date_paid)
            const to = monthKeyOrNull(p.period_end) ?? from
            return [
              p.date_paid,
              apt?.unit_number ?? "",
              apt?.primary_resident_name ?? "",
              p.payer_name,
              methodText(p.method),
              p.amount,
              p.extra ? t("Extra") : from,
              p.extra ? "" : to,
              p.notes,
            ]
          }),
      },
    ]
  }

  if (type === "expense") {
    const all = filterExpensesByRange(expenses, range)
    const paid = all.filter((e) => e.paid !== false)
    const byCat = new Map<string, number>()
    for (const e of paid) {
      const name = catName(e.category_id)
      byCat.set(name, (byCat.get(name) ?? 0) + e.amount)
    }
    return [
      summary([
        [money("Total spent"), paid.reduce((s, e) => s + e.amount, 0)],
        [t("Expenses recorded"), all.length],
        [money("Unpaid / still owed"), all.filter((e) => e.paid === false).reduce((s, e) => s + e.amount, 0)],
      ]),
      {
        name: t("By category"),
        columns: [{ header: t("Category") }, { header: money("Spent"), type: "number" }],
        rows: [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([name, v]) => [name, v]),
      },
      {
        name: t("Expenses"),
        columns: [
          { header: t("Date"), type: "date" },
          { header: t("Category") },
          { header: t("Subcategory") },
          { header: t("Vendor") },
          { header: t("Method") },
          { header: t("Status") },
          { header: money("Amount"), type: "number" },
          { header: t("Notes") },
        ],
        rows: [...all]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((e) => [
            e.date,
            catName(e.category_id),
            e.subcategory ?? "",
            e.vendor,
            methodText(e.method),
            e.paid === false ? t("Not paid") : t("Paid"),
            e.amount,
            e.notes,
          ]),
      },
    ]
  }

  if (type === "balance") {
    // balances are current snapshots (on-dashboard payments, paid expenses)
    const dashPay = payments.filter((p) => p.on_dashboard !== false)
    const paidExp = expenses.filter((e) => e.paid !== false)
    const cash = computeCashOnHand(dashPay, paidExp, transfers, [], settings)
    const bank = computeBankBalance(dashPay, paidExp, transfers, [], settings)
    const income = filterPaymentsByRange(dashPay, range).reduce((s, p) => s + p.amount, 0)
    const spent = filterExpensesByRange(paidExp, range).reduce((s, e) => s + e.amount, 0)
    const periodTransfers = filterTransfersByRange(transfers, range)
    const moved = (from: Payment["method"], to: Payment["method"]) =>
      periodTransfers.filter((tr) => tr.from_method === from && tr.to_method === to).reduce((s, tr) => s + tr.amount, 0)
    return [
      summary([
        [money("Cash on hand"), cash],
        [money("Bank balance"), bank],
        [money("Total balance"), cash + bank],
        [money("Income collected"), income],
        [money("Expenses paid"), spent],
        [money("Net (income - expense)"), income - spent],
        [t("Transfers recorded"), periodTransfers.length],
        [money("Cash to bank (deposits)"), moved("cash", "bank")],
        [money("Bank to cash (withdrawals)"), moved("bank", "cash")],
      ]),
      {
        name: t("Transfers"),
        columns: [
          { header: t("Date"), type: "date" },
          { header: t("From") },
          { header: t("To") },
          { header: money("Amount"), type: "number" },
          { header: t("Notes") },
        ],
        rows: [...periodTransfers]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((tr) => [tr.date, methodText(tr.from_method), methodText(tr.to_method), tr.amount, tr.notes]),
      },
    ]
  }

  // collections — per-unit payment counts and totals
  const rows = filterPaymentsByRange(payments, range)
  const perUnit = new Map<string, { unit: string; resident: string; count: number; total: number }>()
  for (const p of rows) {
    const apt = aptById.get(p.apartment_id)
    const key = p.apartment_id || `payer:${p.payer_name}`
    const entry = perUnit.get(key) ?? {
      unit: apt?.unit_number ?? "",
      resident: apt?.primary_resident_name ?? p.payer_name,
      count: 0,
      total: 0,
    }
    entry.count += 1
    entry.total += p.amount
    perUnit.set(key, entry)
  }
  return [
    summary([
      [money("Total collected"), rows.reduce((s, p) => s + p.amount, 0)],
      [t("Payments recorded"), rows.length],
      [t("Units with payments"), perUnit.size],
    ]),
    {
      name: t("Collections per unit"),
      columns: [
        { header: t("Unit") },
        { header: t("Resident") },
        { header: t("Payments"), type: "number" },
        { header: money("Total"), type: "number" },
      ],
      rows: [...perUnit.values()]
        .sort((a, b) => b.total - a.total)
        .map((u) => [u.unit, u.resident, u.count, u.total]),
    },
  ]
}
