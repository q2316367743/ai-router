import type { IncomingMessage, ServerResponse } from 'node:http'
import { listModelMappings } from '$/db/repo/modelRepo'
import { sendJson } from '../respond'

/** GET /v1/models：返回对外模型列表（启用且未归档，且所属提供商未归档） */
export function handleListModels(_req: IncomingMessage, res: ServerResponse): void {
  const data = listModelMappings()
    .filter((m) => m.enabled && m.archivedAt === null && m.providerArchivedAt === null)
    .map((m) => ({
      id: m.publicName,
      object: 'model',
      created: Math.floor(m.createdAt / 1000),
      owned_by: m.providerName
    }))
  sendJson(res, 200, { object: 'list', data })
}
