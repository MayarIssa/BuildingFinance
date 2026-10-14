import 'server-only'
import { MongoClient, type Db } from 'mongodb'

// One client per server instance. On Vercel each warm function reuses it,
// and in dev the global survives hot reloads so connections don't pile up.
const globalForMongo = globalThis as unknown as {
  _mongoClient?: Promise<MongoClient>
  _mongoIndexes?: Promise<void>
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI)
}

function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(uri).connect().catch((err) => {
      // don't cache a failed connection — retry on the next request
      globalForMongo._mongoClient = undefined
      throw err
    })
  }
  return globalForMongo._mongoClient
}

export async function getDb(): Promise<Db> {
  const client = await getClient()
  const db = client.db(process.env.MONGODB_DB || 'buildfin')
  if (!globalForMongo._mongoIndexes) {
    globalForMongo._mongoIndexes = ensureIndexes(db).catch((err) => {
      globalForMongo._mongoIndexes = undefined
      throw err
    })
  }
  await globalForMongo._mongoIndexes
  return db
}

// Every data collection is keyed by (user_id, id); ids are UUIDs the
// client generates so local state and the database agree on identity
export const DATA_COLLECTIONS = [
  'apartments',
  'payments',
  'expenses',
  'expense_categories',
  'category_people',
  'yearly_history',
  'transfers',
  'tasks',
] as const

export type DataCollection = (typeof DATA_COLLECTIONS)[number]

export function isDataCollection(name: string): name is DataCollection {
  return (DATA_COLLECTIONS as readonly string[]).includes(name)
}

async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ token_hash: 1 }, { unique: true }),
    // cleanup only — expired sessions are already rejected by the lookup,
    // so a server without TTL support (e.g. local FerretDB) is fine
    db
      .collection('sessions')
      .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
      .catch((err) => console.warn('sessions TTL index not created:', err.message)),
    db.collection('building_settings').createIndex({ user_id: 1 }, { unique: true }),
    ...DATA_COLLECTIONS.map((c) =>
      db.collection(c).createIndex({ user_id: 1, id: 1 }, { unique: true })
    ),
  ])
}
