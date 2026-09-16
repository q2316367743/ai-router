import { nanoid } from 'nanoid'
import type { ServiceConfig } from '@common/types'
import { db } from '../client'
import { settings } from '../schema'

const KEY_PORT = 'server.port'
const KEY_API_KEY = 'server.apiKey'
const KEY_ENABLED = 'server.enabled'

const DEFAULT_PORT = 8910

/** 首次启动补齐默认配置：端口 8910、生成 sk- 对外 Key、服务开启 */
export function ensureServiceDefaults(): void {
  const config = getServiceConfig()
  const rows: Array<{ key: string; value: string }> = []
  if (!config.port) rows.push({ key: KEY_PORT, value: String(DEFAULT_PORT) })
  if (!config.apiKey) rows.push({ key: KEY_API_KEY, value: `sk-${nanoid(32)}` })
  rows.push({ key: KEY_ENABLED, value: config.enabled ? '1' : '0' })
  if (rows.length) {
    db().insert(settings).values(rows).onConflictDoNothing().run()
  }
}

export function getServiceConfig(): ServiceConfig {
  const rows = db().select().from(settings).all()
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const port = Number(map.get(KEY_PORT) ?? 0)
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    apiKey: map.get(KEY_API_KEY) ?? '',
    enabled: (map.get(KEY_ENABLED) ?? '1') === '1'
  }
}

export function saveServiceConfig(config: ServiceConfig): void {
  upsert(KEY_PORT, String(config.port))
  upsert(KEY_ENABLED, config.enabled ? '1' : '0')
}

/** 重新生成对外 Key，返回新 Key */
export function regenerateApiKey(): string {
  const apiKey = `sk-${nanoid(32)}`
  upsert(KEY_API_KEY, apiKey)
  return apiKey
}

function upsert(key: string, value: string): void {
  db()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
