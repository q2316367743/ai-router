import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ModelMappingInfo, ModelMappingInput, ProviderProtocol } from '@common/types'
import { db } from '../client'
import { models, providers } from '../schema'
import { applyModelRename } from './renameRepo'

export function listModelMappings(): ModelMappingInfo[] {
  return db()
    .select({
      id: models.id,
      providerId: models.providerId,
      providerName: providers.name,
      publicName: models.publicName,
      upstreamName: models.upstreamName,
      enabled: models.enabled,
      createdAt: models.createdAt
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .orderBy(models.createdAt)
    .all()
}

/** 代理转发路由：按对外模型名一次联表取齐映射与提供商信息 */
export interface MappingRoute {
  /** 映射 ID：随日志与用量一并落库，供改名时定位历史行（见 renameRepo） */
  modelId: string
  publicName: string
  upstreamName: string
  mappingEnabled: boolean
  providerId: string
  providerName: string
  providerProtocol: ProviderProtocol
  providerBaseUrl: string
  providerApiKey: string
  providerEnabled: boolean
}

export function findMapping(publicName: string): MappingRoute | null {
  const row = db()
    .select({
      modelId: models.id,
      publicName: models.publicName,
      upstreamName: models.upstreamName,
      mappingEnabled: models.enabled,
      providerId: providers.id,
      providerName: providers.name,
      providerProtocol: providers.protocol,
      providerBaseUrl: providers.baseUrl,
      providerApiKey: providers.apiKey,
      providerEnabled: providers.enabled
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(eq(models.publicName, publicName))
    .get()
  return row ?? null
}

export function createModelMapping(input: ModelMappingInput): string {
  ensurePublicNameAvailable(input.publicName, input.id)
  const id = nanoid()
  db()
    .insert(models)
    .values({
      id,
      providerId: input.providerId,
      publicName: input.publicName,
      upstreamName: input.upstreamName,
      enabled: input.enabled,
      createdAt: Date.now()
    })
    .run()
  return id
}

/**
 * 更新模型映射；对外模型名变化时同步改写历史统计与日志（见 renameRepo），单事务保证一致性。
 *
 * 旧名以库中值为准，不信入参：列表页行内启停会把整行回传（对外名未变），据入参判断会在
 * 每次启停时白扫历史表。改绑 providerId 不触发改写 —— 历史请求确实发给了旧供应商，
 * 改掉就是伪造历史。
 */
export function updateModelMapping(input: ModelMappingInput): void {
  ensurePublicNameAvailable(input.publicName, input.id)
  const id = input.id ?? ''
  db().transaction((tx) => {
    const previous = tx
      .select({ publicName: models.publicName })
      .from(models)
      .where(eq(models.id, id))
      .get()
    // 与改造前一致：id 不存在时静默不改
    if (!previous) return

    tx.update(models)
      .set({
        providerId: input.providerId,
        publicName: input.publicName,
        upstreamName: input.upstreamName,
        enabled: input.enabled
      })
      .where(eq(models.id, id))
      .run()

    if (previous.publicName !== input.publicName) {
      applyModelRename(tx, id, previous.publicName, input.publicName)
    }
  })
}

export function removeModelMapping(id: string): void {
  db().delete(models).where(eq(models.id, id)).run()
}

function ensurePublicNameAvailable(publicName: string, excludeId?: string): void {
  const row = db()
    .select({ id: models.id })
    .from(models)
    .where(eq(models.publicName, publicName))
    .get()
  if (row && row.id !== excludeId) {
    throw new Error(`对外模型名「${publicName}」已存在`)
  }
}
