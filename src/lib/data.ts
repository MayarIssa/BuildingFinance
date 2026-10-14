import { normalizeOccupancy } from './constants'
import type {
  Apartment,
  Payment,
  Expense,
  ExpenseCategory,
  CategoryPerson,
  YearlyHistory,
  Transfer,
  BuildingSettings,
  Task,
} from './types'

export const DEFAULT_SETTINGS: BuildingSettings = {
  id: '',
  building_name: '',
  total_apartments: 0,
  expected_yearly_income: 0,
  expected_yearly_expenditure: 0,
  num_buildings: 1,
  num_floors: 13,
  mezzanine_floors: 2,
  apartments_per_floor: 0,
  opening_cash: 0,
  opening_bank: 0,
  opening_balance_date: null,
}

// ── Sync error reporting ──
//
// Writes happen in the background after the UI has already updated, so
// a failed insert used to disappear into the console — the payment
// "registered" on screen but was gone after a reload. Every failure now
// flows through this handler; the app shell shows it as a toast.

type SyncErrorHandler = (title: string, message: string) => void
let syncErrorHandler: SyncErrorHandler | null = null

export function onSyncError(handler: SyncErrorHandler | null) {
  syncErrorHandler = handler
}

function reportSyncError(title: string, message: string) {
  console.error(`${title}:`, message)
  syncErrorHandler?.(title, message)
}

// ── API calls ──
//
// All reads and writes go through the app's own /api routes, which talk
// to MongoDB with the signed-in user's session cookie.

async function api(
  method: string,
  path: string,
  body: unknown,
  label: string
): Promise<unknown> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      reportSyncError(label, (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      return null
    }
    return json ?? {}
  } catch (err) {
    reportSyncError(label, err instanceof Error ? err.message : 'Network error')
    return null
  }
}

async function insertRow(collection: string, data: object, label: string): Promise<unknown> {
  return api('POST', `/api/data/${collection}`, data, `${label} was not saved to the database`)
}

async function updateRow(collection: string, id: string, data: object, label: string): Promise<boolean> {
  const res = await api(
    'PATCH',
    `/api/data/${collection}/${encodeURIComponent(id)}`,
    data,
    `${label} changes were not saved to the database`
  )
  return res !== null
}

async function deleteRow(collection: string, id: string, label: string): Promise<boolean> {
  const res = await api(
    'DELETE',
    `/api/data/${collection}/${encodeURIComponent(id)}`,
    undefined,
    `${label} was not deleted from the database`
  )
  return res !== null
}

// ── Row normalizers ──
//
// Rows saved by an older version of the app are missing
// the newer columns — fill them with defaults so the UI never sees
// undefined

function normalizeSettings(row: Partial<BuildingSettings> | null): BuildingSettings {
  return { ...DEFAULT_SETTINGS, ...(row ?? {}) }
}

function normalizeApartment(row: Apartment): Apartment {
  return {
    ...row,
    building_no: row.building_no ?? 1,
    // older rows hold active / traveling_but_paying / mia
    occupancy_status: normalizeOccupancy(row.occupancy_status),
  }
}

function normalizePayment(row: Payment): Payment {
  return {
    ...row,
    recurring: row.recurring ?? false,
    extra: row.extra ?? false,
    on_dashboard: row.on_dashboard ?? true,
  }
}

function normalizeExpense(row: Expense): Expense {
  return {
    ...row,
    recurring: row.recurring ?? false,
    recurring_interval: row.recurring_interval ?? 1,
    paid: row.paid ?? true,
  }
}

function normalizeHistory(row: YearlyHistory): YearlyHistory {
  return {
    ...row,
    income_cash: row.income_cash ?? 0,
    income_bank: row.income_bank ?? 0,
    expenditure_cash: row.expenditure_cash ?? 0,
    expenditure_bank: row.expenditure_bank ?? 0,
    on_dashboard: row.on_dashboard ?? true,
    expense_breakdown: row.expense_breakdown ?? {},
  }
}

function normalizeTransfer(row: Transfer): Transfer {
  return { ...row, on_dashboard: row.on_dashboard ?? true }
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('/api/health')
    return (await res.json()) as { ok: boolean; message: string }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' }
  }
}

type AllDataResponse = {
  apartments: Apartment[]
  payments: Payment[]
  expenses: Expense[]
  expense_categories: ExpenseCategory[]
  category_people: CategoryPerson[]
  yearly_history: YearlyHistory[]
  transfers: Transfer[]
  tasks: Task[]
  building_settings: Partial<BuildingSettings> | null
}

