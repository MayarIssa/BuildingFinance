"use client"

import type React from "react"

import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import type { MonthCellStatus, MonthMethod } from "@/lib/computations"

// One month in a collection grid:
//   paid by bank → green with "B"
//   paid in cash → cyan with "C"
//   not paid     → red
//   not due yet  → grey
//   partly paid  → amber slice for the paid share, the rest red / grey
// (months before tracking started are a faint dashed outline)
// Every dot has a border so neighbours stay distinguishable. The colours
// are set inline, with fallbacks, so nothing — a stale stylesheet, an
// accessibility tool that hides images — can strip them. Used by the
// payments grid, the expenses grid and the dashboard so the look is
// identical everywhere.

type Size = "sm" | "md" | "lg"

const SIZES: Record<Size, string> = {
  sm: "h-5 w-5 text-[9px]",
  md: "h-6 w-6 text-[10px]",
  lg: "h-8 w-8 text-xs",
}

const COLORS = {
  bank: { bg: "var(--pay-bank, #15803d)", border: "#0f5c2c", text: "#ffffff" },
  cash: { bg: "var(--pay-cash, #0891b2)", border: "#0e6a82", text: "#ffffff" },
  due: { bg: "var(--pay-due, #dc2626)", border: "#9f1c1c", text: "#ffffff" },
  future: { bg: "var(--pay-future, #d4d4d8)", border: "#a1a1aa", text: "inherit" },
  partial: { bg: "#f59e0b", border: "#b45309", text: "#ffffff" },
  na: { bg: "transparent", border: "var(--border, #e5e7eb)", text: "inherit" },
} as const

function dotLook(status: MonthCellStatus, method: MonthMethod | undefined) {
  if (status === "paid") {
    // a paid month with no recorded method falls back to bank green
    return method === "C" ? { c: COLORS.cash, letter: "C" } : { c: COLORS.bank, letter: method === "B" ? "B" : "" }
  }
  if (status === "due") return { c: COLORS.due, letter: "" }
  if (status === "future") return { c: COLORS.future, letter: "" }
  return { c: COLORS.na, letter: "" }
}

export function methodLabel(method: MonthMethod | undefined, t: (s: string) => string): string {
  if (method === "B") return t("Bank")
  if (method === "C") return t("Cash")
  return ""
}

export function statusLabel(status: MonthCellStatus, t: (s: string) => string): string {
  return status === "paid"
    ? t("Paid")
    : status === "due"
    ? t("Not paid")
    : status === "future"
    ? t("Not due yet")
    : t("Not tracked")
}

export function MonthDot({
  status,
  method,
  size = "md",
  title,
  onClick,
  ariaLabel,
  className,
  partial,
}: {
  status: MonthCellStatus
  method?: MonthMethod
  /** share of the due already paid (0–1) for a month that isn't full */
  partial?: number
  size?: Size
  title?: string
  onClick?: () => void
  ariaLabel?: string
  className?: string
}) {
  const { c, letter } = dotLook(status, method)
  const share = status !== "paid" && partial && partial > 0 ? Math.min(partial, 0.99) : 0
  const style: React.CSSProperties = share
    ? {
        // pie: the paid share in amber, the rest in the month's own colour
        background: `conic-gradient(${COLORS.partial.bg} 0 ${Math.round(share * 360)}deg, ${c.bg} ${Math.round(share * 360)}deg 360deg)`,
        borderColor: COLORS.partial.border,
        borderStyle: "solid",
        color: c.text,
      }
    : {
        background: c.bg,
        borderColor: c.border,
        borderStyle: status === "na" ? "dashed" : "solid",
        color: c.text,
      }
  const classes = cn(
    "mx-auto inline-flex shrink-0 items-center justify-center rounded-full border-2 font-bold leading-none",
    SIZES[size],
    onClick && "cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} style={style} title={title} aria-label={ariaLabel ?? title}>
        {letter}
      </button>
    )
  }
  return (
    <span className={classes} style={style} title={title}>
      {letter}
      {title && <span className="sr-only">{title}</span>}
    </span>
  )
}

export function MonthDotLegend({ className }: { className?: string }) {
  const { t } = useI18n()
  const items: { status: MonthCellStatus; method?: MonthMethod; label: string; partial?: number }[] = [
    { status: "paid", method: "B", label: t("Paid by bank") },
    { status: "paid", method: "C", label: t("Paid in cash") },
    { status: "due", label: t("Partly paid"), partial: 0.5 },
    { status: "due", label: t("Not paid") },
    { status: "future", label: t("Not due yet") },
  ]
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <MonthDot status={it.status} method={it.method} partial={it.partial} size="sm" className="mx-0" />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** Cash / Bank pill using the same colours and letters as the grid dots */
export function MethodBadge({ method }: { method: "cash" | "bank" }) {
  const { t } = useI18n()
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium">
      <MonthDot status="paid" method={method === "bank" ? "B" : "C"} size="sm" className="mx-0" />
      {method === "bank" ? t("Bank") : t("Cash")}
    </span>
  )
}

const MONTHS_SHORT = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  // three-letter forms keep the 12 grid columns narrow
  ar: ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"],
}

/** Short month name for grid column headers (index 0 = January) */
export function monthShort(index: number, lang: "en" | "ar"): string {
  return MONTHS_SHORT[lang][index] ?? ""
}
