import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { QuotaPluginInfo, QuotaPluginInput, QuotaSnapshot } from '@common/types'
import { db } from '../client'
import { providers, quotaPlugins, quotaSnapshots } from '../schema'

/** 外置策略全量列表（含已归档，UI 自行过滤） */
export function listQuotaPlugins(): QuotaPluginInfo[] {
  return db()
    .select({
      id: quotaPlugins.id,
      name: quotaPlugins.name,
      script: quotaPlugins.script,
      enabled: quotaPlugins.enabled,
      archivedAt: quotaPlugins.archivedAt,
      createdAt: quotaPlugins.createdAt,
      updatedAt: quotaPlugins.updatedAt
    })
    .from(quotaPlugins)
    .orderBy(quotaPlugins.createdAt)
    .all()
}

export function createQuotaPlugin(input: QuotaPluginInput): string {
  const now = Date.now()
  const id = nanoid()
  db()
    .insert(quotaPlugins)
    .values({
      id,
      name: input.name,
      script: input.script,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now
    })
    .run()
  return id
}

/** 更新外置策略：归档行冻结（对齐提供商惯例），改名/改脚本/启停整行回传 */
export function updateQuotaPlugin(input: QuotaPluginInput): void {
  const id = input.id ?? ''
  const previous = db()
    .select({ archivedAt: quotaPlugins.archivedAt })
    .from(quotaPlugins)
    .where(eq(quotaPlugins.id, id))
    .get()
  if (!previous) return
  if (previous.archivedAt !== null) throw new Error('已归档的策略不可编辑')

  db()
    .update(quotaPlugins)
    .set({
      name: input.name,
      script: input.script,
      enabled: input.enabled,
      updatedAt: Date.now()
    })
    .where(eq(quotaPlugins.id, id))
    .run()
}

/** 归档外置策略（假删除）：单事务连带解绑引用它的提供商，注册表由服务层同步移除 */
export function archiveQuotaPlugin(id: string): void {
  const now = Date.now()
  db().transaction((tx) => {
    tx.update(quotaPlugins)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(quotaPlugins.id, id))
      .run()
    tx.update(providers)
      .set({ quotaStrategyId: null, strategyConfig: null, updatedAt: now })
      .where(eq(providers.quotaStrategyId, id))
      .run()
  })
}

export interface QuotaSnapshotRow {
  providerId: string
  snapshot: QuotaSnapshot | null
  error: string | null
  queriedAt: number
}

/** 全量快照（快查缓存：IPC list 直接 join 渲染） */
export function listQuotaSnapshots(): QuotaSnapshotRow[] {
  return db()
    .select({
      providerId: quotaSnapshots.providerId,
      snapshot: quotaSnapshots.snapshot,
      error: quotaSnapshots.error,
      queriedAt: quotaSnapshots.queriedAt
    })
    .from(quotaSnapshots)
    .all()
    .map((row) => ({
      providerId: row.providerId,
      snapshot: safeParseSnapshot(row.snapshot),
      error: row.error,
      queriedAt: row.queriedAt
    }))
}

function safeParseSnapshot(raw: string | null): QuotaSnapshot | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as QuotaSnapshot
  } catch {
    return null
  }
}

/**
 * 写入查询结果：成功时覆盖 snapshot 并清空 error；失败时保留旧 snapshot（UI 展示
 * 旧值 + 失败原因，避免一次网络抖动清掉最近一次可用数据）。
 */
export function saveQuotaResult(
  providerId: string,
  result: { snapshot: QuotaSnapshot | null; error: string | null }
): void {
  const queriedAt = Date.now()
  db()
    .insert(quotaSnapshots)
    .values({
      providerId,
      snapshot: result.snapshot ? JSON.stringify(result.snapshot) : null,
      error: result.error,
      queriedAt
    })
    .onConflictDoUpdate({
      target: quotaSnapshots.providerId,
      set:
        result.snapshot !== null
          ? { snapshot: JSON.stringify(result.snapshot), error: null, queriedAt }
          : { error: result.error, queriedAt }
    })
    .run()
}
