import { getDb, isDbConfigured } from '@/lib/server/mongo'

// Used by the Building Setup page to show whether the database is reachable
export async function GET() {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, message: 'MONGODB_URI is not set in the Vercel project settings' })
  }
  try {
    const db = await getDb()
    await db.command({ ping: 1 })
    return Response.json({ ok: true, message: 'Connected' })
  } catch (err) {
    return Response.json({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' })
  }
}
