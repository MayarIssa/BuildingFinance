import {
  monthKey,
  monthKeyOrNull,
  currentMonthKey,
  addMonthsToKey,
  monthsBetween,
  firstDayOfMonth,
} from './months'
import type {
  Apartment,
  Payment,
  Expense,
  Transfer,
  YearlyHistory,
  PaymentStatus,
  OccupancyBreakdown,
} from './types'

// ── Month coverage engine ──
//
// With a monthly due, months are paid by money actually received: the
// unit's money fills its months oldest first, each up to the monthly due
// (see allocatePayments). A month is paid once it holds the full due; 200
// of 450 leaves it partial until the next money tops it up, and anything
// above the due rolls into the following months.
//
// When no monthly due is configured the money engine has nothing to
// divide by, so coverage falls back to the months payments explicitly
// claim (period_start..period_end) — otherwise recorded payments would
// be invisible in the grids.

export interface ApartmentCoverage {
  // first tracked month, null when nothing is tracked
  startKey: string | null
  totalPaid: number
  // whole months covered by the money received
  fullMonthsPaid: number
  // last fully covered month (can be in the future when paid in advance)
  lastPaidMonth: string | null
  // the month the next payment refers to
  nextUnpaidMonth: string | null
  amountOwed: number
  status: PaymentStatus
  daysOverdue: number
  // set only in claims mode (no monthly due configured): the exact
  // months payments say they cover, gaps allowed
  claimedMonths: Set<string> | null
  // money mode: how much has been put toward each month (see
  // allocatePayments); empty in claims mode
  allocation: Map<string, MonthShare>
  // the monthly due the allocation was made against (0 in claims mode)
  due: number
  // money already put toward months after the current one
  paidAhead: number
}

// One month's share of the money: total put toward it and per method
export interface MonthShare {
  amount: number
  bank: number
  cash: number
  last: Payment['method']
}

const CENT = 0.005
const round2 = (n: number) => Math.round(n * 100) / 100

// Money mode allocation: all of a unit's money fills its months oldest
// first, each month up to the monthly due, starting at the earliest month
// any payment refers to. So a month left short (400 of 450) is completed
// by the next money received, and anything beyond that rolls on to the
// following months. Money is poured in the order it was received, which
// also decides which method (bank / cash) paid each month.
export function allocatePayments(
  payments: Pick<Payment, 'amount' | 'method' | 'period_start' | 'date_paid' | 'created_at'>[],
  due: number
): Map<string, MonthShare> {
  const alloc = new Map<string, MonthShare>()
  if (!due || due <= 0 || payments.length === 0) return alloc
  let key: string | null = null
  for (const p of payments) {
    const k = monthKeyOrNull(p.period_start) ?? monthKey(p.date_paid)
    if (key === null || k < key) key = k
  }
  const ordered = [...payments].sort(
    (a, b) =>
      (a.date_paid || '').localeCompare(b.date_paid || '') ||
      (a.created_at || '').localeCompare(b.created_at || '')
  )
  let k = key as string
  for (const p of ordered) {
    let left = round2(p.amount)
    let guard = 0
    while (left > CENT && guard < 1200) {
      const cur = alloc.get(k) ?? { amount: 0, bank: 0, cash: 0, last: p.method }
      const put = Math.min(round2(due - cur.amount), left)
      if (put > CENT) {
        cur.amount = round2(cur.amount + put)
        cur[p.method] = round2(cur[p.method] + put)
        cur.last = p.method
        alloc.set(k, cur)
        left = round2(left - put)
      }
      if (cur.amount >= due - CENT) k = addMonthsToKey(k, 1)
      guard++
    }
  }
  return alloc
}

// How much a month still needs to be fully paid
export function remainingForMonth(alloc: Map<string, MonthShare>, due: number, key: string): number {
  return Math.max(0, round2(due - (alloc.get(key)?.amount ?? 0)))
}

