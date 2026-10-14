"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /**
   * How the table fits on a phone (under 640px):
   * - "cards": each row becomes a stacked card with the column name
   *   next to every value, so nothing scrolls sideways (default)
   * - "grid": a month grid — first and last cells on one line, the
   *   twelve month cells squeezed into a row below
   * - "scroll": keep the table and let it scroll
   */
  mobile?: "cards" | "grid" | "scroll"
  /** classes for the scrolling wrapper — e.g. a max height so a sticky header has room to stick */
  containerClassName?: string
}

// Copy each column's header text onto its cells as data-label so the
// phone card layout can show "Amount  450" without a header row
function labelCells(table: HTMLTableElement) {
  const headRow = table.tHead?.rows[0]
  if (!headRow) return
  const labels: string[] = []
  for (const th of Array.from(headRow.cells)) {
    for (let i = 0; i < th.colSpan; i++) labels.push(th.textContent?.trim() ?? "")
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0
      for (const cell of Array.from(row.cells)) {
        const label = cell.colSpan > 1 ? "" : labels[col] ?? ""
        if (cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label)
        col += cell.colSpan
      }
    }
  }
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, mobile = "cards", containerClassName, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTableElement>(null)
    React.useImperativeHandle(ref, () => innerRef.current as HTMLTableElement)

    React.useEffect(() => {
      const table = innerRef.current
      if (!table || mobile !== "cards") return
      labelCells(table)
      // rows come and go (filters, edits, language switch) — keep labels in sync
      const observer = new MutationObserver(() => labelCells(table))
      observer.observe(table, { childList: true, subtree: true, characterData: true })
      return () => observer.disconnect()
    }, [mobile])

    return (
      <div className={cn("relative w-full overflow-auto", containerClassName)}>
        <table
          ref={innerRef}
          className={cn(
            "w-full caption-bottom text-sm",
            mobile === "cards" && "rtable-cards",
            mobile === "grid" && "rtable-grid",
            className
          )}
          {...props}
        />
      </div>
    )
  }
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-start align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pe-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pe-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
