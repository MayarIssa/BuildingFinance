import type { NextRequest } from 'next/server'
import { isDataCollection } from '@/lib/server/mongo'
import { jsonError, readJsonObject, withUser } from '@/lib/server/api'
import { insertRecord } from '@/lib/server/data'

export async function POST(request: NextRequest, ctx: RouteContext<'/api/data/[collection]'>) {
  const { collection } = await ctx.params
  if (!isDataCollection(collection)) return jsonError(404, 'Unknown collection')
  return withUser(async (userId) => {
    const body = await readJsonObject(request)
    if (!body) return jsonError(400, 'Invalid request')
    return Response.json(await insertRecord(userId, collection, body))
  })
}