export function computeCoverage(
  apartment: Apartment,
  allPayments: Payment[],
  now: Date = new Date()
): ApartmentCoverage {
  // extra payments (settling old, untracked dues) never advance the
  // month coverage
  const payments = allPayments.filter((p) => !p.extra)
  const due = apartment.monthly_due_amount
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0)

  if (!due || due <= 0) {
    // no monthly due configured — fall back to the months the payments
    // themselves claim to cover so they still show up
    return computeClaimedCoverage(payments, totalPaid, now)
  }

  const allocation = allocatePayments(payments, due)
  const isPaid = (k: string) => (allocation.get(k)?.amount ?? 0) >= due - CENT

  // earliest month money went to; fallback to the month the apartment was
  // registered
  let startKey: string | null = null
  for (const k of allocation.keys()) if (startKey === null || k < startKey) startKey = k
  if (startKey === null) {
    startKey = monthKeyOrNull(apartment.created_at) ?? monthKey(now)
  }

  const currentKey = monthKey(now)
  let fullMonthsPaid = 0
  for (const k of allocation.keys()) if (isPaid(k)) fullMonthsPaid++

  // first month from the start that isn't fully paid; months before it
  // form the unbroken paid run
  let nextUnpaidMonth = startKey
  for (let guard = 0; isPaid(nextUnpaidMonth) && guard < 1200; guard++) {
    nextUnpaidMonth = addMonthsToKey(nextUnpaidMonth, 1)
  }
  const lastPaidMonth = nextUnpaidMonth === startKey ? null : addMonthsToKey(nextUnpaidMonth, -1)

  // what's still missing from the start month through the current month
  let amountOwed = 0
  let owedBeforeCurrent = 0
  for (let k = startKey, guard = 0; k <= currentKey && guard < 1200; k = addMonthsToKey(k, 1), guard++) {
    const missing = remainingForMonth(allocation, due, k)
    amountOwed += missing
    if (k < currentKey) owedBeforeCurrent += missing
  }
  amountOwed = round2(amountOwed)

  let status: PaymentStatus
  if (amountOwed <= CENT) {
    status = 'paid'
  } else if (owedBeforeCurrent <= CENT) {
    // only the current month is outstanding (fully or partially)
    status = 'due_soon'
  } else {
    status = 'overdue'
  }

  let daysOverdue = 0
  if (status === 'overdue') {
    const firstUnpaid = new Date(firstDayOfMonth(nextUnpaidMonth))
    daysOverdue = Math.max(
      0,
      Math.floor((now.getTime() - firstUnpaid.getTime()) / 86_400_000)
    )
  }

  return {
    startKey,
    totalPaid,
    fullMonthsPaid,
    lastPaidMonth,
    nextUnpaidMonth,
    amountOwed,
    status,
    daysOverdue,
    claimedMonths: null,
    allocation,
    due,
    paidAhead: round2([...allocation].reduce((sum, [k, v]) => (k > currentKey ? sum + v.amount : sum), 0)),
  }
}

// Claims-mode coverage for apartments without a monthly due: months are
// paid exactly when a payment says it covers them. The amount owed
// cannot be computed (there is no due to multiply), so it stays 0 and
// the status only reflects whether the claims have lapsed.
function computeClaimedCoverage(
  payments: Payment[],
  totalPaid: number,
  now: Date
): ApartmentCoverage {
  const claimed = new Set<string>()
  for (const p of payments) {
    const start = monthKeyOrNull(p.period_start)
    if (!start) continue
    const end = monthKeyOrNull(p.period_end) ?? start
    let k = start
    let guard = 0
    while (k <= end && guard < 120) {
      claimed.add(k)
      k = addMonthsToKey(k, 1)
      guard++
    }
  }

  if (claimed.size === 0) {
    return {
      startKey: null,
      totalPaid,
      fullMonthsPaid: 0,
      lastPaidMonth: null,
      nextUnpaidMonth: null,
      amountOwed: 0,
      status: 'paid',
      daysOverdue: 0,
      claimedMonths: null,
      allocation: new Map(),
      due: 0,
      paidAhead: 0,
    }
  }

  const keys = [...claimed].sort()
  const startKey = keys[0]
  const lastPaidMonth = keys[keys.length - 1]
  const nextUnpaidMonth = addMonthsToKey(lastPaidMonth, 1)
  const currentKey = monthKey(now)
  const monthsBehind = Math.max(0, monthsBetween(lastPaidMonth, currentKey))

  let status: PaymentStatus
  if (monthsBehind <= 0) status = 'paid'
  else if (monthsBehind === 1) status = 'due_soon'
  else status = 'overdue'

  let daysOverdue = 0
  if (status === 'overdue') {
    const firstUnpaid = new Date(firstDayOfMonth(nextUnpaidMonth))
    daysOverdue = Math.max(
      0,
      Math.floor((now.getTime() - firstUnpaid.getTime()) / 86_400_000)
    )
  }

  return {
    startKey,
    totalPaid,
    fullMonthsPaid: claimed.size,
    lastPaidMonth,
    nextUnpaidMonth,
    amountOwed: 0,
    status,
    daysOverdue,
    claimedMonths: claimed,
    allocation: new Map(),
    due: 0,
    paidAhead: 0,
  }
}

