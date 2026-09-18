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
      archivedAt: models.archivedAt,
      providerArchivedAt: providers.archivedAt,
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
  /** 映射归档时间：非空 = 已归档 */
  mappingArchivedAt: number | null
  providerId: string
  providerName: string
  providerProtocol: ProviderProtocol
  providerBaseUrl: string
  providerApiKey: string
  providerEnabled: boolean
  /** 提供商归档时间：非空 = 提供商已归档，其下映射连带不可用（先恢复提供商） */
  providerArchivedAt: number | null
}

export function findMapping(publicName: string): MappingRoute | null {
  const row = db()
    .select({
      modelId: models.id,
      publicName: models.publicName,
      upstreamName: models.upstreamName,
      mappingEnabled: models.enabled,
      mappingArchivedAt: models.archivedAt,
      providerId: providers.id,
      providerName: providers.name,
      providerProtocol: providers.protocol,
      providerBaseUrl: providers.baseUrl,
      providerApiKey: providers.apiKey,
      providerEnabled: providers.enabled,
      providerArchivedAt: providers.archivedAt
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
      .select({ publicName: models.publicName, archivedAt: models.archivedAt })
      .from(models)
      .where(eq(models.id, id))
      .get()
    // 与改造前一致：id 不存在时静默不改
    if (!previous) return
    // 归档即冻结：恢复走 restoreModelMapping，编辑与启停入口在 UI 上也不可见
    if (previous.archivedAt !== null) throw new Error('已归档的模型映射不可编辑，请先恢复')

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

/** 归档模型映射（假删除）：对外名所有权保留（新建同名会被 ensurePublicNameAvailable 拒绝），/v1/models 与路由随即不可见 */
export function archiveModelMapping(id: string): void {
  db().update(models).set({ archivedAt: Date.now() }).where(eq(models.id, id)).run()
}

/**
 * 恢复模型映射：只翻自身的归档位。所属提供商若仍归档，该映射依旧不可用
 * （/v1/models 与请求路由另按 providerArchivedAt 拦截），需先恢复提供商。
 */
export function restoreModelMapping(id: string): void {
  db().update(models).set({ archivedAt: null }).where(eq(models.id, id)).run()
}

function ensurePublicNameAvailable(publicName: string, excludeId?: string): void {
  const row = db()
    .select({ id: models.id, archivedAt: models.archivedAt })
    .from(models)
    .where(eq(models.publicName, publicName))
    .get()
  if (row && row.id !== excludeId) {
    if (row.archivedAt !== null) {
      throw new Error(`对外模型名「${publicName}」已被归档的映射占用，请先在已归档列表中恢复或改名`)
    }
    throw new Error(`对外模型名「${publicName}」已存在`)
  }
}
