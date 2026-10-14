import { randomUUID } from 'node:crypto'
import { getDb, isDbConfigured } from '@/lib/server/mongo'
import { createSession, hashPassword, normalizeEmail, toPublicUser, type UserDoc } from '@/lib/server/auth'
import { jsonError, readJsonObject } from '@/lib/server/api'
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/constants'

export async function POST(request: Request) {
  if (!isDbConfigured()) return jsonError(503, 'Database not configured: set MONGODB_URI')
  const body = await readJsonObject(request)
  if (!body) return jsonError(400, 'Invalid request')

  const email = normalizeEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim().slice(0, 200) : ''
  const buildingName = typeof body.building_name === 'string' ? body.building_name.trim().slice(0, 200) : ''
  if (!email) return jsonError(400, 'Enter a valid email address')
  if (password.length < 8) return jsonError(400, 'Password must be at least 8 characters')

  try {
    const db = await getDb()
    const user: UserDoc = {
      id: randomUUID(),
      email,
      full_name: fullName || null,
      password_hash: await hashPassword(password),
      created_at: new Date().toISOString(),
    }
    try {
      await db.collection('users').insertOne({ ...user })
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return jsonError(409, 'An account with this email already exists — sign in instead')
      }
      throw err
    }

    // Start every new account with the standard expense categories
    await db.collection('expense_categories').insertMany(
      DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ id: randomUUID(), name, user_id: user.id }))
    )
    if (buildingName) {
      await db.collection('building_settings').insertOne({
        id: randomUUID(),
        user_id: user.id,
        building_name: buildingName,
      })
    }

    await createSession(user.id)
    return Response.json({ user: toPublicUser(user) })
  } catch (err) {
    console.error(err)
    return jsonError(500, err instanceof Error ? err.message : 'Sign up failed')
  }
}
