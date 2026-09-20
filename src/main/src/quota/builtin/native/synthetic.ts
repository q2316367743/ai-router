import type { QuotaRateWindow, QuotaSnapshot, QuotaStrategy } from '@common/types'
import { recordOf } from '../util'

const QUOTAS_URL = 'https://api.synthetic.new/v2/quotas'

const LABEL_KEYS = ['name', 'label', 'type', 'period', 'scope', 'title', 'id']
const PERCENT_USED_KEYS = [
  'percentUsed',
  'usedPercent',
  'usagePercent',
  'usage_percent',
  'used_percent',
  'percent_used',
  'percent'
]
const PERCENT_REMAINING_KEYS = ['percentRemaining', 'remainingPercent', 'remaining_percent', 'percent_remaining']
const LIMIT_KEYS = [
  'limit',
  'messageLimit',
  'message_limit',
  'messages',
  'maxRequests',
  'max_requests',
  'requestLimit',
  'request_limit',
  'quota',
  'max',
  'total',
  'capacity',
  'allowance'
]
const USED_KEYS = [
  'used',
  'usage',
  'usedMessages',
  'used_messages',
  'messagesUsed',
  'messages_used',
  'requests',
  'requestCount',
  'request_count',
  'consumed',
  'spent'
]
const REMAINING_KEYS = ['remaining', 'left', 'available', 'balance']
const RESET_KEYS = [
  'resetAt',
  'reset_at',
  'resetsAt',
  'resets_at',
  'renewAt',
  'renew_at',
  'renewsAt',
  'renews_at',
  'nextTickAt',
  'next_tick_at',
  'nextRegenAt',
  'next_regen_at',
  'periodEnd',
  'period_end',
  'expiresAt',
  'expires_at',
  'endAt',
  'end_at'
]
const PLAN_KEYS = ['plan', 'planName', 'plan_name', 'subscription', 'subscriptionPlan', 'tier', 'package', 'packageName']

/** parseQuota 的解析产物 */
interface ParsedQuota {
  label: string | null
  window: QuotaRateWindow
  cost: QuotaSnapshot['cost']
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length) {
    const number = Number(value.trim())
    return Number.isFinite(number) ? number : null
  }
  return null
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = numberValue(payload[key])
    if (value !== null) return value
  }
  return null
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length) return trimmed
    }
  }
  return null
}

/** ≤1 视为小数比例放大为百分比 */
function normalizedPercent(value: number | null): number | null {
  if (value === null) return null
  return value <= 1 ? value * 100 : value
}

/** 金额字段宽容解析：字符串剥 $ 与千分位逗号 */
function currencyValue(value: unknown): number | null {
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(/\$/g, '').replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return numberValue(value)
}

function firstCurrency(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = currencyValue(payload[key])
    if (value !== null) return value
  }
  return null
}

/** 窗口时长换算为分钟：数值字段优先，其次 "5 hours" 类文本 */
function windowMinutes(payload: Record<string, unknown>): number | null {
  const minutes = firstNumber(payload, ['windowMinutes', 'window_minutes', 'periodMinutes', 'period_minutes'])
  if (minutes !== null) return Math.round(minutes)
  const hours = firstNumber(payload, ['windowHours', 'window_hours', 'periodHours', 'period_hours'])
  if (hours !== null) return Math.round(hours * 60)
  const days = firstNumber(payload, ['windowDays', 'window_days', 'periodDays', 'period_days'])
  if (days !== null) return Math.round(days * 1440)
  const seconds = firstNumber(payload, ['windowSeconds', 'window_seconds', 'periodSeconds', 'period_seconds'])
  if (seconds !== null) return Math.round(seconds / 60)
  const text = firstString(payload, [
    'window',
    'windowLabel',
    'window_label',
    'period',
    'periodLabel',
    'period_label'
  ])
  if (text === null) return null
  const match = text
    .toLowerCase()
    .replace(/\s/g, '')
    .match(/^([0-9]*\.?[0-9]+)(minutes?|mins?|m|hours?|hrs?|hr|h|days?|d)$/)
  if (!match) return null
  const multipliers: Record<string, number> = {
    m: 1,
    min: 1,
    mins: 1,
    minute: 1,
    minutes: 1,
    h: 60,
    hr: 60,
    hrs: 60,
    hour: 60,
    hours: 60,
    d: 1440,
    day: 1440,
    days: 1440
  }
  return Math.round(Number(match[1]) * multipliers[match[2]])
}

