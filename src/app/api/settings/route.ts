import { jsonError, readJsonObject, withUser } from '@/lib/server/api'
import { updateSettings } from '@/lib/server/data'

export async function PATCH(request: Request) {
  return withUser(async (userId) => {
    const body = await readJsonObject(request)
    if (!body) return jsonError(400, 'Invalid request')
    await updateSettings(userId, body)
    return Response.json({ ok: true })
  })
}
