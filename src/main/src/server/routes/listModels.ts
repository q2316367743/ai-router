import type { IncomingMessage, ServerResponse } from 'node:http'
import { listModelMappings } from '$/db/repo/modelRepo'
import { sendJson } from '../respond'

/**
 * GET /v1/models：返回对外模型列表（启用且未归档，且所属提供商未归档）。
 *
 * 一个对外名可能挂着多个渠道（负载均衡组）：按名字去重后只出一个模型项，createdAt 取组内
 * 最早的一条；多渠道的组 owned_by 记 ai-router（单一渠道仍记提供商名，保持既有观感）。
 */
export function handleListModels(_req: IncomingMessage, res: ServerResponse): void {
  const groups = new Map<string, { createdAt: number; providers: string[] }>()
  for (const m of listModelMappings()) {
    if (!m.enabled || m.archivedAt !== null || m.providerArchivedAt !== null) continue
    const group = groups.get(m.publicName)
    if (!group) {
      groups.set(m.publicName, { createdAt: m.createdAt, providers: [m.providerName] })
      continue
    }
    group.createdAt = Math.min(group.createdAt, m.createdAt)
    if (!group.providers.includes(m.providerName)) group.providers.push(m.providerName)
  }

  const data = [...groups].map(([name, group]) => ({
    id: name,
    object: 'model',
    created: Math.floor(group.createdAt / 1000),
    owned_by: group.providers.length > 1 ? 'ai-router' : (group.providers[0] ?? 'ai-router')
  }))
  sendJson(res, 200, { object: 'list', data })
}
