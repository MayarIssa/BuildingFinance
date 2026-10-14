import 'server-only'
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { getDb } from './mongo'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>

export const SESSION_COOKIE = 'bf_session'
// Stay signed in for a year — the app is meant to be opened now and then
const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export type UserDoc = {
  id: string
  email: string
  full_name: string | null
  password_hash: string
  created_at: string
}

export type PublicUser = Pick<UserDoc, 'id' | 'email' | 'full_name'>

export function toPublicUser(u: UserDoc): PublicUser {
  return { id: u.id, email: u.email, full_name: u.full_name }
}

// ── Passwords (scrypt, per-user random salt) ──

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

// ── Sessions ──
//
// The cookie holds a random token; the database stores only its hash, so
// a leaked database dump can't be replayed as a login.

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const db = await getDb()
  await db.collection('sessions').insertOne({
    token_hash: hashToken(token),
    user_id: userId,
    created_at: new Date(),
    expires_at: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    const db = await getDb()
    await db.collection('sessions').deleteOne({ token_hash: hashToken(token) })
  }
  store.delete(SESSION_COOKIE)
}

/** The signed-in user's id, or null when there is no valid session */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  const db = await getDb()
  const session = await db
    .collection('sessions')
    .findOne({ token_hash: hashToken(token), expires_at: { $gt: new Date() } })
  return session ? (session.user_id as string) : null
}

export async function getSessionUser(): Promise<UserDoc | null> {
  const userId = await getSessionUserId()
  if (!userId) return null
  const db = await getDb()
  return db.collection<UserDoc>('users').findOne({ id: userId }, { projection: { _id: 0 } })
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const e = email.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}
