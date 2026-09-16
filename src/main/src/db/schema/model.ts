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
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('idx_models_provider').on(t.providerId)]
)
