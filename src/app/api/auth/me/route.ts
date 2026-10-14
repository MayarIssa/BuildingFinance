import { isDbConfigured } from '@/lib/server/mongo'
import { getSessionUser, toPublicUser } from '@/lib/server/auth'
import { jsonError } from '@/lib/server/api'

export async function GET() {
  if (!isDbConfigured()) return jsonError(503, 'Database not configured: set MONGODB_URI')
  try {
    const user = await getSessionUser()
    if (!user) return jsonError(401, 'Signed out')
    return Response.json({ user: toPublicUser(user) })
  } catch (err) {
    console.error(err)
    return jsonError(500, err instanceof Error ? err.message : 'Database error')
  }
}
