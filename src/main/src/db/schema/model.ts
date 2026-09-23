import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { providers } from './provider'

/**
 * 模型渠道：对外模型名 ↔ 提供商上游模型名。
 *
 * **同一 `public_name` 的多行 = 一个对外模型的渠道组**（负载均衡的候选集）。名字靠行承载：
 * 没有行就不存在这个名字，所以「建了名字却没渠道」的空组在结构上不可能出现，也就不会对外开放。
 */
export const models = sqliteTable(
  'models',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    publicName: text('public_name').notNull(),
    upstreamName: text('upstream_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * 归档时间（epoch ms）：非空 = 已归档，与 providers.archivedAt 同义。
     * 提供商归档会级联归档其下渠道；恢复提供商不自动恢复渠道，需在模型页逐个恢复。
     */
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    index('idx_models_provider').on(t.providerId),
    /** 路由热路径：按对外名取该名的全部渠道 */
    index('idx_models_public').on(t.publicName),
    /**
     * 一个提供商在同一对外名下只允许一条渠道。含归档行 —— 归档同样占用该组合，
     * 与「归档行占用名字」的既有口径一致（想换回来先恢复，而不是直接重建）。
     */
    uniqueIndex('idx_models_channel').on(t.publicName, t.providerId)
  ]
)
