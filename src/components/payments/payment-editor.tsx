"use client"

import { useMemo, useState } from "react"
import { useStore } from "@/lib/store"
import { useComputed } from "@/hooks/use-computed"
import { useI18n } from "@/lib/i18n"
import { formatCurrency } from "@/lib/utils"
import { PAYMENT_METHODS, PAYER_RELATIONS, relationLabel } from "@/lib/constants"
import { parseAmount } from "@/lib/csv"
import { allocatePayments, computeMonthCell, remainingForMonth } from "@/lib/computations"
import {
  monthKey,
  monthKeyOrNull,
  currentMonthKey,
  addMonthsToKey,
  monthsBetween,
  firstDayOfMonth,
  lastDayOfMonth,
  monthRangeLabel,
  isValidMonthKey,
} from "@/lib/months"
import type { Apartment, Payment, PaymentMethod, PayerRelation } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CreatableSelect } from "@/components/ui/creatable-select"

// natural sort: unit "2" before unit "10"
export const unitCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })

const emptyPaymentForm = () => ({
  apartment_id: "",
  payer_name: "",
  payer_relation: "" as PayerRelation,
  amount: "",
  method: "cash" as PaymentMethod,
  date_paid: new Date().toISOString().split("T")[0],
  from_month: currentMonthKey(),
  months_count: "1",
  recurring: false,
  // extra = money not tied to months (e.g. settling last year's dues)
  extra: false,
  on_dashboard: true,
  notes: "",
})

/**
 * Add / edit / delete payments. Returns openers plus the dialogs to
 * render once on the page.
 */
