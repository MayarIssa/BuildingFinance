"use client"

import { useState, useMemo, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useStore } from "@/lib/store"
import { useI18n } from "@/lib/i18n"
import { formatCurrency, cn, CURRENCY_LABEL } from "@/lib/utils"
import {
  OCCUPANCY_STATUSES,
  buildingFloors,
  normalizeOccupancy,
  occupancyLabel,
} from "@/lib/constants"
import { parseAmount } from "@/lib/csv"
import { APARTMENT_HEADERS, IMPORT_ACCEPT, normalizeFloorCell, normalizePhoneCell, readImportFile } from "@/lib/import-file"
import { matchesSearch } from "@/lib/search"
import { useBack, useBasePath } from "@/lib/navigation"
import type { ExportSheet } from "@/lib/export"
import type { Apartment, OccupancyStatus } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ExportDialog } from "@/components/export-dialog"
import { unitCompare } from "@/components/payments/payment-editor"
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  Phone,
  Mail,
  Pencil,
  Trash2,
  Building2,
  Download,
  Upload,
  Users,
  RotateCcw,
  ClipboardCopy,
  Wallet,
} from "lucide-react"

type SortField = "unit_number" | "primary_resident_name" | "monthly_due_amount" | "floor"
type SortDir = "asc" | "desc"

const occupancyBadgeVariant = (status: OccupancyStatus) => {
  switch (status) {
    case "resident": return "default" as const
    case "non_resident": return "warning" as const
    case "unknown": return "secondary" as const
  }
}

const emptyApartmentForm = {
  unit_number: "",
  building_no: "1",
  floor: "1",
  primary_resident_name: "",
  secondary_resident_name: "",
  phone: "",
  phone2: "",
  email: "",
  monthly_due_amount: "",
  occupancy_status: "resident" as OccupancyStatus,
  notes: "",
}

export default function ApartmentsPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-96 w-full" /></div>}>
      <ApartmentsContent />
    </Suspense>
  )
}

