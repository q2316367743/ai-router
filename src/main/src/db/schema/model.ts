import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { providers } from './provider'

/** 模型映射：对外模型名 ↔ 提供商上游模型名（渠道） */
export const models = sqliteTable(
  'models',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    publicName: text('public_name').notNull().unique(),
    upstreamName: text('upstream_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * 归档时间（epoch ms）：非空 = 已归档，与 providers.archivedAt 同义。
     * 提供商归档会级联归档其下映射；恢复提供商不自动恢复映射，需在模型页逐个恢复。
     */
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('idx_models_provider').on(t.providerId)]
)
