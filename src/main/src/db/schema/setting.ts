import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** 键值配置：server.port / server.apiKey / server.enabled */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