function ApartmentsContent() {
  const { state } = useStore()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("id")

  if (!state.loaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  // the detail view is its own URL so Back (on screen or the phone's)
  // returns to the list instead of leaving the page
  const selected = selectedId ? state.apartments.find((a) => a.id === selectedId) : undefined
  if (selected) return <ApartmentDetail key={selected.id} apt={selected} />
  return <ApartmentList />
}

// ── List ──

function ApartmentList() {
  const { state, addApartment, importApartments } = useStore()
  const { toast } = useToast()
  const { t, lang } = useI18n()
  const router = useRouter()
  const base = useBasePath()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(() => searchParams.get("q") ?? "")
  const [filterOccupancy, setFilterOccupancy] = useState<OccupancyStatus | "all">(() => {
    const v = searchParams.get("occupancy")
    return v ? normalizeOccupancy(v) : "all"
  })
  const [filterFloor, setFilterFloor] = useState<string>(() => searchParams.get("floor") ?? "all")
  const [filterBuilding, setFilterBuilding] = useState<string>("all")
  const [filterContact, setFilterContact] = useState<"all" | "with_phone" | "no_phone">("all")
  const [sortField, setSortField] = useState<SortField>("unit_number")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const [aptDialogOpen, setAptDialogOpen] = useState(false)
  const [aptForm, setAptForm] = useState(emptyApartmentForm)
  const [exportOpen, setExportOpen] = useState(false)
  const aptFileInputRef = useRef<HTMLInputElement>(null)

  const floors = useMemo(
    () => buildingFloors(state.settings.mezzanine_floors, state.settings.num_floors),
    [state.settings.mezzanine_floors, state.settings.num_floors]
  )
  const numBuildings = Math.max(1, state.settings.num_buildings || 1)

  const counts = useMemo(() => {
    const c: Record<OccupancyStatus, number> = { resident: 0, non_resident: 0, unknown: 0 }
    for (const a of state.apartments) c[a.occupancy_status] = (c[a.occupancy_status] ?? 0) + 1
    return c
  }, [state.apartments])

  const filtersActive =
    search !== "" ||
    filterOccupancy !== "all" ||
    filterFloor !== "all" ||
    filterBuilding !== "all" ||
    filterContact !== "all"

  function resetFilters() {
    setSearch("")
    setFilterOccupancy("all")
    setFilterFloor("all")
    setFilterBuilding("all")
    setFilterContact("all")
  }

  const filtered = useMemo(() => {
    const list = state.apartments.filter((a) => {
      if (filterOccupancy !== "all" && a.occupancy_status !== filterOccupancy) return false
      if (filterFloor !== "all" && a.floor !== filterFloor) return false
      if (filterBuilding !== "all" && String(a.building_no ?? 1) !== filterBuilding) return false
      const hasPhone = !!(a.phone?.trim() || a.phone2?.trim())
      if (filterContact === "with_phone" && !hasPhone) return false
      if (filterContact === "no_phone" && hasPhone) return false
      return matchesSearch(
        search,
        [a.unit_number, a.primary_resident_name, a.secondary_resident_name, a.email, a.notes, a.floor],
        [a.phone, a.phone2]
      )
    })
    const floorRank = (f: string) => {
      const i = floors.indexOf(f)
      return i === -1 ? floors.length : i
    }
    return list.sort((a, b) => {
      let cmp = 0
      if (sortField === "unit_number") cmp = unitCompare(a.unit_number, b.unit_number)
      else if (sortField === "primary_resident_name") cmp = a.primary_resident_name.localeCompare(b.primary_resident_name, lang)
      else if (sortField === "monthly_due_amount") cmp = a.monthly_due_amount - b.monthly_due_amount
      else cmp = floorRank(a.floor) - floorRank(b.floor) || unitCompare(a.unit_number, b.unit_number)
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [state.apartments, search, filterOccupancy, filterFloor, filterBuilding, filterContact, sortField, sortDir, floors, lang])

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

  const floorLabel = (f: string) => (f.startsWith("M") ? `${t("Mezzanine")} ${f}` : `${t("Floor")} ${f}`)

  function handleAddApartment() {
    const due = parseAmount(aptForm.monthly_due_amount)
    if (!aptForm.unit_number || !aptForm.primary_resident_name || isNaN(due)) {
      toast({
        title: t("Missing apartment details"),
        description: t("Unit number, resident name, and a numeric monthly due are required."),
        variant: "destructive",
      })
      return
    }
    if (state.apartments.some((a) => a.unit_number.trim().toLowerCase() === aptForm.unit_number.trim().toLowerCase())) {
      toast({
        title: t("Unit already exists"),
        description: t("Unit {unit} is already registered — unit numbers must be unique.", { unit: aptForm.unit_number }),
        variant: "destructive",
      })
      return
    }

    // hard limits from the building setup — no mishaps
    const buildingNo = Math.max(1, parseInt(aptForm.building_no, 10) || 1)
    if (!floors.includes(aptForm.floor)) {
      toast({
        title: t("Floor not available"),
        description: t("Floor {floor} is outside the building structure configured in Building Setup.", { floor: aptForm.floor }),
        variant: "destructive",
      })
      return
    }
    const perFloor = state.settings.apartments_per_floor
    if (perFloor > 0) {
      const onFloor = state.apartments.filter(
        (a) => a.floor === aptForm.floor && (a.building_no ?? 1) === buildingNo
      ).length
      if (onFloor >= perFloor) {
        toast({
          title: t("Floor is full"),
          description: t("Floor {floor} already has {n} of {max} apartments allowed per floor (see Building Setup).", { floor: aptForm.floor, n: onFloor, max: perFloor }),
          variant: "destructive",
        })
        return
      }
    }
    if (state.settings.total_apartments > 0 && state.apartments.length >= state.settings.total_apartments) {
      toast({
        title: t("Building is full"),
        description: t("All {n} apartments are already registered (see Building Setup).", { n: state.settings.total_apartments }),
        variant: "destructive",
      })
      return
    }

    addApartment({
      unit_number: aptForm.unit_number.trim(),
      building_no: buildingNo,
      floor: aptForm.floor,
      primary_resident_name: aptForm.primary_resident_name,
      secondary_resident_name: aptForm.secondary_resident_name,
      phone: aptForm.phone,
      phone2: aptForm.phone2,
      email: aptForm.email,
      payment_interval: "monthly",
      monthly_due_amount: due,
      occupancy_status: aptForm.occupancy_status,
      notes: aptForm.notes,
    })
    setAptDialogOpen(false)
    setAptForm(emptyApartmentForm)
  }

  // ── CSV import ──

  const APARTMENTS_CSV_PROMPT = `Convert my apartment/unit records into a CSV file with EXACTLY this header row (lowercase, comma-separated, in this order):

unit_number,floor,building_no,primary_resident_name,secondary_resident_name,phone,phone2,email,monthly_due_amount,occupancy_status,notes

Rules for each column:
- unit_number: the unit's number/label exactly (e.g. 101, M1) (required)
- floor: the floor label; leave empty to derive it from the unit number
- building_no: building number, or empty for 1
- primary_resident_name: main resident/owner name
- secondary_resident_name: second resident, or empty
- phone: primary phone, digits only, keep any leading zero (wrap in quotes)
- phone2: secondary phone, or empty
- email: or empty
- monthly_due_amount: plain number, the monthly due (e.g. 450)
- occupancy_status: one of resident, non_resident, unknown (default resident)
- notes: free text, or empty

Wrap any value containing a comma or a leading zero in double quotes. Output only the CSV content, no explanations, no markdown code fences.`

  function copyApartmentsCsvPrompt() {
    navigator.clipboard
      .writeText(APARTMENTS_CSV_PROMPT)
      .then(() => toast({ title: t("Prompt copied"), description: t("Paste it to an AI with your raw data to get an import-ready CSV."), variant: "success" }))
      .catch(() => toast({ title: t("Copy failed"), description: t("Your browser blocked clipboard access."), variant: "destructive" }))
  }

  // Derive the floor from a unit number when the CSV omits it: mezzanine
  // units keep their "M1"/"M2" label; numbered units drop the last two
  // digits (101 → 1, 1304 → 13), defaulting to "1".
  function floorFromUnit(unit: string): string {
    const u = unit.trim()
    if (/^M/i.test(u)) return u.toUpperCase()
    const digits = u.replace(/\D/g, "")
    if (digits.length <= 2) return "1"
    return String(parseInt(digits.slice(0, digits.length - 2), 10) || 1)
  }

  async function handleImportApartmentsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (aptFileInputRef.current) aptFileInputRef.current.value = ""
    let objs: Record<string, string>[]
    try {
      objs = await readImportFile(file, APARTMENT_HEADERS)
    } catch {
      toast({ title: t("Import failed"), description: t("Save the file as Excel (.xlsx) or CSV and try again."), variant: "destructive" })
      return
    }
    if (objs.length && !objs.some((o) => o.unit_number)) {
      toast({ title: t("Import failed"), description: t("No unit column found. The first row must hold the column names (e.g. Unit / الوحدة)."), variant: "destructive" })
      return
    }
    const buildingNoInRange = (v: string | undefined) => {
      const b = parseInt(v || "1", 10) || 1
      return b >= 1 && b <= numBuildings ? b : 1
    }
    let skipped = 0
    const rows: Omit<Apartment, "id" | "created_at">[] = []
    for (const o of objs) {
      const unit = (o.unit_number || "").trim()
      if (!unit) { skipped++; continue }
      rows.push({
        unit_number: unit,
        // a building number outside Building Setup (e.g. the building's
        // street number "11" in a one-building setup) falls back to 1
        building_no: buildingNoInRange(o.building_no),
        floor: normalizeFloorCell(o.floor || "") || floorFromUnit(unit),
        primary_resident_name: (o.primary_resident_name || "").trim(),
        secondary_resident_name: (o.secondary_resident_name || "").trim(),
        phone: normalizePhoneCell(o.phone || ""),
        phone2: normalizePhoneCell(o.phone2 || ""),
        email: o.email || "",
        payment_interval: "monthly",
        monthly_due_amount: parseAmount(o.monthly_due_amount || "0") || 0,
        occupancy_status: normalizeOccupancy(o.occupancy_status),
        notes: o.notes || "",
      })
    }
    const n = importApartments(rows)
    const dupes = rows.length - n
    toast({
      title: t("Import complete"),
      description: t("{n} apartments imported", { n }) + (dupes ? t(", {n} already existed", { n: dupes }) : "") + (skipped ? t(", {n} rows skipped", { n: skipped }) : ""),
      variant: n || dupes ? "success" : "destructive",
    })
  }

  // ── Export — exactly the filtered list, in the order shown ──

  const exportSheets = useMemo((): ExportSheet[] => [
    {
      name: t("Apartments"),
      columns: [
        { header: t("Unit") },
        { header: t("Building"), type: "number" },
        { header: t("Floor") },
        { header: t("Primary Resident Name") },
        { header: t("Second Inhabitant") },
        { header: t("Phone 1") },
        { header: t("Phone 2") },
        { header: t("Email") },
        { header: `${t("Monthly Due")} (${CURRENCY_LABEL[lang]})`, type: "number" },
        { header: t("Residency Status") },
        { header: t("Notes") },
      ],
      rows: filtered.map((a) => [
        a.unit_number,
        a.building_no ?? 1,
        a.floor,
        a.primary_resident_name,
        a.secondary_resident_name,
        a.phone,
        a.phone2,
        a.email,
        a.monthly_due_amount,
        occupancyLabel(a.occupancy_status, lang),
        a.notes,
      ]),
    },
  ], [filtered, t, lang])

  const openApartment = (id: string) => router.push(`${base}/apartments?id=${id}`)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Apartments")}</h1>
          <p className="text-sm text-muted-foreground">{t("Units, residents and contact details")}</p>
        </div>
        <div className="phone-actions flex flex-wrap gap-2">
          <Button onClick={() => { setAptForm(emptyApartmentForm); setAptDialogOpen(true) }}>
            <Building2 className="h-4 w-4" /> {t("Add Apartment")}
          </Button>
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" /> {t("Export")}
          </Button>
          <Button variant="outline" onClick={() => aptFileInputRef.current?.click()} title={t("Bulk-create apartments from an Excel or CSV file")}>
            <Upload className="h-4 w-4" /> {t("Import Apartments")}
          </Button>
          <Button variant="outline" onClick={copyApartmentsCsvPrompt} title={t("Copy an AI prompt that converts your raw data into an import-ready apartments CSV")}>
            <ClipboardCopy className="h-4 w-4" /> {t("Apartments Prompt")}
          </Button>
          <input ref={aptFileInputRef} type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={handleImportApartmentsFile} />
        </div>
      </div>

      {/* Quick status filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          { key: "all" as const, label: t("All apartments"), count: state.apartments.length },
          ...OCCUPANCY_STATUSES.map((o) => ({ key: o.value, label: occupancyLabel(o.value, lang), count: counts[o.value] })),
        ]).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilterOccupancy(chip.key)}
            aria-pressed={filterOccupancy === chip.key}
            className={cn(
              "rounded-xl border p-3 text-start transition-colors",
              filterOccupancy === chip.key
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:bg-muted"
            )}
          >
            <p className="text-xs text-muted-foreground">{chip.label}</p>
            <p className="nums text-xl font-bold">{chip.count}</p>
          </button>
        ))}
      </div>

      {/* Search and filters */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("Search unit, name or phone…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ps-9 pe-9"
              aria-label={t("Search apartments")}
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute end-3 top-1/2 -translate-y-1/2" aria-label={t("Clear search")}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {numBuildings > 1 && (
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
            <Select value={filterFloor} onValueChange={setFilterFloor}>
              <SelectTrigger className="sm:w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All Floors")}</SelectItem>
                {floors.map((f) => <SelectItem key={f} value={f}>{floorLabel(f)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterOccupancy} onValueChange={(v) => setFilterOccupancy(v as OccupancyStatus | "all")}>
              <SelectTrigger className="sm:w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All statuses")}</SelectItem>
                {OCCUPANCY_STATUSES.map((o) => <SelectItem key={o.value} value={o.value}>{occupancyLabel(o.value, lang)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterContact} onValueChange={(v) => setFilterContact(v as typeof filterContact)}>
              <SelectTrigger className="sm:w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Any contact")}</SelectItem>
                <SelectItem value="with_phone">{t("Has a phone")}</SelectItem>
                <SelectItem value="no_phone">{t("No phone")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={`${sortField}:${sortDir}`} onValueChange={(v) => { const [f, d] = v.split(":"); setSortField(f as SortField); setSortDir(d as SortDir) }}>
              <SelectTrigger className="sm:w-[190px]" aria-label={t("Sort")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unit_number:asc">{t("Sort: Unit")}</SelectItem>
                <SelectItem value="floor:asc">{t("Sort: Floor")}</SelectItem>
                <SelectItem value="primary_resident_name:asc">{t("Sort: Name")}</SelectItem>
                <SelectItem value="monthly_due_amount:desc">{t("Sort: Highest due")}</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button variant="ghost" onClick={resetFilters}>
                <RotateCcw className="h-4 w-4" /> {t("Reset Filters")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("{n} of {total} apartments", { n: filtered.length, total: state.apartments.length })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 sm:p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("unit_number")}>
                  {t("Unit")} {sortIcon("unit_number")}
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("floor")}>
                  {t("Floor")} {sortIcon("floor")}
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("primary_resident_name")}>
                  {t("Resident")} {sortIcon("primary_resident_name")}
                </TableHead>
                <TableHead>{t("Second Inhabitant")}</TableHead>
                <TableHead>{t("Phone")}</TableHead>
                <TableHead className="cursor-pointer select-none text-end" onClick={() => toggleSort("monthly_due_amount")}>
                  {t("Monthly Due")} {sortIcon("monthly_due_amount")}
                </TableHead>
                <TableHead>{t("Residency Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {state.apartments.length === 0 ? t("No apartments yet") : t("No apartments match your search/filters")}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((apt) => (
                  <TableRow key={apt.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openApartment(apt.id)}>
                    <TableCell className="font-medium">
                      {apt.unit_number}
                      {numBuildings > 1 && <span className="ms-1 text-xs text-muted-foreground">· {t("Building")} {apt.building_no ?? 1}</span>}
                    </TableCell>
                    <TableCell>{apt.floor}</TableCell>
                    <TableCell>{apt.primary_resident_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{apt.secondary_resident_name || "—"}</TableCell>
                    <TableCell className="nums whitespace-nowrap"><span dir="ltr">{apt.phone || apt.phone2 || "—"}</span></TableCell>
                    <TableCell className="nums text-end">{formatCurrency(apt.monthly_due_amount)}</TableCell>
                    <TableCell>
                      <Badge variant={occupancyBadgeVariant(apt.occupancy_status)}>{occupancyLabel(apt.occupancy_status, lang)}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={t("Export apartments")}
        description={t("{n} apartments — follows your search and filters.", { n: filtered.length })}
        filename="apartments"
        sheets={exportSheets}
      />

      {/* Add Apartment Dialog */}
      <Dialog open={aptDialogOpen} onOpenChange={setAptDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Add Apartment")}</DialogTitle>
          </DialogHeader>
          <ApartmentFields
            form={aptForm}
            onChange={(patch) => setAptForm({ ...aptForm, ...patch })}
            floors={floors}
            numBuildings={numBuildings}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAptDialogOpen(false)}>{t("Cancel")}</Button>
            <Button onClick={handleAddApartment}>{t("Add Apartment")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Shared form fields (add + edit) ──

type ApartmentForm = typeof emptyApartmentForm

function ApartmentFields({
  form,
  onChange,
  floors,
  numBuildings,
}: {
  form: ApartmentForm
  onChange: (patch: Partial<ApartmentForm>) => void
  floors: string[]
  numBuildings: number
}) {
  const { t, lang } = useI18n()
  const floorLabel = (f: string) => (f.startsWith("M") ? `${t("Mezzanine")} ${f}` : `${t("Floor")} ${f}`)
  return (
    <div className="grid gap-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("Unit Number")} *</Label>
          <Input value={form.unit_number} onChange={(e) => onChange({ unit_number: e.target.value })} placeholder="e.g. 101" />
        </div>
        <div>
          <Label>{t("Floor")}</Label>
          <Select value={form.floor} onValueChange={(v) => onChange({ floor: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {floors.map((f) => <SelectItem key={f} value={f}>{floorLabel(f)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {numBuildings > 1 && (
        <div>
          <Label>{t("Building")}</Label>
          <Select value={form.building_no} onValueChange={(v) => onChange({ building_no: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: numBuildings }, (_, i) => String(i + 1)).map((b) => (
                <SelectItem key={b} value={b}>{t("Building")} {b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div>
        <Label>{t("Primary Resident Name")} *</Label>
        <Input value={form.primary_resident_name} onChange={(e) => onChange({ primary_resident_name: e.target.value })} />
      </div>
      <div>
        <Label>{t("Second Inhabitant")}</Label>
        <Input value={form.secondary_resident_name} onChange={(e) => onChange({ secondary_resident_name: e.target.value })} placeholder={t("Optional")} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("Phone 1")}</Label>
          <Input type="tel" dir="ltr" value={form.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
        <div>
          <Label>{t("Phone 2")}</Label>
          <Input type="tel" dir="ltr" value={form.phone2} onChange={(e) => onChange({ phone2: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("Email")}</Label>
          <Input type="email" dir="ltr" value={form.email} onChange={(e) => onChange({ email: e.target.value })} />
        </div>
        <div>
          <Label>{t("Monthly Due")} *</Label>
          <Input type="text" inputMode="decimal" value={form.monthly_due_amount} onChange={(e) => onChange({ monthly_due_amount: e.target.value })} placeholder="0" />
        </div>
      </div>
      <div>
        <Label>{t("Residency Status")}</Label>
        <Select value={form.occupancy_status} onValueChange={(v) => onChange({ occupancy_status: v as OccupancyStatus })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {OCCUPANCY_STATUSES.map((o) => <SelectItem key={o.value} value={o.value}>{occupancyLabel(o.value, lang)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("Notes")}</Label>
        <Textarea value={form.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </div>
    </div>
  )
}

// ── Detail ──

function toForm(apt: Apartment): ApartmentForm {
  return {
    unit_number: apt.unit_number,
    building_no: String(apt.building_no ?? 1),
    floor: apt.floor,
    primary_resident_name: apt.primary_resident_name,
    secondary_resident_name: apt.secondary_resident_name,
    phone: apt.phone,
    phone2: apt.phone2,
    email: apt.email,
    monthly_due_amount: String(apt.monthly_due_amount ?? 0),
    occupancy_status: apt.occupancy_status,
    notes: apt.notes,
  }
}

function ApartmentDetail({ apt }: { apt: Apartment }) {
  const { state, updateApartment, deleteApartment } = useStore()
  const { t, lang } = useI18n()
  const { toast } = useToast()
  const router = useRouter()
  const base = useBasePath()
  const goBack = useBack(`${base}/apartments`)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ApartmentForm>(() => toForm(apt))
  const [confirmDelete, setConfirmDelete] = useState(false)

  const floors = useMemo(
    () => buildingFloors(state.settings.mezzanine_floors, state.settings.num_floors),
    [state.settings.mezzanine_floors, state.settings.num_floors]
  )
  const numBuildings = Math.max(1, state.settings.num_buildings || 1)
  const paymentsCount = state.payments.filter((p) => p.apartment_id === apt.id).length

  function save() {
    const due = parseAmount(form.monthly_due_amount)
    const unit = form.unit_number.trim()
    if (!unit || !form.primary_resident_name.trim() || isNaN(due)) {
      toast({
        title: t("Missing apartment details"),
        description: t("Unit number, resident name, and a numeric monthly due are required."),
        variant: "destructive",
      })
      return
    }
    if (state.apartments.some((a) => a.id !== apt.id && a.unit_number.trim().toLowerCase() === unit.toLowerCase())) {
      toast({
        title: t("Unit already exists"),
        description: t("Unit {unit} is already registered — unit numbers must be unique.", { unit }),
        variant: "destructive",
      })
      return
    }
    updateApartment({
      ...apt,
      unit_number: unit,
      building_no: Math.max(1, parseInt(form.building_no, 10) || 1),
      floor: form.floor,
      primary_resident_name: form.primary_resident_name,
      secondary_resident_name: form.secondary_resident_name,
      phone: form.phone,
      phone2: form.phone2,
      email: form.email,
      monthly_due_amount: due,
      occupancy_status: form.occupancy_status,
      notes: form.notes,
    })
    setEditing(false)
    toast({ title: t("Apartment saved"), variant: "success" })
  }

  function remove() {
    deleteApartment(apt.id)
    setConfirmDelete(false)
    router.replace(`${base}/apartments`)
  }

  const info: { icon?: React.ReactNode; label: string; value: React.ReactNode; ltr?: boolean }[] = [
    { label: t("Resident"), value: apt.primary_resident_name || "—" },
    { icon: <Users className="h-3 w-3" />, label: t("Second Inhabitant"), value: apt.secondary_resident_name || "—" },
    { icon: <Phone className="h-3 w-3" />, label: t("Phone 1"), value: apt.phone || "—", ltr: true },
    { icon: <Phone className="h-3 w-3" />, label: t("Phone 2"), value: apt.phone2 || "—", ltr: true },
    { icon: <Mail className="h-3 w-3" />, label: t("Email"), value: apt.email || "—", ltr: true },
    { label: t("Monthly Due"), value: formatCurrency(apt.monthly_due_amount) },
    { label: t("Residency Status"), value: occupancyLabel(apt.occupancy_status, lang) },
    ...(numBuildings > 1 ? [{ label: t("Building"), value: String(apt.building_no ?? 1) }] : []),
    { label: t("Floor"), value: apt.floor },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Back")}
        </Button>
        <h1 className="text-2xl font-bold">{t("Unit")} {apt.unit_number}</h1>
        <Badge variant={occupancyBadgeVariant(apt.occupancy_status)}>{occupancyLabel(apt.occupancy_status, lang)}</Badge>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("Apartment Details")}</CardTitle>
          {!editing ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => router.push(`${base}/payments?apt=${apt.id}`)}>
                <Wallet className="h-3.5 w-3.5" /> {t("View collections")} ({paymentsCount})
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setForm(toForm(apt)); setEditing(true) }}>
                <Pencil className="h-3.5 w-3.5" /> {t("Edit")}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>{t("Save")}</Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>{t("Cancel")}</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {editing ? (
            <ApartmentFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} floors={floors} numBuildings={numBuildings} />
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                {info.map((row) => (
                  <div key={row.label}>
                    <dt className="flex items-center gap-1 text-sm text-muted-foreground">{row.icon} {row.label}</dt>
                    <dd className={cn("font-medium", row.ltr && "nums")}>
                      {row.ltr ? <span dir="ltr">{row.value}</span> : row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {(!apt.monthly_due_amount || apt.monthly_due_amount <= 0) && (
                <p className="text-xs text-warning">
                  {t("No monthly due set — paid months follow what each payment says it covers, and owed amounts can't be tracked. Click Edit to set one.")}
                </p>
              )}
              <div>
                <p className="text-sm text-muted-foreground">{t("Notes")}</p>
                <p className="whitespace-pre-wrap text-sm">{apt.notes || t("No notes")}</p>
              </div>
            </>
          )}
          <div className="border-t pt-4">
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> {t("Delete Apartment")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Delete Apartment")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("This will permanently delete this apartment and all associated payments. This action cannot be undone.")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>{t("Cancel")}</Button>
            <Button variant="destructive" onClick={remove}>{t("Delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
