import { isDbConfigured } from '@/lib/server/mongo'
import { destroySession } from '@/lib/server/auth'

export async function POST() {
  if (isDbConfigured()) {
    try {
      await destroySession()
    } catch (err) {
      console.error(err)
    }
  }
  return Response.json({ ok: true })
}
