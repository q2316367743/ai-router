import type { QuotaDetailRow, QuotaDetailSection, QuotaSnapshot, QuotaStrategy } from '@common/types'
import { recordOf } from '../util'

const BALANCE_URL = 'https://api.poe.com/usage/current_balance'
const HISTORY_URL = 'https://api.poe.com/usage/points_history'

/** 单条用量历史条目 */
interface PoeEntry {
  date: Date
  points: number
  cost: number | null
  model: string
  usageType: string
}

/** summarize 的累加器 */
interface PoeSummary {
  points: number
  requests: number
  cost: number
  hasCost: boolean
}

function optionalNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(number)) throw new Error(`Poe ${field} must be numeric`)
  return number
}

/** 历史时间戳自适配：>1e14 视为微秒、>1e12 毫秒、其余秒；无法解析返回 null */
function entryDate(value: unknown): Date | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const numeric = Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 100000000000000 ? numeric / 1000 : numeric > 1000000000000 ? numeric : numeric * 1000)
    : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

/** 复刻 JS 裸属性访问语义：对 null/undefined 取属性抛 TypeError（随后被外层 catch 吞掉，与 JS 一致） */
function fieldOf(row: unknown, key: string): unknown {
  if (row === null || row === undefined) {
    throw new TypeError(`Cannot read properties of ${row} (reading '${key}')`)
  }
  return recordOf(row)?.[key]
}

