import { withUser } from '@/lib/server/api'
import { fetchAll } from '@/lib/server/data'

// Everything the signed-in user has saved, in one request
export async function GET() {
  return withUser(async (userId) => Response.json(await fetchAll(userId)))
}
