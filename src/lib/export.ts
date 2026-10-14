// Tabular export shared by Apartments, Payments and Reports.
//
// A page describes its data once as ExportSheet[] (ordered columns +
// rows). The same description drives the on-screen preview, the CSV and
// the Excel file, so all three always show the same columns in the same
// order with the same alignment.

import { buildCsv } from "./csv"

export type ExportColumnType = "text" | "number" | "date"

export interface ExportColumn {
  header: string
  // text: as-is (phones keep their leading zero); number: right-aligned,
  // stored as a real number; date: "YYYY-MM-DD", stored as an Excel date
  type?: ExportColumnType
}

export type ExportCell = string | number | null | undefined

export interface ExportSheet {
  name: string
  columns: ExportColumn[]
  rows: ExportCell[][]
}

export function columnAlign(col: ExportColumn): "start" | "end" {
  return col.type === "number" ? "end" : "start"
}

// How a cell reads in the preview and the CSV
export function displayCell(col: ExportColumn, value: ExportCell): string {
  if (value === null || value === undefined || value === "") return ""
  if (col.type === "number" && typeof value === "number") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
  }
  return String(value)
}

// CSV: one sheet is a plain table; several sheets are stacked, each
// under its name with a blank line between them. Numbers are written
// without thousands separators so spreadsheets read them as numbers.
export function sheetsToCsv(sheets: ExportSheet[]): string {
  const blocks = sheets.map((sheet) => {
    const rows = sheet.rows.map((r) =>
      sheet.columns.map((_, i) => {
        const v = r[i]
        if (v === null || v === undefined) return ""
        return typeof v === "number" ? String(v) : v
      })
    )
    const table = buildCsv(sheet.columns.map((c) => c.header), rows)
    return sheets.length > 1 ? `${csvLine(sheet.name)}\r\n${table}` : table
  })
  return blocks.join("\r\n\r\n")
}

function csvLine(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv(filename: string, sheets: ExportSheet[]) {
  // the BOM makes Excel open the file as UTF-8, so Arabic stays readable
  const blob = new Blob(["﻿" + sheetsToCsv(sheets)], { type: "text/csv;charset=utf-8;" })
  downloadBlob(`${filename}.csv`, blob)
}

export async function exportXlsx(filename: string, sheets: ExportSheet[], opts: { rtl?: boolean } = {}) {
  const { buildXlsx } = await import("./xlsx")
  const bytes = buildXlsx(sheets, opts)
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  downloadBlob(`${filename}.xlsx`, blob)
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
