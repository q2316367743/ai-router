import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { ProviderInfo, ProviderInput } from '@common/types'
import { db } from '../client'
import { models, providers } from '../schema'
import { applyProviderRename } from './renameRepo'

export function listProviders(): ProviderInfo[] {
  return db()
    .select({
      id: providers.id,
      name: providers.name,
      protocol: providers.protocol,
      baseUrl: providers.baseUrl,
      apiKey: providers.apiKey,
      enabled: providers.enabled,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      modelCount: sql<number>`(select count(*) from ${models} where ${models.providerId} = ${providers.id})`
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
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now
    })
    .run()
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
      .select({ name: providers.name })
      .from(providers)
      .where(eq(providers.id, id))
      .get()
    // 与改造前一致：id 不存在时静默不改（UPDATE 命中 0 行）
    if (!previous) return

    tx.update(providers)
      .set({
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        enabled: input.enabled,
        updatedAt: Date.now()
      })
      .where(eq(providers.id, id))
      .run()

    if (previous.name !== input.name) {
      applyProviderRename(tx, id, previous.name, input.name)
    }
  })
}

export function removeProvider(id: string): void {
  db()
    .delete(providers)
    .where(sql`${providers.id} = ${id}`)
    .run()
}
