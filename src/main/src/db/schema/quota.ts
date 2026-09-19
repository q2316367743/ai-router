import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 外置余量策略（用户 JS 脚本）：script 为顶层调用 defineProvider({...}) 的脚本源码。
 * 启动/安装时经 eval 加载进内存注册表（可卸载可删除）；内置策略不落库、代码写死。
 */
export const quotaPlugins = sqliteTable('quota_plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  script: text('script').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** 归档时间（epoch ms）：非空 = 已归档（假删除，注册表同步移除） */
  archivedAt: integer('archived_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/** 余量快照：每个提供商一行（UPSERT），保存最近一次策略执行结果或失败原因 */
export const quotaSnapshots = sqliteTable('quota_snapshots', {
  providerId: text('provider_id').primaryKey(),
  /** 最近一次成功的 QuotaSnapshot JSON；失败时为 null */
  snapshot: text('snapshot'),
  /** 最近一次失败的中文原因；成功时为 null */
  error: text('error'),
  queriedAt: integer('queried_at').notNull()
})
