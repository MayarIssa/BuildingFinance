"use client"

import { useState, useMemo, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useStore } from "@/lib/store"
import { useLayout } from "@/lib/layout"
import { useComputed } from "@/hooks/use-computed"
import { useI18n } from "@/lib/i18n"
import { formatCurrency, formatDate, cn, CURRENCY_LABEL } from "@/lib/utils"
import { PAYMENT_METHODS, PAYER_RELATIONS, buildingFloors, relationLabel } from "@/lib/constants"
import { normalizeDate, parseAmount } from "@/lib/csv"
import { IMPORT_ACCEPT, PAYMENT_HEADERS, normalizeMethodCell, readImportFile } from "@/lib/import-file"
import { matchesSearch } from "@/lib/search"
import { useBack, useBasePath } from "@/lib/navigation"
import { monthKey, monthKeyOrNull, firstDayOfMonth, lastDayOfMonth, monthKeyLabel, monthRangeLabel } from "@/lib/months"
import type { ExportSheet } from "@/lib/export"
import type { Payment, PaymentStatus, PaymentMethod, PayerRelation } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { ExportDialog } from "@/components/export-dialog"
import { usePaymentEditor, unitCompare } from "@/components/payments/payment-editor"
import { MonthDot, MonthDotLegend, MethodBadge, methodLabel, monthShort, statusLabel } from "@/components/payments/month-dot"
import {
  Plus,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Pencil,
  Trash2,
  Download,
  Upload,
  RotateCcw,
  ClipboardCopy,
  Building2,
} from "lucide-react"

type SortField = "unit_number" | "amount_owed"
type SortDir = "asc" | "desc"

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const statusBadgeVariant = (status: PaymentStatus) => {
  switch (status) {
    case "overdue": return "destructive" as const
    case "due_soon": return "warning" as const
    case "paid": return "success" as const
  }
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-96 w-full" /></div>}>
      <PaymentsContent />
    </Suspense>
  )
}

