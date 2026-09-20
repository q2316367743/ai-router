import { ipcMain } from 'electron'
import type { UsageQuery, UsageRangeKey } from '@common/types'
import { listUsageByRange, queryUsageFilterOptions, queryUsageOverview } from '../db/repo/usageRepo'
import { queryModelSpeed } from '../db/repo/speedRepo'
import { queryClientStats, queryAgentProviderFlow } from '../db/repo/clientRepo'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const RANGE_KEYS: ReadonlySet<string> = new Set<UsageRangeKey>([
  'today',
  'last24h',
  'last7d',
  'last30d'
])

/** 筛选值白名单校验：null / 空串表示不筛选，其余必须是字符串 */
function normalizeOptionalName(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label}应为字符串`)
  return value
}

/** 校验看板查询入参（范围枚举 + 可选筛选） */
function normalizeUsageQuery(query: unknown): UsageQuery {
  if (!query || typeof query !== 'object') throw new Error('查询参数缺失')
  const raw = query as Record<string, unknown>
  const range = raw['range']
  if (typeof range !== 'string' || !RANGE_KEYS.has(range)) {
    throw new Error('统计维度应为 today / last24h / last7d / last30d')
  }
  return {
    range: range as UsageRangeKey,
    providerName: normalizeOptionalName(raw['providerName'], '供应商'),
    publicModel: normalizeOptionalName(raw['publicModel'], '模型')
  }
}

/** 用量域 IPC：看板聚合数据与永久明细 */
export function registerUsageIpc(): void {
  ipcMain.handle('usage:overview', (_e, query: unknown) =>
    queryUsageOverview(normalizeUsageQuery(query))
  )

  ipcMain.handle('usage:filterOptions', () => queryUsageFilterOptions())

  ipcMain.handle('usage:listByRange', (_e, query: { startDate: string; endDate: string }) => {
    if (!query || !DATE_RE.test(query.startDate ?? '') || !DATE_RE.test(query.endDate ?? '')) {
      throw new Error('日期格式应为 YYYY-MM-DD')
    }
    if (query.startDate > query.endDate) throw new Error('开始日期不能晚于结束日期')
    return listUsageByRange(query.startDate, query.endDate)
  })

  // 模型速度折线：窗口固定近七天、不支持筛选，故无入参
  ipcMain.handle('usage:modelSpeed', () => queryModelSpeed())

  // 来源客户端请求数：窗口固定近七天、不支持筛选，故无入参
  ipcMain.handle('usage:clientStats', () => queryClientStats())

  // Agent × 提供商交叉流量（桑基图）：窗口固定近七天、不支持筛选，故无入参
  ipcMain.handle('usage:agentFlow', () => queryAgentProviderFlow())
}
