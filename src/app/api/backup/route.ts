import { jsonError, readJsonObject, withUser } from '@/lib/server/api'
import { deleteAllData, fetchAll, importBackup } from '@/lib/server/data'
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/constants'

// Download a full copy of the signed-in user's data
export async function GET() {
  return withUser(async (userId) => {
    const data = await fetchAll(userId)
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(
      JSON.stringify({ app: 'buildfin', version: 1, exported_at: new Date().toISOString(), data }, null, 2),
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="buildfin-backup-${stamp}.json"`,
        },
      }
    )
  })
}

// Restore a backup file (adds missing rows, updates existing ones)
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const body = await readJsonObject(request)
    const data = body?.data
    if (!body || body.app !== 'buildfin' || typeof data !== 'object' || data === null || Array.isArray(data)) {
      return jsonError(400, 'This is not a BuildFin backup file')
    }
    const counts = await importBackup(userId, data as Record<string, unknown>)
    return Response.json({ ok: true, counts })
  })
}

// Delete all of the signed-in user's data — the account stays. Requires
// { "confirm": "DELETE" } so a stray request can't wipe anything.
export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const body = await readJsonObject(request)
    if (body?.confirm !== 'DELETE') return jsonError(400, 'Confirmation missing')
    const counts = await deleteAllData(userId, DEFAULT_EXPENSE_CATEGORIES)
    return Response.json({ ok: true, counts })
  })
}