function PaymentsContent() {
  const { state, importPayments } = useStore()
  const { order, visibleKeys, toggle } = useLayout()
  const { apartmentsWithStatus, getMonthCells, getMonthMethod, getMonthPaid } = useComputed()
  const { toast } = useToast()
  const { t, lang } = useI18n()
  const router = useRouter()
  const base = useBasePath()
  const searchParams = useSearchParams()
  const editor = usePaymentEditor()

  // ?apt=<id> narrows the page to one unit — its own URL so Back returns
  // to the full list
  const aptId = searchParams.get("apt")
  const unit = aptId ? state.apartments.find((a) => a.id === aptId) : undefined
  const goBack = useBack(`${base}/payments`)

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "")
  // filters start from the URL so dashboard cards can link here preset
  const [filterStatus, setFilterStatus] = useState<PaymentStatus | "all">(() => {
    const v = searchParams.get("status")
    return v === "paid" || v === "due_soon" || v === "overdue" ? v : "all"
  })
  const [filterMethod, setFilterMethod] = useState<PaymentMethod | "all">(() => {
    const v = searchParams.get("method")
    return v === "cash" || v === "bank" ? v : "all"
  })
  const [filterFloor, setFilterFloor] = useState<string>(() => searchParams.get("floor") ?? "all")
  const [filterBuilding, setFilterBuilding] = useState<string>("all")
  const [filterPayStart, setFilterPayStart] = useState(() => searchParams.get("start") ?? "")
  const [filterPayEnd, setFilterPayEnd] = useState(() => searchParams.get("end") ?? "")
  const [sortField, setSortField] = useState<SortField>("unit_number")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [gridYear, setGridYear] = useState(() => new Date().getFullYear())
  const [exportOpen, setExportOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const floors = useMemo(
    () => buildingFloors(state.settings.mezzanine_floors, state.settings.num_floors),
    [state.settings.mezzanine_floors, state.settings.num_floors]
  )
  const numBuildings = Math.max(1, state.settings.num_buildings || 1)
  const aptById = useMemo(() => new Map(state.apartments.map((a) => [a.id, a])), [state.apartments])

  const filtersActive =
    search !== "" ||
    filterStatus !== "all" ||
    filterMethod !== "all" ||
    filterFloor !== "all" ||
    filterBuilding !== "all" ||
    filterPayStart !== "" ||
    filterPayEnd !== ""

  function resetFilters() {
    setSearch("")
    setFilterStatus("all")
    setFilterMethod("all")
    setFilterFloor("all")
    setFilterBuilding("all")
    setFilterPayStart("")
    setFilterPayEnd("")
  }

  // apartments that pass the unit-level filters (search by unit, name or
  // phone; floor; building; payment status; method used)
  const filteredApartments = useMemo(() => {
    const methodApts =
      filterMethod === "all"
        ? null
        : new Set(state.payments.filter((p) => p.method === filterMethod).map((p) => p.apartment_id))
    // a unit also matches when someone who paid for it matches the search
    const payerMatch = new Set(
      search ? state.payments.filter((p) => matchesSearch(search, [p.payer_name])).map((p) => p.apartment_id) : []
    )
    const list = apartmentsWithStatus.filter((a) => {
      if (aptId && a.id !== aptId) return false
      if (filterStatus !== "all" && a.payment_status !== filterStatus) return false
      if (filterFloor !== "all" && a.floor !== filterFloor) return false
      if (filterBuilding !== "all" && String(a.building_no ?? 1) !== filterBuilding) return false
      if (methodApts && !methodApts.has(a.id)) return false
      return (
        payerMatch.has(a.id) ||
        matchesSearch(search, [a.unit_number, a.primary_resident_name, a.secondary_resident_name], [a.phone, a.phone2])
      )
    })
    return list.sort((a, b) => {
      const cmp =
        sortField === "unit_number" ? unitCompare(a.unit_number, b.unit_number) : a.amount_owed - b.amount_owed
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [apartmentsWithStatus, state.payments, aptId, search, filterStatus, filterFloor, filterBuilding, filterMethod, sortField, sortDir])

  const gridApartments = useMemo(
    () => [...filteredApartments].sort((a, b) => unitCompare(a.unit_number, b.unit_number)),
    [filteredApartments]
  )

  // money collected per apartment within the grid year
  const collectedByApartment = useMemo(() => {
    const map = new Map<string, number>()
    const y = String(gridYear)
    for (const p of state.payments) {
      if (p.date_paid?.slice(0, 4) !== y) continue
      map.set(p.apartment_id, (map.get(p.apartment_id) ?? 0) + p.amount)
    }
    return map
  }, [state.payments, gridYear])

  // payment entries of the filtered units, newest first
  const paymentLog = useMemo(() => {
    const unitIds = new Set(filteredApartments.map((a) => a.id))
    return state.payments
      .filter((p) => {
        if (!unitIds.has(p.apartment_id)) return false
        if (filterMethod !== "all" && p.method !== filterMethod) return false
        if (filterPayStart && p.date_paid < filterPayStart) return false
        if (filterPayEnd && p.date_paid > filterPayEnd) return false
        return true
      })
      .sort((a, b) => b.date_paid.localeCompare(a.date_paid) || (b.created_at || "").localeCompare(a.created_at || ""))
  }, [state.payments, filteredApartments, filterMethod, filterPayStart, filterPayEnd])

  const logTotal = paymentLog.reduce((s, p) => s + p.amount, 0)

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  function sortIcon(field: SortField) {
    if (sortField !== field) return null
    return sortDir === "asc" ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />
  }

  const statusText = (s: PaymentStatus) => (s === "paid" ? t("Paid") : s === "due_soon" ? t("Due Soon") : t("Overdue"))
  const monthsText = (p: Payment) =>
    p.extra
      ? t("Extra")
      : monthRangeLabel(monthKeyOrNull(p.period_start) ?? monthKey(p.date_paid), monthKeyOrNull(p.period_end) ?? monthKey(p.date_paid))
  const openUnit = (id: string) => router.push(`${base}/payments?apt=${id}`)

  // ── CSV import ──

  const PAYMENTS_CSV_PROMPT = `Convert my payment records into a CSV file with EXACTLY this header row (lowercase, comma-separated, in this order):

unit_number,payer_name,payer_relation,amount,method,date_paid,first_month,last_month,recurring,extra,on_dashboard,notes

Rules for each column:
- unit_number: the apartment's unit number exactly as registered in the app (required)
- payer_name: who paid; leave empty to default to the resident
- payer_relation: one of father, mother, sister, brother, son, daughter, friend, other — or empty
- amount: a plain number, no currency symbol or thousands separators (e.g. 1500)
- method: cash or bank
- date_paid: the day the money was received, formatted YYYY-MM-DD (e.g. 2026-07-03) (required)
- first_month: first month this payment covers, formatted YYYY-MM (e.g. 2026-07)
- last_month: last month covered, formatted YYYY-MM; same as first_month for a single month
- recurring: yes if it repeats automatically every month, otherwise leave empty
- extra: yes if the money is NOT tied to specific months (e.g. settling old dues), otherwise empty
- on_dashboard: no to keep the payment out of the dashboard totals, otherwise yes
- notes: free text, or empty

Wrap any value containing a comma in double quotes. Output only the CSV content, no explanations, no markdown code fences.`

  function copyPaymentsCsvPrompt() {
    navigator.clipboard
      .writeText(PAYMENTS_CSV_PROMPT)
      .then(() => toast({ title: t("Prompt copied"), description: t("Paste it to an AI with your raw data to get an import-ready CSV."), variant: "success" }))
      .catch(() => toast({ title: t("Copy failed"), description: t("Your browser blocked clipboard access."), variant: "destructive" }))
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileInputRef.current) fileInputRef.current.value = ""
    let objs: Record<string, string>[]
    try {
      objs = await readImportFile(file, PAYMENT_HEADERS)
    } catch {
      toast({ title: t("Import failed"), description: t("Save the file as Excel (.xlsx) or CSV and try again."), variant: "destructive" })
      return
    }
    const aptByUnit = new Map(state.apartments.map((a) => [a.unit_number.trim().toLowerCase(), a]))
    let skipped = 0
    const rows: Omit<Payment, "id" | "created_at">[] = []
    for (const o of objs) {
      const apt = aptByUnit.get((o.unit_number || "").trim().toLowerCase())
      const amount = parseAmount(o.amount || "")
      const datePaid = normalizeDate(o.date_paid || "")
      if (!apt || isNaN(amount) || !datePaid) { skipped++; continue }

      // months covered: period_start/period_end (full dates), else
      // first_month/last_month (month keys), else the payment date's month
      let periodStart = o.period_start || ""
      let periodEnd = o.period_end || ""
      if (!(periodStart && periodEnd)) {
        const firstKey = monthKeyOrNull(o.first_month || "") ?? monthKeyOrNull(o.period_start || "") ?? monthKey(datePaid)
        const lastKey = monthKeyOrNull(o.last_month || "") ?? monthKeyOrNull(o.period_end || "") ?? firstKey
        periodStart = firstDayOfMonth(firstKey)
        periodEnd = lastDayOfMonth(lastKey >= firstKey ? lastKey : firstKey)
      }

      const relRaw = (o.payer_relation || "").toLowerCase()
      rows.push({
        apartment_id: apt.id,
        payer_name: o.payer_name || apt.primary_resident_name,
        payer_relation: PAYER_RELATIONS.some((r) => r.value === relRaw) ? (relRaw as PayerRelation) : "",
        amount,
        method: normalizeMethodCell(o.method || ""),
        date_paid: datePaid,
        period_start: periodStart,
        period_end: periodEnd,
        recurring: ["yes", "true", "1"].includes((o.recurring || "").toLowerCase()),
        extra: ["yes", "true", "1"].includes((o.extra || "").toLowerCase()),
        on_dashboard: !["no", "false", "0"].includes((o.on_dashboard || "").toLowerCase()),
        notes: o.notes || "",
      })
    }
    const n = importPayments(rows)
    toast({
      title: t("Import complete"),
      description: t("{n} payments imported", { n }) + (skipped ? t(", {n} rows skipped", { n: skipped }) : ""),
      variant: skipped && !n ? "destructive" : "success",
    })
  }

  // ── Export — the filtered log and summary, as shown ──

  const cur = CURRENCY_LABEL[lang]
  const exportSheets = useMemo((): ExportSheet[] => [
    {
      name: t("Payments"),
      columns: [
        { header: t("Date Paid"), type: "date" },
        { header: t("Unit") },
        { header: t("Floor") },
        { header: t("Resident") },
        { header: t("Phone") },
        { header: t("Payer") },
        { header: t("Relation") },
        { header: `${t("Amount")} (${cur})`, type: "number" },
        { header: t("Method") },
        { header: t("From month") },
        { header: t("To month") },
        { header: t("Type") },
        { header: t("Notes") },
      ],
      rows: paymentLog.map((p) => {
        const apt = aptById.get(p.apartment_id)
        const from = monthKeyOrNull(p.period_start) ?? monthKey(p.date_paid)
        const to = monthKeyOrNull(p.period_end) ?? from
        return [
          p.date_paid,
          apt?.unit_number ?? "",
          apt?.floor ?? "",
          apt?.primary_resident_name ?? "",
          apt?.phone || apt?.phone2 || "",
          p.payer_name,
          p.payer_relation ? t(relationLabel(p.payer_relation)) : "",
          p.amount,
          p.method === "bank" ? t("Bank") : t("Cash"),
          p.extra ? "" : from,
          p.extra ? "" : to,
          p.extra ? t("Extra") : p.recurring ? t("Monthly (repeats)") : t("Monthly"),
          p.notes,
        ]
      }),
    },
    {
      name: t("Payment summary"),
      columns: [
        { header: t("Unit") },
        { header: t("Resident") },
        { header: t("Phone") },
        { header: `${t("Monthly Due")} (${cur})`, type: "number" },
        { header: t("Payment Status") },
        { header: `${t("Amount Owed")} (${cur})`, type: "number" },
        { header: t("Last Paid Month") },
        { header: `${t("Total paid")} (${cur})`, type: "number" },
      ],
      rows: filteredApartments.map((a) => [
        a.unit_number,
        a.primary_resident_name,
        a.phone || a.phone2,
        a.monthly_due_amount,
        statusText(a.payment_status),
        a.amount_owed,
        a.last_paid_month ?? "",
        a.total_paid,
      ]),
    },
  // statusText only depends on t
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [paymentLog, filteredApartments, aptById, t, cur])

  if (!state.loaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const sectionOrder = visibleKeys("payments")
  const sectionToggles = order("payments")
  const sectionLabel: Record<string, string> = {
    summary: t("Payment summary"),
    collection_grid: t("Payment grid"),
    payment_log: t("Payment log"),
  }

  const yearNav = (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setGridYear((y) => y - 1)} aria-label={t("Previous year")}>
        <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
      </Button>
      <span className="nums text-sm font-semibold">{gridYear}</span>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setGridYear((y) => y + 1)} aria-label={t("Next year")}>
        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
      </Button>
    </div>
  )

  return (
    <div className="space-y-6">
      {unit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Back")}
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{t("Payments")} · {t("Unit")} {unit.unit_number}</h1>
            <p className="text-sm text-muted-foreground">{unit.primary_resident_name}</p>
          </div>
          <div className="phone-actions flex flex-wrap gap-2">
            <Button onClick={() => editor.openAdd(unit)}>
              <Plus className="h-4 w-4" /> {t("Add Payment")}
            </Button>
            <Button variant="outline" onClick={() => router.push(`${base}/apartments?id=${unit.id}`)}>
              <Building2 className="h-4 w-4" /> {t("Apartment details")}
            </Button>
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <Download className="h-4 w-4" /> {t("Export")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("Payments")}</h1>
            <p className="text-sm text-muted-foreground">{t("Collections, payment status and history")}</p>
          </div>
          <div className="phone-actions flex flex-wrap gap-2">
            <Button onClick={() => editor.openAdd(null)}>
              <Plus className="h-4 w-4" /> {t("Add Payment")}
            </Button>
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <Download className="h-4 w-4" /> {t("Export")}
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> {t("Import Payments")}
            </Button>
            <Button variant="outline" onClick={copyPaymentsCsvPrompt} title={t("Copy an AI prompt that converts your raw data into an import-ready CSV")}>
              <ClipboardCopy className="h-4 w-4" /> {t("Payments Prompt")}
            </Button>
            <input ref={fileInputRef} type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={handleImportFile} />
          </div>
        </div>
      )}

      {/* Search, filters and section toggles */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          {!unit && (
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("Search phone, name or unit…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-9 pe-9"
                aria-label={t("Search payments")}
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute end-3 top-1/2 -translate-y-1/2" aria-label={t("Clear search")}>
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {!unit && numBuildings > 1 && (
              <Select value={filterBuilding} onValueChange={setFilterBuilding}>
                <SelectTrigger className="sm:w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All Buildings")}</SelectItem>
                  {Array.from({ length: numBuildings }, (_, i) => String(i + 1)).map((b) => (
                    <SelectItem key={b} value={b}>{t("Building")} {b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!unit && (
              <Select value={filterFloor} onValueChange={setFilterFloor}>
                <SelectTrigger className="sm:w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All Floors")}</SelectItem>
                  {floors.map((f) => (
                    <SelectItem key={f} value={f}>{f.startsWith("M") ? `${t("Mezzanine")} ${f}` : `${t("Floor")} ${f}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!unit && (
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as PaymentStatus | "all")}>
                <SelectTrigger className="sm:w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All Status")}</SelectItem>
                  <SelectItem value="paid">{t("Paid")}</SelectItem>
                  <SelectItem value="due_soon">{t("Due Soon")}</SelectItem>
                  <SelectItem value="overdue">{t("Overdue")}</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={filterMethod} onValueChange={(v) => setFilterMethod(v as PaymentMethod | "all")}>
              <SelectTrigger className="sm:w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All Methods")}</SelectItem>
                {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{t(m.label)}</SelectItem>)}
              </SelectContent>
            </Select>
            <DateRangePicker
              className="h-9 font-normal"
              value={{ start: filterPayStart, end: filterPayEnd }}
              onChange={(r) => {
                setFilterPayStart(r.start)
                setFilterPayEnd(r.end)
              }}
            />
            {filtersActive && (
              <Button variant="ghost" onClick={resetFilters}>
                <RotateCcw className="h-4 w-4" /> {t("Reset Filters")}
              </Button>
            )}
          </div>

          {/* Section toggles — the same switches as Settings → page layout */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3">
            <span className="text-xs font-medium text-muted-foreground">{t("Show:")}</span>
            {sectionToggles.map((w) => (
              <label key={w.key} className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch checked={w.visible} onCheckedChange={() => toggle("payments", w.key)} aria-label={sectionLabel[w.key]} />
                {sectionLabel[w.key]}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {sectionOrder.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("All sections are hidden — switch one on above.")}</p>
      )}

      <div className="flex flex-col gap-6">
        {sectionOrder.includes("summary") && (
          <div style={{ order: sectionOrder.indexOf("summary") }}>
            <Card>
              <CardHeader>
                <CardTitle>{t("Payment summary")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("Payment status per apartment")}</p>
              </CardHeader>
              <CardContent className="p-0 sm:p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("unit_number")}>
                        {t("Unit")} {sortIcon("unit_number")}
                      </TableHead>
                      <TableHead>{t("Resident")}</TableHead>
                      <TableHead>{t("Phone")}</TableHead>
                      <TableHead className="text-end">{t("Monthly Due")}</TableHead>
                      <TableHead>{t("Payment Status")}</TableHead>
                      <TableHead className="cursor-pointer select-none text-end" onClick={() => toggleSort("amount_owed")}>
                        {t("Amount Owed")} {sortIcon("amount_owed")}
                      </TableHead>
                      <TableHead className="text-end">{t("Paid Ahead")}</TableHead>
                      <TableHead className="text-end">{t("Last Paid Month")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredApartments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          {state.apartments.length === 0 ? t("No apartments yet") : t("No apartments match your search/filters")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredApartments.map((apt) => (
                        <TableRow key={apt.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openUnit(apt.id)}>
                          <TableCell className="font-medium">{apt.unit_number}</TableCell>
                          <TableCell>{apt.primary_resident_name || "—"}</TableCell>
                          <TableCell className="nums whitespace-nowrap"><span dir="ltr">{apt.phone || apt.phone2 || "—"}</span></TableCell>
                          <TableCell className="nums text-end">{formatCurrency(apt.monthly_due_amount)}</TableCell>
                          <TableCell>
                            <Badge variant={statusBadgeVariant(apt.payment_status)}>{statusText(apt.payment_status)}</Badge>
                          </TableCell>
                          <TableCell className={cn("nums text-end font-medium", apt.amount_owed > 0 && "text-destructive")}>
                            {formatCurrency(apt.amount_owed)}
                          </TableCell>
                          <TableCell className={cn("nums text-end font-medium", apt.paid_ahead > 0 && "text-emerald-700 dark:text-emerald-400")}>
                            {apt.paid_ahead > 0 ? formatCurrency(apt.paid_ahead) : "—"}
                          </TableCell>
                          <TableCell className="text-end text-sm">
                            {apt.last_paid_month ? monthKeyLabel(apt.last_paid_month) : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {sectionOrder.includes("collection_grid") && (
          <div style={{ order: sectionOrder.indexOf("collection_grid") }}>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{t("Payment grid")}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("Paid months per apartment, lowest unit first. B = bank, C = cash.")}
                  </p>
                </div>
                {yearNav}
              </CardHeader>
              <CardContent className="space-y-3">
                <Table mobile="grid" containerClassName="max-h-[70dvh] rounded-lg border border-border">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky start-0 top-0 z-20 bg-card">{t("Unit")}</TableHead>
                      {MONTH_LABELS.map((m, i) => (
                        <TableHead key={m} className="sticky top-0 z-10 bg-card px-1 text-center" title={t(m)}>{monthShort(i, lang)}</TableHead>
                      ))}
                      <TableHead className="sticky top-0 z-10 bg-card text-end">{t("Collected")} {gridYear}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gridApartments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={14} className="py-8 text-center text-muted-foreground">
                          {state.apartments.length === 0 ? t("No apartments yet") : t("No apartments match your search/filters")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      gridApartments.map((apt) => {
                        const cells = getMonthCells(apt.id, gridYear)
                        return (
                          <TableRow key={apt.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openUnit(apt.id)}>
                            <TableCell className="sticky start-0 z-[1] whitespace-nowrap bg-card font-medium">{apt.unit_number}</TableCell>
                            {cells.map((s, i) => {
                              const key = `${gridYear}-${String(i + 1).padStart(2, "0")}`
                              const method = s === "paid" ? getMonthMethod(apt.id, key) : undefined
                              const mp = s !== "paid" ? getMonthPaid(apt.id, key) : undefined
                              const part = mp && mp.paid > 0 ? mp.paid / mp.due : 0
                              const title = `${t("Unit")} ${apt.unit_number} — ${t(MONTH_LABELS[i])} ${gridYear}: ${
                                part && mp
                                  ? t("Partly paid: {paid} of {due} — {left} still needed", { paid: formatCurrency(mp.paid), due: formatCurrency(mp.due), left: formatCurrency(mp.due - mp.paid) })
                                  : statusLabel(s, t)
                              }${method ? ` (${methodLabel(method, t)})` : ""}`
                              return (
                                <TableCell key={i} className="px-1 py-2 text-center">
                                  <MonthDot status={s} method={method} partial={part} title={title} />
                                </TableCell>
                              )
                            })}
                            <TableCell className="nums whitespace-nowrap text-end font-medium">
                              {formatCurrency(collectedByApartment.get(apt.id) ?? 0)}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
                <MonthDotLegend />
              </CardContent>
            </Card>
          </div>
        )}

        {sectionOrder.includes("payment_log") && (
          <div style={{ order: sectionOrder.indexOf("payment_log") }}>
            <Card>
              <CardHeader>
                <CardTitle>{t("Payment log")}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("{n} entries · {total} — use the pencil to fix a wrong entry.", { n: paymentLog.length, total: formatCurrency(logTotal) })}
                </p>
              </CardHeader>
              <CardContent className="p-0 sm:p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Date Paid")}</TableHead>
                      <TableHead>{t("Unit")}</TableHead>
                      <TableHead>{t("Payer")}</TableHead>
                      <TableHead>{t("Relation")}</TableHead>
                      <TableHead className="text-end">{t("Amount")}</TableHead>
                      <TableHead>{t("Method")}</TableHead>
                      <TableHead>{t("Months")}</TableHead>
                      <TableHead>{t("Notes")}</TableHead>
                      <TableHead className="w-[90px] text-end">{t("Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentLog.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                          {state.payments.length === 0 ? t("No payments entered yet") : t("No payments match your search/filters")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paymentLog.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap">{formatDate(p.date_paid)}</TableCell>
                          <TableCell className="font-medium">
                            <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => openUnit(p.apartment_id)}>
                              {aptById.get(p.apartment_id)?.unit_number ?? "?"}
                            </button>
                          </TableCell>
                          <TableCell>{p.payer_name || "—"}</TableCell>
                          <TableCell>{p.payer_relation ? t(relationLabel(p.payer_relation)) : "—"}</TableCell>
                          <TableCell className="nums text-end font-medium">{formatCurrency(p.amount)}</TableCell>
                          <TableCell><MethodBadge method={p.method} /></TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {p.extra ? <Badge variant="outline" title={t("Not tied to months")}>{t("Extra")}</Badge> : monthsText(p)}
                            {p.on_dashboard === false && (
                              <Badge variant="secondary" className="ms-1" title={t("Hidden from the dashboard totals")}>{t("Off dash")}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">{p.notes || "—"}</TableCell>
                          <TableCell className="text-end">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => editor.openEdit(p)} aria-label={t("Edit payment")}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => editor.requestDelete(p.id)} aria-label={t("Delete payment")}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={t("Export payments")}
        description={t("{n} payments — follows your search and filters.", { n: paymentLog.length })}
        filename={unit ? `payments-unit-${unit.unit_number}` : "payments"}
        sheets={exportSheets}
      />
      {editor.dialogs}
    </div>
  )
}
