import { getDb, isDbConfigured } from '@/lib/server/mongo'
import { createSession, normalizeEmail, toPublicUser, verifyPassword, type UserDoc } from '@/lib/server/auth'
import { jsonError, readJsonObject } from '@/lib/server/api'

export async function POST(request: Request) {
  if (!isDbConfigured()) return jsonError(503, 'Database not configured: set MONGODB_URI')
  const body = await readJsonObject(request)
  const email = normalizeEmail(body?.email)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) return jsonError(400, 'Enter your email and password')

  try {
    const db = await getDb()
    const user = await db.collection<UserDoc>('users').findOne({ email }, { projection: { _id: 0 } })
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return jsonError(401, 'Wrong email or password')
    }
    await createSession(user.id)
    return Response.json({ user: toPublicUser(user) })
  } catch (err) {
    console.error(err)
    return jsonError(500, err instanceof Error ? err.message : 'Sign in failed')
  }
}