/** Poe：点数余额 + 近 30 天用量历史分页聚合（由 CodexBar poe.js 1:1 移植） */
export const poeStrategy: QuotaStrategy = {
  meta: {
    id: 'poe',
    label: 'Poe',
    builtin: true,
    credential: 'apiKey',
    description: '点数余额与用量历史（API Key）'
  },
  async fetch(ctx) {
    const authHeaders = { Authorization: `Bearer ${ctx.apiKey}` }

    function compact(value: number): string {
      return ctx.format.number(value, { maximumFractionDigits: value >= 1000 ? 0 : 1 })
    }
    function timeString(date: Date): string {
      const pad = (value: number): string => String(value).padStart(2, '0')
      return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
    }
    function summaryRow(label: string, summary: PoeSummary): QuotaDetailRow {
      const secondary = [`${summary.requests} requests`]
      if (summary.hasCost) secondary.push(`$${summary.cost.toFixed(2)}`)
      return { label, value: `${compact(summary.points)} points`, secondaryValue: secondary.join(' · ') }
    }
    function summarize(rows: PoeEntry[]): PoeSummary {
      return rows.reduce<PoeSummary>(
        (sum, entry) => {
          sum.points += entry.points
          sum.requests += 1
          if (entry.cost !== null) {
            sum.cost += Math.max(0, entry.cost)
            sum.hasCost = true
          }
          return sum
        },
        { points: 0, requests: 0, cost: 0, hasCost: false }
      )
    }

    const balanceResponse = await ctx.http.getJSON(BALANCE_URL, { headers: authHeaders })
    if (balanceResponse.status === 401 || balanceResponse.status === 403) {
      throw new Error('Invalid or expired Poe API token')
    }
    if (balanceResponse.status < 200 || balanceResponse.status >= 300) {
      throw new Error(`Poe API error: HTTP ${balanceResponse.status}`)
    }
    const payload = recordOf(balanceResponse.json)
    if (!payload) throw new Error('Failed to parse Poe balance response')
    const balance = optionalNumber(payload.current_point_balance, 'current_point_balance')

    const entries: PoeEntry[] = []
    try {
      let cursor: string | null = null
      const cutoff = ctx.date.nowMillis() - 30 * 86400000
      for (let page = 0; page < 5; page += 1) {
        const query = cursor ? `?limit=100&starting_after=${encodeURIComponent(cursor)}` : '?limit=100'
        const response = await ctx.http.getJSON(`${HISTORY_URL}${query}`, { headers: authHeaders })
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
        const root = recordOf(response.json)
        if (!root) throw new Error('invalid history JSON')
        const rows = Array.isArray(root.data)
          ? root.data
          : Array.isArray(root.items)
            ? root.items
            : Array.isArray(root.results)
              ? root.results
              : []
        for (const row of rows) {
          const record = recordOf(row)
          if (!record) continue
          const date = entryDate(record.creation_time ?? record.timestamp ?? record.created_at)
          if (!date || date.getTime() < cutoff) continue
          const points = Math.max(
            0,
            optionalNumber(record.cost_points ?? record.points ?? record.point_cost, 'points') ?? 0
          )
          const cost = optionalNumber(record.cost_usd ?? record.usd, 'cost_usd')
          const model =
            typeof record.bot_name === 'string' && record.bot_name.trim() ? record.bot_name.trim() : 'unknown'
          const usageType =
            typeof record.usage_type === 'string' && record.usage_type.trim() ? record.usage_type.trim() : 'unknown'
          entries.push({ date, points, cost, model, usageType })
        }
        const next = typeof root.next_cursor === 'string' && root.next_cursor.trim() ? root.next_cursor.trim() : null
        cursor = next
        if (cursor === null && root.has_more === true && rows.length > 0) {
          const queryId = fieldOf(rows[rows.length - 1], 'query_id')
          if (typeof queryId === 'string') cursor = queryId.trim()
        }
        if (!cursor) break
        const lastDate = rows.length
          ? entryDate(
              fieldOf(rows[rows.length - 1], 'creation_time') ??
                fieldOf(rows[rows.length - 1], 'timestamp') ??
                fieldOf(rows[rows.length - 1], 'created_at')
            )
          : null
        if (lastDate && lastDate.getTime() < cutoff) break
      }
    } catch {
      // 与 JS 一致：历史拉取/解析失败静默降级，保留已收集条目
    }

    const daily = new Map<string, number>()
    const models = new Map<string, number>()
    const types = new Map<string, number>()
    for (const entry of entries) {
      const day = entry.date.toISOString().slice(0, 10)
      daily.set(day, (daily.get(day) || 0) + entry.points)
      models.set(entry.model, (models.get(entry.model) || 0) + entry.points)
      types.set(entry.usageType, (types.get(entry.usageType) || 0) + entry.points)
    }
    const days = Array.from(daily.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    const seven = summarize(entries.filter((entry) => entry.date.getTime() >= ctx.date.nowMillis() - 7 * 86400000))
    const thirty = summarize(entries)
    const todayUTC = ctx.date.now().toISOString().slice(0, 10)
    const today = summarize(entries.filter((entry) => entry.date.toISOString().slice(0, 10) === todayUTC))
    const topModel = Array.from(models.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    const topTypes = Array.from(types.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

    const rows: QuotaDetailRow[] = []
    if (balance !== null) rows.push({ label: 'Current balance', value: `${compact(balance)} points` })
    if (entries.length) {
      rows.push(summaryRow('Today', today))
      rows.push(summaryRow('Last 7 days', seven))
      rows.push(summaryRow('Last 30 days', thirty))
      if (topModel) {
        rows.push({ label: 'Top model', value: topModel[0], secondaryValue: `${compact(topModel[1])} points` })
      }
      if (topTypes.length) {
        rows.push({
          label: 'Usage mix',
          value: topTypes
            .slice(0, 2)
            .map((item) => `${item[0]}: ${compact(item[1])} points`)
            .join(' · ')
        })
      }
      entries
        .slice()
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 3)
        .forEach((entry, index) => {
          rows.push({
            label: index === 0 ? 'Recent activity' : timeString(entry.date),
            value: index === 0 ? `${timeString(entry.date)} · ${entry.model}` : entry.model,
            secondaryValue: `${compact(entry.points)} points`
          })
        })
    }

    const section: QuotaDetailSection = { title: 'Points', rows }
    if (days.length) {
      section.chart = {
        kind: 'bars',
        title: 'Daily points',
        unit: 'points',
        points: days.map((item) => ({ label: item[0], value: item[1] }))
      }
    }

    const identity: QuotaSnapshot['identity'] = {}
    if (balance !== null) identity.loginMethod = `Balance: ${compact(balance)} points`
    return { details: [section], identity }
  }
}