export function usePaymentEditor() {
  const { state, addPayment, updatePayment, deletePayment } = useStore()
  const { getCoverage } = useComputed()
  const { toast } = useToast()
  const { t, lang } = useI18n()
  const monthList = (keys: string[]) =>
    keys
      .map((k) => {
        const [y, m] = k.split("-").map(Number)
        return new Date(y, m - 1, 1).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { month: "short", year: "numeric" })
      })
      .join(lang === "ar" ? "، " : ", ")
  const monthName = (k: string) => monthList([k])

  // Month-by-month money for one unit, without the collection being
  // edited: what each month already holds against the monthly due
  function allocationFor(aptId: string, excludeId?: string) {
    const apt = state.apartments.find((a) => a.id === aptId)
    const due = apt?.monthly_due_amount ?? 0
    const base = state.payments.filter((p) => p.apartment_id === aptId && !p.extra && p.id !== excludeId)
    return { due, base, alloc: allocatePayments(base, due) }
  }

  // what's still needed to fully pay `count` months from `from`
  // (a half-paid month only asks for its rest)
  function expectedFor(aptId: string, from: string, count: number, excludeId?: string): number {
    const { due, alloc } = allocationFor(aptId, excludeId)
    if (due <= 0 || !isValidMonthKey(from)) return 0
    let sum = 0
    for (let i = 0; i < count; i++) sum += remainingForMonth(alloc, due, addMonthsToKey(from, i))
    return Math.round(sum * 100) / 100
  }

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyPaymentForm)
  const [editing, setEditing] = useState<Payment | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // relation choices: built-ins plus any custom relation already saved on a
  // payment, so a one-off "Add relation…" value stays available afterwards
  const relationOptions = useMemo(() => {
    const known = new Set(PAYER_RELATIONS.map((r) => r.value))
    const custom = new Set<string>()
    for (const p of state.payments) {
      const r = (p.payer_relation || "").trim()
      if (r && !known.has(r)) custom.add(r)
    }
    return [
      ...PAYER_RELATIONS.map((r) => ({ value: r.value, label: r.label })),
      ...Array.from(custom).sort().map((r) => ({ value: r, label: relationLabel(r) })),
    ]
  }, [state.payments])

  // prefilled for one apartment: the from-month defaults to the month
  // after the last fully paid month
  function openAdd(apt: Apartment | null) {
    const cov = apt ? getCoverage(apt.id) : undefined
    const due = apt?.monthly_due_amount ?? 0
    setEditing(null)
    setForm({
      ...emptyPaymentForm(),
      apartment_id: apt?.id ?? "",
      payer_name: apt?.primary_resident_name ?? "",
      from_month: cov?.nextUnpaidMonth ?? currentMonthKey(),
      amount: apt && due > 0 ? String(expectedFor(apt.id, cov?.nextUnpaidMonth ?? currentMonthKey(), 1) || due) : "",
    })
    setOpen(true)
  }

  function openEdit(p: Payment) {
    const fromKey = monthKeyOrNull(p.period_start) ?? monthKey(p.date_paid)
    const endKey = monthKeyOrNull(p.period_end) ?? fromKey
    setEditing(p)
    setForm({
      apartment_id: p.apartment_id,
      payer_name: p.payer_name,
      payer_relation: p.payer_relation ?? "",
      amount: String(p.amount),
      method: p.method,
      date_paid: p.date_paid,
      from_month: fromKey,
      months_count: String(Math.max(1, monthsBetween(fromKey, endKey) + 1)),
      recurring: p.recurring ?? false,
      extra: p.extra ?? false,
      on_dashboard: p.on_dashboard ?? true,
      notes: p.notes,
    })
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setEditing(null)
  }

  function submit() {
    const amount = parseAmount(form.amount)
    const count = Math.max(1, parseInt(form.months_count) || 1)

    // say exactly what's missing instead of silently doing nothing
    if (!form.apartment_id) {
      toast({ title: t("Select an apartment"), description: t("The payment needs an apartment."), variant: "destructive" })
      return
    }
    if (isNaN(amount) || amount <= 0) {
      toast({ title: t("Enter a valid amount"), description: t("The amount must be a number greater than zero."), variant: "destructive" })
      return
    }
    if (!form.date_paid) {
      toast({ title: t("Pick a payment date"), description: t("The date paid is required."), variant: "destructive" })
      return
    }
    if (!form.extra && !isValidMonthKey(form.from_month)) {
      toast({ title: t("Pick the first month paid"), description: t("Choose which month this payment covers, or switch on “Extra payment” for money not tied to months."), variant: "destructive" })
      return
    }

    // a fully paid month can't be collected again (the form says why and
    // the button is disabled; a half-paid month takes the rest)
    if (alreadyPaid.length) return

    // extra payments aren't tied to months: pin the period to the
    // payment date's month; the coverage engine skips them anyway
    const fromMonth = form.extra ? monthKey(form.date_paid) : form.from_month
    const endMonth = form.extra ? fromMonth : addMonthsToKey(form.from_month, count - 1)
    const fields = {
      apartment_id: form.apartment_id,
      payer_name: form.payer_name,
      payer_relation: form.payer_relation,
      amount,
      method: form.method,
      date_paid: form.date_paid,
      period_start: firstDayOfMonth(fromMonth),
      period_end: lastDayOfMonth(endMonth),
      recurring: form.extra ? false : form.recurring,
      extra: form.extra,
      on_dashboard: form.on_dashboard,
      notes: form.notes,
    }

    if (editing) updatePayment({ ...editing, ...fields })
    else addPayment(fields)

    // tell what the money did: a month left partial, or money that rolled
    // into the next month(s)
    const spilled = plan.filter((l) => l.where === "later")
    const partial = plan.filter((l) => !l.full)
    if (spilled.length || partial.length || plan.some((l) => l.where === "earlier")) {
      const lines = plan
        .filter((l) => l.where !== "chosen" || !l.full)
        .map((l) =>
          l.full
            ? t(l.where === "earlier" ? "{month}: completed" : "{month}: paid in full", { month: monthName(l.key) })
            : t("{month}: {paid} of {due} — partial, {left} still needed", {
                month: monthName(l.key),
                paid: formatCurrency(l.total),
                due: formatCurrency(due),
                left: formatCurrency(due - l.total),
              })
        )
      toast({
        title: spilled.length
          ? t("Additional {amount} for the next month", { amount: formatCurrency(spilled.reduce((s, l) => s + l.added, 0)) })
          : partial.length
            ? t("Partial collection")
            : t("Collection saved"),
        description: lines.join(" · "),
        variant: "success",
        duration: 10000,
      })
    }

    // without a monthly due the coverage engine can't compute owed
    // amounts — nudge once per save so the user knows why
    const apt = state.apartments.find((a) => a.id === form.apartment_id)
    if (apt && (!apt.monthly_due_amount || apt.monthly_due_amount <= 0) && !form.extra) {
      toast({
        title: t("Tip: set a monthly due amount"),
        description: t("Unit {unit} has no monthly due, so paid months come from what each payment says it covers. Set a monthly due (open the apartment → Edit) to track owed amounts automatically.", { unit: apt.unit_number }),
      })
    }

    close()
    setForm(emptyPaymentForm())
  }

  const selApt = state.apartments.find((a) => a.id === form.apartment_id)
  const due = selApt?.monthly_due_amount ?? 0
  const count = Math.max(1, parseInt(form.months_count) || 1)
  const endMonth = isValidMonthKey(form.from_month) ? addMonthsToKey(form.from_month, count - 1) : form.from_month

  const typedAmount = parseAmount(form.amount)
  const selectedMonths =
    !form.extra && isValidMonthKey(form.from_month)
      ? Array.from({ length: count }, (_, i) => addMonthsToKey(form.from_month, i))
      : []

  // what this collection would do, month by month: the money each month
  // gets, its total afterwards, and whether it lands past the chosen months
  const { alloc: before, base } = form.apartment_id
    ? allocationFor(form.apartment_id, editing?.id)
    : { alloc: new Map(), base: [] }
  // where: before the chosen months (tops up an earlier short month),
  // one of the chosen months, or after them (additional for next months)
  const plan: { key: string; added: number; total: number; full: boolean; where: "earlier" | "chosen" | "later" }[] = []
  if (due > 0 && selectedMonths.length && !isNaN(typedAmount) && typedAmount > 0) {
    const after = allocatePayments(
      [
        ...base,
        {
          amount: typedAmount,
          method: form.method,
          period_start: firstDayOfMonth(form.from_month),
          date_paid: form.date_paid || new Date().toISOString().slice(0, 10),
          created_at: "\uffff", // after everything already saved
        },
      ],
      due
    )
    for (const [key, share] of [...after.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const added = Math.round((share.amount - (before.get(key)?.amount ?? 0)) * 100) / 100
      if (added <= 0.005) continue
      plan.push({
        key,
        added,
        total: share.amount,
        full: share.amount >= due - 0.005,
        where: key < selectedMonths[0] ? "earlier" : selectedMonths.includes(key) ? "chosen" : "later",
      })
    }
  }

  // the unit's standing before this collection: months still short up to
  // now, and money already put toward later months
  const nowKey = currentMonthKey()
  const beforeKeys = [...before.keys()].sort()
  const unpaidBefore: { key: string; left: number }[] = []
  const paidAheadMonths: { key: string; paid: number }[] = []
  if (due > 0 && form.apartment_id) {
    const start = beforeKeys[0]
    if (start) {
      for (let k = start, g = 0; k <= nowKey && g < 240; k = addMonthsToKey(k, 1), g++) {
        const left = remainingForMonth(before, due, k)
        if (left > 0) unpaidBefore.push({ key: k, left })
      }
    }
    for (const k of beforeKeys) if (k > nowKey) paidAheadMonths.push({ key: k, paid: before.get(k)!.amount })
  }
  const unpaidTotal = unpaidBefore.reduce((sum, m) => sum + m.left, 0)
  const aheadTotal = paidAheadMonths.reduce((sum, m) => sum + m.paid, 0)

  // chosen months that are already fully collected
  const alreadyPaid = (() => {
    if (!form.apartment_id || !selectedMonths.length) return []
    if (due > 0) return selectedMonths.filter((k) => remainingForMonth(before, due, k) <= 0)
    if (editing) return []
    const cov = getCoverage(form.apartment_id)
    return cov ? selectedMonths.filter((k) => computeMonthCell(cov, k) === "paid") : []
  })()

  // first month that still needs money — offered instead of a paid one
  const firstOpenMonth = (() => {
    if (due <= 0) return form.apartment_id ? getCoverage(form.apartment_id)?.nextUnpaidMonth ?? null : null
    let k = beforeKeys[0] ?? currentMonthKey()
    for (let g = 0; g < 1200 && remainingForMonth(before, due, k) <= 0; g++) k = addMonthsToKey(k, 1)
    return k
  })()

  // still needed for the chosen months (only the rest of a half-paid one)
  const expected = form.apartment_id && due > 0 ? expectedFor(form.apartment_id, form.from_month, count, editing?.id) : 0

  const dialogs = (
    <>
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Delete Payment")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("This will permanently remove this payment entry. This action cannot be undone.")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t("Cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) deletePayment(deleteId)
                setDeleteId(null)
              }}
            >
              {t("Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("Edit Payment") : t("Add Payment")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label>{t("Apartment")} *</Label>
              <Select
                value={form.apartment_id}
                onValueChange={(v) => {
                  const apt = state.apartments.find((a) => a.id === v)
                  const cov = getCoverage(v)
                  const aptDue = apt?.monthly_due_amount ?? 0
                  setForm({
                    ...form,
                    apartment_id: v,
                    payer_name: apt?.primary_resident_name || form.payer_name,
                    // default the months to continue after the last paid month
                    from_month: editing ? form.from_month : (cov?.nextUnpaidMonth ?? currentMonthKey()),
                    amount: editing
                      ? form.amount
                      : aptDue > 0
                        ? String(expectedFor(v, cov?.nextUnpaidMonth ?? currentMonthKey(), count) || aptDue * count)
                        : form.amount,
                  })
                }}
              >
                <SelectTrigger><SelectValue placeholder={t("Select apartment")} /></SelectTrigger>
                <SelectContent>
                  {[...state.apartments].sort((a, b) => unitCompare(a.unit_number, b.unit_number)).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.unit_number} — {a.primary_resident_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(unpaidBefore.length > 0 || paidAheadMonths.length > 0) && (
              <div className="-mt-2 space-y-1.5 rounded-md border border-border p-2 text-xs">
                {unpaidBefore.length > 0 && (
                  <p className="text-red-700 dark:text-red-400">
                    <span className="font-semibold">{t("Still unpaid: {amount}", { amount: formatCurrency(unpaidTotal) })}</span>
                    {" — "}
                    {unpaidBefore
                      .slice(0, 6)
                      .map((m) => (m.left < due ? t("{month} ({left} left)", { month: monthName(m.key), left: formatCurrency(m.left) }) : monthName(m.key)))
                      .join(lang === "ar" ? "، " : ", ")}
                    {unpaidBefore.length > 6 && " …"}
                  </p>
                )}
                {paidAheadMonths.length > 0 && (
                  <p className="text-emerald-700 dark:text-emerald-400">
                    <span className="font-semibold">{t("Paid ahead: {amount}", { amount: formatCurrency(aheadTotal) })}</span>
                    {" — "}
                    {paidAheadMonths
                      .map((m) => (m.paid >= due - 0.005 ? monthName(m.key) : t("{month} ({paid} of {due})", { month: monthName(m.key), paid: formatCurrency(m.paid), due: formatCurrency(due) })))
                      .join(lang === "ar" ? "، " : ", ")}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("Payer Name")}</Label>
                <Input value={form.payer_name} onChange={(e) => setForm({ ...form, payer_name: e.target.value })} />
              </div>
              <div>
                <Label>{t("Relation to Resident")}</Label>
                <CreatableSelect
                  placeholder={t("Optional")}
                  createLabel={t("Add relation…")}
                  inputPlaceholder="e.g. Cousin"
                  capitalize
                  value={form.payer_relation}
                  options={relationOptions}
                  onCreate={(name) => name.toLowerCase()}
                  onValueChange={(v) => setForm({ ...form, payer_relation: v as PayerRelation })}
                />
              </div>
            </div>
            {/* extra payments aren't tied to months, so skip the month fields */}
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>{t("Extra payment (not tied to months)")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("For money like last year's dues paid now — it won't mark any month as paid")}
                  </p>
                </div>
                <Switch
                  checked={form.extra}
                  onCheckedChange={(v) => setForm({ ...form, extra: v, recurring: v ? false : form.recurring })}
                />
              </div>
              {form.extra && (
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div>
                    <Label>{t("Count on dashboard")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("Off = the money stays out of every dashboard total")}
                    </p>
                  </div>
                  <Switch checked={form.on_dashboard} onCheckedChange={(v) => setForm({ ...form, on_dashboard: v })} />
                </div>
              )}
            </div>
            {!form.extra && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{t("First Month Paid")} *</Label>
                    <Input
                      type="month"
                      value={form.from_month}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          from_month: e.target.value,
                          amount:
                            !editing && due > 0 && isValidMonthKey(e.target.value)
                              ? String(expectedFor(form.apartment_id, e.target.value, count) || due * count)
                              : form.amount,
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>{t("Number of Months")}</Label>
                    <Input
                      type="number"
                      min="1"
                      max="24"
                      value={form.months_count}
                      onChange={(e) => {
                        const c = Math.max(1, parseInt(e.target.value) || 1)
                        setForm({
                          ...form,
                          months_count: e.target.value,
                          amount: !editing && due > 0 ? String(expectedFor(form.apartment_id, form.from_month, c) || due * c) : form.amount,
                        })
                      }}
                    />
                  </div>
                </div>
                {isValidMonthKey(form.from_month) && (
                  <p className="-mt-2 text-xs text-muted-foreground">
                    {t("Covers:")} {monthRangeLabel(form.from_month, endMonth)}
                    {due > 0 && ` · ${t("expected")} ${formatCurrency(expected)}`}
                    {due > 0 && expected > 0 && expected < due * count && ` (${t("rest of a partly paid month")})`}
                  </p>
                )}
                {alreadyPaid.length > 0 && (
                  <div role="alert" className="-mt-2 space-y-1.5 rounded-md bg-red-50 p-2 text-xs font-medium text-red-800 dark:bg-red-950/40 dark:text-red-200">
                    <p>{t("{months} is already fully paid — it can't be collected again.", { months: monthList(alreadyPaid) })}</p>
                    {firstOpenMonth && !alreadyPaid.includes(firstOpenMonth) && (
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() =>
                          setForm({
                            ...form,
                            from_month: firstOpenMonth,
                            amount: due > 0 ? String(expectedFor(form.apartment_id, firstOpenMonth, count, editing?.id) || due * count) : form.amount,
                          })
                        }
                      >
                        {t("Use the next unpaid month: {month}", { month: monthName(firstOpenMonth) })}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("Amount")} *</Label>
                {/* free-typing text input (numeric keypad on mobile) */}
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />

              </div>
              <div>
                <Label>{t("Method")}</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as PaymentMethod })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{t(m.label)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {alreadyPaid.length === 0 && plan.length > 0 && (plan.some((l) => l.where !== "chosen" || !l.full) || plan.length > 1) && (
              <ul className="-mt-2 space-y-1 rounded-md bg-muted/60 p-2 text-xs">
                {plan.map((l) => (
                  <li key={l.key} className={l.where === "later" ? "font-medium text-emerald-700 dark:text-emerald-400" : l.full ? "" : "text-amber-700 dark:text-amber-400"}>
                    {l.where === "later" && `${t("Additional for next month")} · `}
                    {l.where === "earlier" && `${t("Completes an earlier month")} · `}
                    {monthName(l.key)}: +{formatCurrency(l.added)}
                    {" — "}
                    {l.full
                      ? t("paid in full")
                      : t("partial, {left} still needed", { left: formatCurrency(due - l.total) })}
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Label>{t("Date Paid")} *</Label>
              <Input type="date" value={form.date_paid} onChange={(e) => setForm({ ...form, date_paid: e.target.value })} />
            </div>
            {!form.extra && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label>{t("Repeat monthly")}</Label>
                  <p className="text-xs text-muted-foreground">{t("Automatically add this payment again each month")}</p>
                </div>
                <Switch checked={form.recurring} onCheckedChange={(v) => setForm({ ...form, recurring: v })} />
              </div>
            )}
            <div>
              <Label>{t("Notes")}</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>{t("Cancel")}</Button>
            <Button onClick={submit} disabled={alreadyPaid.length > 0}>{editing ? t("Save Changes") : t("Add Payment")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return { openAdd, openEdit, requestDelete: setDeleteId, dialogs }
}
