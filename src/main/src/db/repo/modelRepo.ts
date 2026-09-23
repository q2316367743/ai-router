import { and, eq, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { LRUCache } from 'lru-cache'
import type {
  ModelMappingInfo,
  ModelChannelInput,
  ModelChannelPatch,
  ProviderProtocol
} from '@common/types'
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

/**
 * 代理转发路由：按对外模型名一次联表取齐该名下的**全部渠道**（按创建顺序）。
 *
 * 同一对外名的多行即一个渠道组，转发的候选集；选择与故障转移见 `server/balancer/`。
 *
 * 路由缓存：代理热路径每请求都查（agent 高频调用），读多写少，惰性填充（lru-cache，
 * max 1000 只作防膨胀保险）、任一模型/提供商写操作后整体失效（`invalidateMappingCache`，
 * 同 settingRepo 写时失效口径）。只缓存命中行（未映射名不占缓存）；返回的是缓存对象，
 * 调用方不得修改。
 */
export interface MappingRoute {
  /** 渠道 ID：随日志与用量一并落库，供改名时定位历史行（见 renameRepo） */
  modelId: string
  publicName: string
  upstreamName: string
  mappingEnabled: boolean
  /** 渠道归档时间：非空 = 已归档 */
  mappingArchivedAt: number | null
  providerId: string
  providerName: string
  providerProtocol: ProviderProtocol
  providerBaseUrl: string
  providerApiKey: string
  providerEnabled: boolean
  /** 提供商归档时间：非空 = 提供商已归档，其下渠道连带不可用（先恢复提供商） */
  providerArchivedAt: number | null
}

const routeCache = new LRUCache<string, MappingRoute[]>({ max: 1000 })

/** 路由缓存整体失效：MappingRoute 是 models × providers 联表结果，两侧任一写操作都影响 */
export function invalidateMappingCache(): void {
  routeCache.clear()
}

export function findRoutes(publicName: string): MappingRoute[] {
  const cached = routeCache.get(publicName)
  if (cached) return cached
  const rows = db()
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
    .orderBy(models.createdAt)
    .all()
  if (rows.length === 0) return rows
  routeCache.set(publicName, rows)
  return rows
}

/**
 * 新增渠道：对外名首次出现即为「新建对外模型」，同名再建即为「在该名下加渠道」。
 *
 * 两道守卫：该对外名已被整体归档时拒绝（先恢复，与「归档占用名字」的既有口径一致）；
 * 同一提供商在该名下已有渠道时拒绝（含归档行）。
 */
export function createModelMapping(input: ModelChannelInput): string {
  ensureGroupUsable(input.publicName)
  ensureChannelAvailable(input.publicName, input.providerId)
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
  invalidateMappingCache()
  return id
}

/**
 * 编辑渠道：只改提供商 / 上游模型 / 启停。**对外名不属于渠道**，改名走 `renameModelGroup`。
 *
 * 归属名以库中值为准，不信入参：列表页行内启停会把整行回传，据入参判断会在每次启停时白扫。
 * 改绑 providerId 不触发历史改写 —— 历史请求确实发给了旧供应商，改掉就是伪造历史。
 */
export function updateModelMapping(input: ModelChannelPatch): void {
  const previous = db()
    .select({ publicName: models.publicName, archivedAt: models.archivedAt })
    .from(models)
    .where(eq(models.id, input.id))
    .get()
  // 与改造前一致：id 不存在时静默不改
  if (!previous) return
  // 归档即冻结：恢复走 restoreModelMapping，编辑与启停入口在 UI 上也不可见
  if (previous.archivedAt !== null) throw new Error('已归档的模型渠道不可编辑，请先恢复')
  ensureChannelAvailable(previous.publicName, input.providerId, input.id)

  db()
    .update(models)
    .set({
      providerId: input.providerId,
      upstreamName: input.upstreamName,
      enabled: input.enabled
    })
    .where(eq(models.id, input.id))
    .run()
  invalidateMappingCache()
}

/** 归档渠道（假删除）：/v1/models 与请求路由随即不可见，对外名由组内其它渠道继续承载 */
export function archiveModelMapping(id: string): void {
  db().update(models).set({ archivedAt: Date.now() }).where(eq(models.id, id)).run()
  invalidateMappingCache()
}

/**
 * 恢复渠道：只翻自身的归档位。所属提供商若仍归档，该渠道依旧不可用
 * （/v1/models 与请求路由另按 providerArchivedAt 拦截），需先恢复提供商。
 */
export function restoreModelMapping(id: string): void {
  db().update(models).set({ archivedAt: null }).where(eq(models.id, id)).run()
  invalidateMappingCache()
}

/**
 * 组级重命名：改名要一次改掉该名下**全部渠道行**，否则同一对外名的历史会被拆成两个名字。
 *
 * 历史改写按渠道行 id 逐个做（见 renameRepo）：聚合表按 (桶, 供应商, 对外名) 主键合并，
 * 日志表按 model_id 圈定，同一事务内互不干扰。目标名被占用（含归档行）时拒绝——
 * 同名合并会让「这条历史属于哪个组」失去答案。
 */
export function renameModelGroup(from: string, to: string): void {
  if (from === to) return
  const occupied = db()
    .select({ id: models.id })
    .from(models)
    .where(eq(models.publicName, to))
    .get()
  if (occupied) throw new Error(`对外模型名「${to}」已存在，请换一个名字`)
  db().transaction((tx) => {
    const rows = tx.select({ id: models.id }).from(models).where(eq(models.publicName, from)).all()
    if (rows.length === 0) throw new Error(`对外模型名「${from}」不存在`)
    tx.update(models).set({ publicName: to }).where(eq(models.publicName, from)).run()
    for (const row of rows) applyModelRename(tx, row.id, from, to)
  })
  invalidateMappingCache()
}

/** 组级启停：一次改该名下全部未归档渠道（归档行冻结，不参与整组开关） */
export function setModelGroupEnabled(publicName: string, enabled: boolean): void {
  db()
    .update(models)
    .set({ enabled })
    .where(and(eq(models.publicName, publicName), isNull(models.archivedAt)))
    .run()
  invalidateMappingCache()
}

/** 组级归档：一次归档该名下全部未归档渠道（对外名随即整体下线，请求返回 404 model_archived） */
export function archiveModelGroup(publicName: string): void {
  db()
    .update(models)
    .set({ archivedAt: Date.now() })
    .where(and(eq(models.publicName, publicName), isNull(models.archivedAt)))
    .run()
  invalidateMappingCache()
}

/** 组级恢复：一次恢复该名下全部渠道（含此前被单独归档的渠道，组内不保留单独归档状态） */
export function restoreModelGroup(publicName: string): void {
  db().update(models).set({ archivedAt: null }).where(eq(models.publicName, publicName)).run()
  invalidateMappingCache()
}

/** 该对外名是否已整体归档：名下有行且全部归档 */
export function isModelGroupArchived(publicName: string): boolean {
  const rows = db()
    .select({ archivedAt: models.archivedAt })
    .from(models)
    .where(eq(models.publicName, publicName))
    .all()
  return rows.length > 0 && rows.every((row) => row.archivedAt !== null)
}

/** 新渠道守卫：同一提供商在同一对外名下只允许一条渠道（归档行同样占用） */
function ensureChannelAvailable(publicName: string, providerId: string, excludeId?: string): void {
  const row = db()
    .select({ id: models.id, archivedAt: models.archivedAt })
    .from(models)
    .where(and(eq(models.publicName, publicName), eq(models.providerId, providerId)))
    .get()
  if (!row || row.id === excludeId) return
  if (row.archivedAt !== null) {
    throw new Error(`该提供商已存在对外名「${publicName}」的归档渠道，请先在已归档列表中恢复`)
  }
  throw new Error(`该提供商已有对外名「${publicName}」的渠道，同一提供商不能重复添加`)
}

/** 新建/改名守卫：对外名被整体归档时不允许再挂渠道（先恢复或改名） */
function ensureGroupUsable(publicName: string): void {
  if (isModelGroupArchived(publicName)) {
    throw new Error(`对外模型名「${publicName}」已归档，请先在已归档列表中恢复或改名`)
  }
}
