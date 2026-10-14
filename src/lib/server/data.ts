import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Sort } from 'mongodb'
import { getDb, DATA_COLLECTIONS, type DataCollection } from './mongo'
import { cleanRecord } from './api'

const SORTS: Record<DataCollection, Sort> = {
  apartments: { unit_number: 1 },
  payments: { date_paid: -1 },
  expenses: { date: -1 },
  expense_categories: { name: 1 },
  category_people: { name: 1 },
  yearly_history: { year: 1 },
  transfers: { date: -1 },
  tasks: { created_at: -1 },
}

// Collections whose rows carry a created_at timestamp
const HAS_CREATED_AT = new Set<DataCollection>(['apartments', 'payments', 'expenses', 'transfers', 'tasks'])

// Child rows removed along with their parent (mirrors the store reducer)
const CASCADES: Partial<Record<DataCollection, { collection: DataCollection; field: string }[]>> = {
  apartments: [{ collection: 'payments', field: 'apartment_id' }],
  expense_categories: [
    { collection: 'category_people', field: 'category_id' },
    { collection: 'expenses', field: 'category_id' },
  ],
}

const NO_ID = { projection: { _id: 0 } }

export async function fetchAll(userId: string) {
  const db = await getDb()
  const lists = await Promise.all(
    DATA_COLLECTIONS.map((c) =>
      db.collection(c).find({ user_id: userId }, NO_ID).sort(SORTS[c]).toArray()
    )
  )
  const settings = await db.collection('building_settings').findOne({ user_id: userId }, NO_ID)
  const data = Object.fromEntries(DATA_COLLECTIONS.map((c, i) => [c, lists[i]])) as unknown as Record<
    DataCollection,
    Record<string, unknown>[]
  >
  return { ...data, building_settings: settings }
}

export async function insertRecord(userId: string, collection: DataCollection, input: Record<string, unknown>) {
  const doc = cleanRecord(input)
  if (typeof doc.id !== 'string' || !doc.id) doc.id = randomUUID()
  if (HAS_CREATED_AT.has(collection) && typeof doc.created_at !== 'string') {
    doc.created_at = new Date().toISOString()
  }
  doc.user_id = userId
  const db = await getDb()
  // upsert so a retried insert (same client id) never duplicates a row
  await db.collection(collection).updateOne(
    { user_id: userId, id: doc.id },
    { $set: doc },
    { upsert: true }
  )
  return doc
}

export async function updateRecord(
  userId: string,
  collection: DataCollection,
  id: string,
  input: Record<string, unknown>
): Promise<boolean> {
  const changes = cleanRecord(input)
  delete changes.id
  delete changes.created_at
  if (Object.keys(changes).length === 0) return true
  const db = await getDb()
  const res = await db.collection(collection).updateOne({ user_id: userId, id }, { $set: changes })
  return res.matchedCount > 0
}

export async function deleteRecord(userId: string, collection: DataCollection, id: string) {
  const db = await getDb()
  await db.collection(collection).deleteOne({ user_id: userId, id })
  for (const child of CASCADES[collection] ?? []) {
    await db.collection(child.collection).deleteMany({ user_id: userId, [child.field]: id })
  }
}

export async function updateSettings(userId: string, input: Record<string, unknown>) {
  const changes = cleanRecord(input)
  delete changes.id
  const db = await getDb()
  await db.collection('building_settings').updateOne(
    { user_id: userId },
    { $set: changes, $setOnInsert: { id: randomUUID(), user_id: userId } },
    { upsert: true }
  )
}

/**
 * Restores a backup into the user's account. Rows are matched by id:
 * existing rows are updated, missing ones added, nothing is deleted.
 */
export async function importBackup(userId: string, data: Record<string, unknown>) {
  const db = await getDb()
  const counts: Record<string, number> = {}
  for (const c of DATA_COLLECTIONS) {
    const rows = data[c]
    if (!Array.isArray(rows)) continue
    const ops = rows
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r))
      .map((r) => cleanRecord(r))
      .filter((r) => typeof r.id === 'string' && r.id)
      .map((r) => ({
        updateOne: {
          filter: { user_id: userId, id: r.id },
          update: { $set: { ...r, user_id: userId } },
          upsert: true,
        },
      }))
    if (ops.length) await db.collection(c).bulkWrite(ops, { ordered: false })
    counts[c] = ops.length
  }
  const settings = data.building_settings
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    await updateSettings(userId, settings as Record<string, unknown>)
    counts.building_settings = 1
  }
  return counts
}

/**
 * Deletes every record the user owns (apartments, payments, expenses,
 * categories, staff, history, transfers, tasks, building settings). The
 * account and its sign-in stay, and the default expense categories are
 * put back so the app is ready to use again.
 */
export async function deleteAllData(userId: string, defaultCategories: string[]) {
  const db = await getDb()
  const counts: Record<string, number> = {}
  for (const c of DATA_COLLECTIONS) {
    const res = await db.collection(c).deleteMany({ user_id: userId })
    counts[c] = res.deletedCount
  }
  const settings = await db.collection('building_settings').deleteMany({ user_id: userId })
  counts.building_settings = settings.deletedCount
  if (defaultCategories.length) {
    await db
      .collection('expense_categories')
      .insertMany(defaultCategories.map((name) => ({ id: randomUUID(), name, user_id: userId })))
  }
  return counts
}
