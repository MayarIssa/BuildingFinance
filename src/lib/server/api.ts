import 'server-only'
import { isDbConfigured } from './mongo'
import { getSessionUserId } from './auth'

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status })
}

/**
 * Runs a handler for the signed-in user. Answers 503 when the database
 * isn't configured, 401 when signed out, and 500 (with the reason) when
 * the database call fails — the client shows that reason in a toast.
 */
export async function withUser(
  handler: (userId: string) => Promise<Response>
): Promise<Response> {
  if (!isDbConfigured()) {
    return jsonError(503, 'Database not configured: set MONGODB_URI in the Vercel project settings')
  }
  try {
    const userId = await getSessionUserId()
    if (!userId) return jsonError(401, 'You are signed out — sign in again')
    return await handler(userId)
  } catch (err) {
    console.error(err)
    return jsonError(500, err instanceof Error ? err.message : 'Database error')
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return isPlainObject(body) ? body : null
  } catch {
    return null
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Fields the server owns — never accepted from the client
const SERVER_FIELDS = new Set(['_id', 'user_id'])

/**
 * Copies a client-sent record, dropping server-owned fields and any key
 * MongoDB would read as an operator or a path ($set, a.b).
 */
export function cleanRecord(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (SERVER_FIELDS.has(k)) continue
    if (k.startsWith('$') || k.includes('.')) continue
    out[k] = isPlainObject(v) ? cleanNested(v) : v
  }
  return out
}

function cleanNested(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith('$') || k.includes('.')) continue
    out[k] = isPlainObject(v) ? cleanNested(v) : v
  }
  return out
}
