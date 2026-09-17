import { nanoid } from 'nanoid'
import type { ServiceConfig } from '@common/types'
import { db } from '../client'
import { settings } from '../schema'

const KEY_PORT = 'server.port'
const KEY_API_KEY = 'server.apiKey'
const KEY_ENABLED = 'server.enabled'
const KEY_PROXY_URL = 'server.proxyUrl'

const DEFAULT_PORT = 8910

// 服务配置缓存：读多写少（鉴权/出站代理每请求都读），惰性加载，写操作后失效
let cachedConfig: ServiceConfig | null = null

/** 首次启动补齐默认配置：端口 8910、生成 sk- 对外 Key、服务开启 */
export function ensureServiceDefaults(): void {
  const config = getServiceConfig()
  const rows: Array<{ key: string; value: string }> = []
  if (!config.port) rows.push({ key: KEY_PORT, value: String(DEFAULT_PORT) })
  if (!config.apiKey) rows.push({ key: KEY_API_KEY, value: `sk-${nanoid(32)}` })
  rows.push({ key: KEY_ENABLED, value: config.enabled ? '1' : '0' })
  if (rows.length) {
    db().insert(settings).values(rows).onConflictDoNothing().run()
    cachedConfig = null
  }
}

export function getServiceConfig(): ServiceConfig {
  if (cachedConfig) return cachedConfig
  const rows = db().select().from(settings).all()
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const port = Number(map.get(KEY_PORT) ?? 0)
  cachedConfig = {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    apiKey: map.get(KEY_API_KEY) ?? '',
    enabled: (map.get(KEY_ENABLED) ?? '1') === '1',
    proxyUrl: map.get(KEY_PROXY_URL) ?? ''
  }
  return cachedConfig
}

export function saveServiceConfig(config: ServiceConfig): void {
  upsert(KEY_PORT, String(config.port))
  upsert(KEY_ENABLED, config.enabled ? '1' : '0')
  upsert(KEY_PROXY_URL, config.proxyUrl.trim())
  cachedConfig = null
}

/** 重新生成对外 Key，返回新 Key */
export function regenerateApiKey(): string {
  const apiKey = `sk-${nanoid(32)}`
  upsert(KEY_API_KEY, apiKey)
  cachedConfig = null
  return apiKey
}

function upsert(key: string, value: string): void {
  db()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