// Cell state for the visual month grid
export type MonthCellStatus = 'paid' | 'due' | 'future' | 'na'

export function computeMonthCell(
  coverage: ApartmentCoverage,
  key: string,
  now: Date = new Date()
): MonthCellStatus {
  if (!coverage.startKey) return 'na'
  if (key < coverage.startKey) return 'na'
  if (coverage.claimedMonths) {
    // claims mode: exactly the claimed months are paid, gaps allowed
    if (coverage.claimedMonths.has(key)) return 'paid'
    if (key <= monthKey(now)) return 'due'
    return 'future'
  }
  if ((coverage.allocation.get(key)?.amount ?? 0) >= coverage.due - CENT) return 'paid'
  if (key <= monthKey(now)) return 'due'
  return 'future'
}

// Starting balances entered on first use (Building Setup). Everything dated
// before opening_balance_date is already inside these amounts.
export interface OpeningBalance {
  opening_cash?: number
  opening_bank?: number
  opening_balance_date?: string | null
}

// Whether a record dated `date` still moves the balances: on or after the
// starting-balance date, or always when no date is set
export function countsTowardBalance(date: string, opening?: OpeningBalance): boolean {
  const from = opening?.opening_balance_date
  return !from || (date ?? '').slice(0, 10) >= from
}

// Starting cash + bank, plus migrated prior years that come after the
// starting-balance date (earlier years are already in the starting amounts)
export function openingAmount(method: 'cash' | 'bank' | 'total', opening?: OpeningBalance, history: YearlyHistory[] = []): number {
  const fromYear = opening?.opening_balance_date ? parseInt(opening.opening_balance_date.slice(0, 4), 10) : -Infinity
  const start =
    method === 'cash' ? opening?.opening_cash ?? 0
    : method === 'bank' ? opening?.opening_bank ?? 0
    : (opening?.opening_cash ?? 0) + (opening?.opening_bank ?? 0)
  const carried = history
    .filter((h) => h.on_dashboard !== false && h.year >= fromYear)
    .reduce((sum, h) => {
      const cash = (h.income_cash ?? 0) - (h.expenditure_cash ?? 0)
      const bank = (h.income_bank ?? 0) - (h.expenditure_bank ?? 0)
      return sum + (method === 'cash' ? cash : method === 'bank' ? bank : cash + bank)
    }, 0)
  return start + carried
}

// Cash and bank balances: the starting balance, plus everything received
// minus everything spent per method, moved by transfers, plus what
// migrated prior years carry in via their cash/bank splits
export function computeBalance(
  method: 'cash' | 'bank',
  payments: Payment[],
  expenses: Expense[],
  transfers: Transfer[] = [],
  history: YearlyHistory[] = [],
  opening?: OpeningBalance
): number {
  payments = payments.filter((p) => countsTowardBalance(p.date_paid, opening))
  expenses = expenses.filter((e) => countsTowardBalance(e.date, opening))
  transfers = transfers.filter((t) => countsTowardBalance(t.date, opening))

  const moneyIn = payments
    .filter((p) => p.method === method)
    .reduce((sum, p) => sum + p.amount, 0)

  // unpaid expenses are still owed, not yet spent — they never reduce a
  // balance until marked paid
  const moneyOut = expenses
    .filter((e) => e.method === method && e.paid !== false)
    .reduce((sum, e) => sum + e.amount, 0)

  const transferred = transfers
    .filter((t) => t.on_dashboard !== false)
    .reduce((sum, t) => {
      if (t.to_method === method && t.from_method !== method) return sum + t.amount
      if (t.from_method === method && t.to_method !== method) return sum - t.amount
      return sum
    }, 0)

  return openingAmount(method, opening, history) + moneyIn - moneyOut + transferred
}

