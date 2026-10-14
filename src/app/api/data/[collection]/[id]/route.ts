import type { NextRequest } from 'next/server'
import { isDataCollection } from '@/lib/server/mongo'
import { jsonError, readJsonObject, withUser } from '@/lib/server/api'
import { deleteRecord, updateRecord } from '@/lib/server/data'

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/data/[collection]/[id]'>) {
  const { collection, id } = await ctx.params
  if (!isDataCollection(collection)) return jsonError(404, 'Unknown collection')
  return withUser(async (userId) => {
    const body = await readJsonObject(request)
    if (!body) return jsonError(400, 'Invalid request')
    const found = await updateRecord(userId, collection, id, body)
    return found ? Response.json({ ok: true }) : jsonError(404, 'Record not found')
  })
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/data/[collection]/[id]'>) {
  const { collection, id } = await ctx.params
  if (!isDataCollection(collection)) return jsonError(404, 'Unknown collection')
  return withUser(async (userId) => {
    await deleteRecord(userId, collection, id)
    return Response.json({ ok: true })
  })
}