export async function fetchAllData() {
  let res: Response
  try {
    res = await fetch('/api/data', { cache: 'no-store' })
  } catch (err) {
    reportSyncError('Could not load your data', err instanceof Error ? err.message : 'Network error')
    return null
  }
  if (!res.ok) {
    // signed out is handled by the auth guard — don't toast it
    if (res.status !== 401) {
      const json = await res.json().catch(() => null)
      reportSyncError('Could not load your data', json?.error ?? `HTTP ${res.status}`)
    }
    return null
  }
  const d = (await res.json()) as AllDataResponse

  return {
    apartments: d.apartments.map(normalizeApartment),
    payments: d.payments.map(normalizePayment),
    expenses: d.expenses.map(normalizeExpense),
    categories: d.expense_categories,
    people: d.category_people,
    history: d.yearly_history.map(normalizeHistory),
    transfers: d.transfers.map(normalizeTransfer),
    tasks: d.tasks,
    settings: normalizeSettings(d.building_settings as BuildingSettings | null),
  }
}

// ── Apartments ──

// inserts include the client-generated id so local state and the
// database always agree on row identity
export async function insertApartment(data: Omit<Apartment, 'created_at'>) {
  const row = await insertRow('apartments', data, `Apartment ${data.unit_number}`)
  return row ? normalizeApartment(row as Apartment) : null
}

export async function updateApartmentRow(apartment: Apartment) {
  const { id, created_at, ...rest } = apartment
  void created_at
  return updateRow('apartments', id, rest, `Apartment ${apartment.unit_number}`)
}

export async function deleteApartmentRow(id: string) {
  return deleteRow('apartments', id, 'Apartment')
}

// ── Payments ──

export async function insertPayment(data: Omit<Payment, 'created_at'>) {
  const row = await insertRow('payments', data, 'Payment')
  return row ? normalizePayment(row as Payment) : null
}

export async function updatePaymentRow(payment: Payment) {
  const { id, created_at, ...rest } = payment
  void created_at
  return updateRow('payments', id, rest, 'Payment')
}

export async function deletePaymentRow(id: string) {
  return deleteRow('payments', id, 'Payment')
}

// ── Expenses ──

export async function insertExpense(data: Omit<Expense, 'created_at'>) {
  const row = await insertRow('expenses', data, 'Expense')
  return row ? normalizeExpense(row as Expense) : null
}

export async function updateExpenseRow(expense: Expense) {
  const { id, created_at, ...rest } = expense
  void created_at
  return updateRow('expenses', id, rest, 'Expense')
}

export async function deleteExpenseRow(id: string) {
  return deleteRow('expenses', id, 'Expense')
}

// ── Categories ──

export async function insertCategory(cat: ExpenseCategory) {
  const row = await insertRow('expense_categories', cat, `Category ${cat.name}`)
  return row ? (row as ExpenseCategory) : null
}

export async function updateCategoryRow(cat: ExpenseCategory) {
  const { id, ...rest } = cat
  return updateRow('expense_categories', id, rest, `Category ${cat.name}`)
}

export async function deleteCategoryRow(id: string) {
  return deleteRow('expense_categories', id, 'Category')
}

// ── Category people ──

export async function insertPerson(person: CategoryPerson) {
  const row = await insertRow('category_people', person, person.name)
  return row ? (row as CategoryPerson) : null
}

export async function updatePersonRow(person: CategoryPerson) {
  const { id, ...rest } = person
  return updateRow('category_people', id, rest, person.name)
}

export async function deletePersonRow(id: string) {
  return deleteRow('category_people', id, 'Person')
}

// ── Yearly history ──

export async function insertHistory(row: YearlyHistory) {
  const data = await insertRow('yearly_history', row, `Year ${row.year}`)
  return data ? normalizeHistory(data as YearlyHistory) : null
}

export async function updateHistoryRow(row: YearlyHistory) {
  const { id, ...rest } = row
  return updateRow('yearly_history', id, rest, `Year ${row.year}`)
}

export async function deleteHistoryRow(id: string) {
  return deleteRow('yearly_history', id, 'Year')
}

// ── Transfers ──

export async function insertTransfer(data: Omit<Transfer, 'created_at'>) {
  const row = await insertRow('transfers', data, 'Transfer')
  return row ? normalizeTransfer(row as Transfer) : null
}

export async function updateTransferRow(transfer: Transfer) {
  const { id, created_at, ...rest } = transfer
  void created_at
  return updateRow('transfers', id, rest, 'Transfer')
}

export async function deleteTransferRow(id: string) {
  return deleteRow('transfers', id, 'Transfer')
}

// ── Settings ──

export async function updateSettingsRow(data: Partial<BuildingSettings>) {
  const { id, ...rest } = data
  void id
  const res = await api('PATCH', '/api/settings', rest, 'Settings were not saved to the database')
  return res !== null
}

// ── Tasks ──

export async function insertTask(data: Omit<Task, 'created_at' | 'user_id'>): Promise<Task | null> {
  const row = await insertRow('tasks', data, 'Task')
  return row ? (row as Task) : null
}

export async function updateTaskRow(id: string, data: Partial<Omit<Task, 'id' | 'created_at' | 'user_id'>>): Promise<void> {
  await updateRow('tasks', id, data, 'Task')
}

export async function deleteTaskRow(id: string): Promise<void> {
  await deleteRow('tasks', id, 'Task')
}