function windowDescription(minutes: number | null): string | null {
  if (!minutes || minutes <= 0) return null
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `${days} day${days === 1 ? '' : 's'} window`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} hour${hours === 1 ? '' : 's'} window`
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'} window`
}

/** 认定为配额对象：任一限值/用量/余量/百分比键组存在数字 */
function isQuota(payload: Record<string, unknown> | null): boolean {
  return (
    payload !== null &&
    [LIMIT_KEYS, USED_KEYS, REMAINING_KEYS, PERCENT_USED_KEYS, PERCENT_REMAINING_KEYS].some(
      (keys) => firstNumber(payload, keys) !== null
    )
  )
}

/** 递归收集：数组展开、非对象跳过、配额对象命中即收、否则按键名排序深入 */
function collect(candidate: unknown): Record<string, unknown>[] {
  if (Array.isArray(candidate)) return candidate.flatMap((item) => collect(item))
  const record = recordOf(candidate)
  if (!record) return []
  if (isQuota(record)) return [record]
  return Object.keys(record)
    .sort()
    .flatMap((key) => collect(record[key]))
}

/** Synthetic：GET /v2/quotas 配额查询，字段名宽松匹配（由 CodexBar synthetic.js 1:1 移植） */
export const syntheticStrategy: QuotaStrategy = {
  meta: {
    id: 'synthetic',
    label: 'Synthetic',
    builtin: true,
    credential: 'apiKey',
    description: '配额查询（API Key）'
  },
  async fetch(ctx) {
    // ctx.amountFromPercent 未列入 native ctx 类型；按宿主桥同式实现（hostBridge.amountFromPercent）
    const amountFromPercent = (percent: number, limit: number): number => (limit * percent) / 100

    const parseDate = (value: unknown): Date | null => {
      const number = numberValue(value)
      if (number !== null) {
        if (number > 1000000000000) return ctx.date.unixMillis(number)
        if (number > 1000000000) return ctx.date.unixSeconds(number)
      }
      if (typeof value === 'string') {
        try {
          return ctx.date.iso(value)
        } catch {
          return null
        }
      }
      return null
    }

    const firstDate = (payload: Record<string, unknown>, keys: string[]): Date | null => {
      for (const key of keys) {
        if (payload[key] === null || payload[key] === undefined) continue
        const date = parseDate(payload[key])
        if (date !== null) return date
      }
      return null
    }

    function parseQuota(payload: Record<string, unknown>): ParsedQuota | null {
      let usedPercent = normalizedPercent(firstNumber(payload, PERCENT_USED_KEYS))
      const percentRemaining = normalizedPercent(firstNumber(payload, PERCENT_REMAINING_KEYS))
      if (usedPercent === null && percentRemaining !== null) usedPercent = 100 - percentRemaining

      if (usedPercent === null) {
        let limit = firstNumber(payload, LIMIT_KEYS)
        let used = firstNumber(payload, USED_KEYS)
        let remaining = firstNumber(payload, REMAINING_KEYS)
        if (limit === null && used !== null && remaining !== null) limit = used + remaining
        if (used === null && limit !== null && remaining !== null) used = limit - remaining
        if (remaining === null && limit !== null && used !== null) remaining = Math.max(0, limit - used)
        if (limit !== null && used !== null && limit > 0) {
          usedPercent = ctx.pct(used, limit)
        }
      }
      if (usedPercent === null) return null
      usedPercent = Math.max(0, Math.min(100, usedPercent))

      const minutes = windowMinutes(payload)
      const resetsAt = firstDate(payload, RESET_KEYS)
      const window: QuotaRateWindow = { usedPercent }
      if (minutes !== null) window.windowMinutes = minutes
      if (resetsAt !== null) window.resetsAt = resetsAt.getTime()
      else {
        const description = windowDescription(minutes)
        if (description !== null) window.resetDescription = description
      }
      // JS 会另挂 window.nextRegenPercent，宿主 normalizeWindow 丢弃该字段，移植时省略

      const costLimit = firstCurrency(payload, ['maxCredits', 'max_credits'])
      let cost: QuotaSnapshot['cost'] = null
      if (costLimit !== null) {
        const remaining = firstCurrency(payload, ['remainingCredits', 'remaining_credits'])
        const explicitUsed = firstCurrency(payload, ['usedCredits', 'used_credits'])
        const used =
          explicitUsed !== null
            ? explicitUsed
            : remaining !== null
              ? Math.max(0, costLimit - remaining)
              : amountFromPercent(usedPercent, costLimit)
        cost = { used, limit: costLimit, currency: 'USD', period: 'Weekly' }
        if (resetsAt !== null) cost.resetsAt = resetsAt.getTime()
        // JS 会另挂 cost.nextRegenAmount，宿主与 QuotaCostSnapshot 均不消费，移植时省略
      }
      return { label: firstString(payload, LABEL_KEYS), window, cost }
    }

    const namedQuota = (candidate: unknown, label: string): Record<string, unknown> | null => {
      const record = recordOf(candidate)
      if (!record || !isQuota(record)) return null
      return { label, ...record }
    }

    const response = await ctx.http.getJSON(QUOTAS_URL, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
    if (response.status === 401 || response.status === 403) throw new Error('Invalid Synthetic API credentials')
    if (response.status !== 200) throw new Error(`Synthetic API error: HTTP ${response.status}`)

    const object = response.json
    const root = Array.isArray(object) ? { quotas: object } : object
    const rootRecord = recordOf(root)
    if (!rootRecord) throw new Error('Failed to parse Synthetic response: expected an object or array')

    const data = recordOf(rootRecord.data)
    const slots = [
      namedQuota(rootRecord.rollingFiveHourLimit, 'Rolling five-hour limit') ??
        namedQuota(data?.rollingFiveHourLimit, 'Rolling five-hour limit'),
      namedQuota(rootRecord.weeklyTokenLimit, 'Weekly token limit') ??
        namedQuota(data?.weeklyTokenLimit, 'Weekly token limit'),
      namedQuota(recordOf(rootRecord.search)?.hourly, 'Search hourly') ??
        namedQuota(recordOf(data?.search)?.hourly, 'Search hourly')
    ]

    let parsed: Array<ParsedQuota | null>
    if (slots.some(Boolean)) {
      parsed = slots.map((value) => (value ? parseQuota(value) : null))
    } else {
      const candidates = [
        rootRecord.quotas,
        rootRecord.quota,
        rootRecord.limits,
        rootRecord.usage,
        rootRecord.entries,
        rootRecord.subscription,
        rootRecord.data,
        data?.quotas,
        data?.quota,
        data?.limits,
        data?.usage,
        data?.entries,
        data?.subscription
      ]
      let values: Record<string, unknown>[] = []
      for (const candidate of candidates) {
        values = collect(candidate)
        if (values.length) break
      }
      parsed = values.map(parseQuota).filter((value): value is ParsedQuota => value !== null)
    }
    if (!parsed.some(Boolean)) throw new Error('Failed to parse Synthetic response: Missing quota data.')

    const plan = firstString(rootRecord, PLAN_KEYS) ?? (data ? firstString(data, PLAN_KEYS) : null)
    const snapshot: QuotaSnapshot = {
      primary: parsed[0] ? parsed[0].window : null,
      secondary: parsed[1] ? parsed[1].window : null,
      tertiary: parsed[2] ? parsed[2].window : null,
      identity: plan ? { loginMethod: plan } : {}
    }
    const withCost = parsed.find((value) => value !== null && value.cost !== null)
    if (withCost) snapshot.cost = withCost.cost
    return snapshot
  }
}
