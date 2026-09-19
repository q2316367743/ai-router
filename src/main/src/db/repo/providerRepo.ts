import { and, eq, isNull, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ProviderInfo, ProviderInput } from '@common/types'
import { db } from '../client'
import { models, providers } from '../schema'
import { invalidateMappingCache } from './modelRepo'
import { applyProviderRename } from './renameRepo'

export function listProviders(): ProviderInfo[] {
  return db()
    .select({
      id: providers.id,
      name: providers.name,
      protocol: providers.protocol,
      kind: providers.kind,
      baseUrl: providers.baseUrl,
      apiKey: providers.apiKey,
      quotaStrategyId: providers.quotaStrategyId,
      strategyConfig: providers.strategyConfig,
      enabled: providers.enabled,
      archivedAt: providers.archivedAt,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      // 可用模型数：不含已归档映射（归档即对外不存在）
      modelCount: sql<number>`(select count(*) from ${models} where ${models.providerId} = ${providers.id} and ${models.archivedAt} is null)`
    })
    .from(providers)
    .orderBy(providers.createdAt)
    .all()
}

export function createProvider(input: ProviderInput): string {
  const now = Date.now()
  const id = nanoid()
  db()
    .insert(providers)
    .values({
      id,
      name: input.name,
      protocol: input.protocol,
      kind: input.kind ?? null,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      quotaStrategyId: input.quotaStrategyId ?? null,
      strategyConfig: input.strategyConfig ?? null,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now
    })
    .run()
  invalidateMappingCache()
  return id
}

/**
 * 更新提供商；改名时同步改写历史统计与日志里的供应商名（见 renameRepo），单事务保证
 * 「新名 + 历史已跟随」要么都成、要么都不成，否则会留下裂成两组的统计。
 *
 * 旧名以库中值为准，不信入参：列表页行内启停会把整行原样回传（名字未变），据入参判断会
 * 在每次启停时白白扫一遍历史表。
 */
export function updateProvider(input: ProviderInput): void {
  const id = input.id ?? ''
  db().transaction((tx) => {
    const previous = tx
      .select({ name: providers.name, archivedAt: providers.archivedAt })
      .from(providers)
      .where(eq(providers.id, id))
      .get()
    // 与改造前一致：id 不存在时静默不改（UPDATE 命中 0 行）
    if (!previous) return
    // 归档即冻结：状态只由 archiveProvider / restoreProvider 翻转，编辑与启停入口在 UI 上也不可见
    if (previous.archivedAt !== null) throw new Error('已归档的提供商不可编辑，请先恢复')

    tx.update(providers)
      .set({
        name: input.name,
        protocol: input.protocol,
        // 显式写入（含 null）：支持「内置改回自定义」的清除
        kind: input.kind ?? null,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        // 显式写入（含 null）：支持「解除余量策略绑定」的清除
        quotaStrategyId: input.quotaStrategyId ?? null,
        strategyConfig: input.strategyConfig ?? null,
        enabled: input.enabled,
        updatedAt: Date.now()
      })
      .where(eq(providers.id, id))
      .run()

    if (previous.name !== input.name) {
      applyProviderRename(tx, id, previous.name, input.name)
    }
  })
  invalidateMappingCache()
}

/**
 * 归档提供商（假删除）：连带归档其下所有**未归档**映射，单事务保证不留「提供商已归档、
 * 映射仍对外可见」的中间态。
 *
 * 只写 `archived_at IS NULL` 的行：此前单独归档过的映射保留自己的归档时间。
 * 不物理删除任何行，历史统计与日志里的 provider_id / model_id 始终指得回实体，改名跟随不失效。
 */
export function archiveProvider(id: string): void {
  const now = Date.now()
  db().transaction((tx) => {
    tx.update(providers)
      .set({ archivedAt: now, updatedAt: now }).where(eq(providers.id, id))
      .run()
    tx.update(models)
      .set({ archivedAt: now })
      .where(and(eq(models.providerId, id), isNull(models.archivedAt)))
      .run()
  })
  invalidateMappingCache()
}

/**
 * 恢复提供商：**只恢复自身**，其下映射保持归档，需在模型页逐个恢复。
 *
 * 不连带恢复映射：映射的归档可能来自被归档之前的一次单独操作，连带恢复会把用户本想下线的
 * 模型一起放回线上。
 */
export function restoreProvider(id: string): void {
  db()
    .update(providers)
    .set({ archivedAt: null, updatedAt: Date.now() })
    .where(eq(providers.id, id))
    .run()
  invalidateMappingCache()
}
