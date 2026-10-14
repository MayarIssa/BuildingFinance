"use client"

import { useState } from "react"
import { Download, FileSpreadsheet, FileText } from "lucide-react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  columnAlign,
  displayCell,
  exportCsv,
  exportXlsx,
  todayStamp,
  type ExportSheet,
} from "@/lib/export"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const PREVIEW_ROWS = 50

// Preview + download for one export. The preview table is built from the
// same ExportSheet the files are written from, so its columns, order and
// alignment are exactly what lands in the CSV / Excel file.
export function ExportDialog({
  open,
  onOpenChange,
  title,
  description,
  filename,
  sheets,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** file name without extension or date, e.g. "apartments" */
  filename: string
  sheets: ExportSheet[]
}) {
  const { t, lang } = useI18n()
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const sheet = sheets[Math.min(active, sheets.length - 1)]
  const name = `${filename}-${todayStamp()}`

  async function downloadExcel() {
    setBusy(true)
    try {
      await exportXlsx(name, sheets, { rtl: lang === "ar" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setActive(0)
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ? `${description} ` : ""}
            {t("The files contain exactly the columns shown below, in this order.")}
          </DialogDescription>
        </DialogHeader>

        {sheets.length > 1 && (
          <div className="flex flex-wrap gap-2" role="tablist">
            {sheets.map((s, i) => (
              <button
                key={s.name}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  i === active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted"
                )}
              >
                {s.name} <span className="opacity-70">({s.rows.length})</span>
              </button>
            ))}
          </div>
        )}

        {sheet && (
          <div className="max-h-[50dvh] overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {sheet.columns.map((c) => (
                    <TableHead
                      key={c.header}
                      className={cn("whitespace-nowrap", columnAlign(c) === "end" ? "text-end" : "text-start")}
                    >
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={sheet.columns.length} className="py-8 text-center text-muted-foreground">
                      {t("Nothing to export")}
                    </TableCell>
                  </TableRow>
                ) : (
                  sheet.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                    <TableRow key={r}>
                      {sheet.columns.map((c, i) => (
                        <TableCell
                          key={c.header}
                          className={cn(
                            "whitespace-nowrap",
                            columnAlign(c) === "end" ? "nums text-end" : "text-start"
                          )}
                        >
                          {displayCell(c, row[i])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
        {sheet && sheet.rows.length > PREVIEW_ROWS && (
          <p className="text-xs text-muted-foreground">
            {t("Showing the first {n} of {total} rows — the file contains all of them.", {
              n: PREVIEW_ROWS,
              total: sheet.rows.length,
            })}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => exportCsv(name, sheets)}>
            <FileText className="h-4 w-4" /> {t("Download CSV")}
          </Button>
          <Button onClick={downloadExcel} disabled={busy}>
            {busy ? <Download className="h-4 w-4 animate-pulse" /> : <FileSpreadsheet className="h-4 w-4" />}
            {t("Download Excel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