export function computeCashOnHand(
  payments: Payment[],
  expenses: Expense[],
  transfers: Transfer[] = [],
  history: YearlyHistory[] = [],
  opening?: OpeningBalance
): number {
  return computeBalance('cash', payments, expenses, transfers, history, opening)
}

export function computeBankBalance(
  payments: Payment[],
  expenses: Expense[],
  transfers: Transfer[] = [],
  history: YearlyHistory[] = [],
  opening?: OpeningBalance
): number {
  return computeBalance('bank', payments, expenses, transfers, history, opening)
}

// month checks compare the date strings directly ('YYYY-MM-DD') so a
// payment logged on the 1st never slips into the previous month through
// timezone conversion
export function computeCollectedThisMonth(payments: Payment[]): number {
  const nowKey = currentMonthKey()
  return payments
    .filter((p) => monthKeyOrNull(p.date_paid) === nowKey)
    .reduce((sum, p) => sum + p.amount, 0)
}

export function computeSpentThisMonth(expenses: Expense[]): number {
  const nowKey = currentMonthKey()
  return expenses
    .filter((e) => e.paid !== false && monthKeyOrNull(e.date) === nowKey)
    .reduce((sum, e) => sum + e.amount, 0)
}

export function computeOccupancyBreakdown(
  apartments: Apartment[],
  totalApartments: number
): OccupancyBreakdown {
  const count = (s: Apartment['occupancy_status']) =>
    apartments.filter((a) => a.occupancy_status === s).length

  const registeredCount = apartments.length
  const unregistered = Math.max(totalApartments - registeredCount, 0)

  return {
    resident: count('resident'),
    non_resident: count('non_resident'),
    unknown: count('unknown'),
    unregistered,
  }
}

// ── Which method paid each month ──
//
// The grids mark a paid month B (bank) or C (cash). With a monthly due,
// a month takes the methods of the money allocated to it (see
// allocatePayments). Without a due (claims mode) a
// month takes the payments that say they cover it. When both methods paid
// toward one month, the one that paid more of it wins; on a tie, the
// later payment's method.

export type MonthMethod = 'B' | 'C'

type Tally = { bank: number; cash: number; last: Payment['method'] }

function tally(map: Map<string, Tally>, key: string, method: Payment['method'], amount: number) {
  const t = map.get(key) ?? { bank: 0, cash: 0, last: method }
  t[method] += amount
  t.last = method
  map.set(key, t)
}

export function computeMonthMethods(
  apartment: Apartment,
  allPayments: Payment[],
  coverage: ApartmentCoverage
): Map<string, MonthMethod> {
  const tallies = new Map<string, Tally>()
  const payments = [...allPayments.filter((p) => !p.extra)].sort(
    (a, b) =>
      a.date_paid.localeCompare(b.date_paid) ||
      (a.created_at || '').localeCompare(b.created_at || '')
  )
  const due = apartment.monthly_due_amount

  if (!due || due <= 0 || coverage.claimedMonths) {
    for (const p of payments) {
      const start = monthKeyOrNull(p.period_start)
      if (!start) continue
      const end = monthKeyOrNull(p.period_end) ?? start
      const months: string[] = []
      let k = start
      let guard = 0
      while (k <= end && guard < 120) {
        months.push(k)
        k = addMonthsToKey(k, 1)
        guard++
      }
      for (const m of months) tally(tallies, m, p.method, p.amount / months.length)
    }
  } else {
    // fully paid months take the methods of the money allocated to them
    for (const [key, share] of coverage.allocation) {
      if (share.amount < due - CENT) continue
      tallies.set(key, { bank: share.bank, cash: share.cash, last: share.last })
    }
  }

  const map = new Map<string, MonthMethod>()
  for (const [key, t] of tallies) {
    const winner = t.bank > t.cash ? 'bank' : t.cash > t.bank ? 'cash' : t.last
    map.set(key, winner === 'bank' ? 'B' : 'C')
  }
  return map
}
