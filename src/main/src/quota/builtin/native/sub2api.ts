// Sub2API：自建中转服务用量查询（由 CodexBar sub2api.js 1:1 移植）
import type {
  QuotaDetailRow,
  QuotaHttpResponse,
  QuotaNamedWindow,
  QuotaRateWindow,
  QuotaStrategy
} from '@common/types'
import { recordOf, strOf } from '../util'

interface Sub2apiQuota {
  limit: number
  used: number
  remaining: number
  unit: string | null
}

interface Sub2apiSubscription {
  dailyUsage: number
  weeklyUsage: number
  monthlyUsage: number
  dailyLimit: number | null
  weeklyLimit: number | null
  monthlyLimit: number | null
  expiresAt: number | undefined
}

interface Sub2apiTotals {
  requests: number
  tokens: number
  cost: number
}

/**
 * Sub2API（credential: apiKey）：GET {Base URL}/v1/usage?days=30&timezone=… → 订阅窗口 /
 * 配额 / 附加限流窗口与用量汇总。认证 Bearer：附加配置 SUB2API_API_KEY > 提供商 API Key
 * （脚本路径由宿主附加 Bearer 头，值为空时宿主不附加，这里手动构造并保持一致）。
 */
export const sub2apiStrategy: QuotaStrategy = {
  meta: {
    id: 'sub2api',
    label: 'Sub2API',
    builtin: true,
    credential: 'apiKey',
    description: '自建中转用量；Base URL 取提供商地址',
    settings: [
      { key: 'SUB2API_API_KEY', title: 'API Key', type: 'secure', hint: '可选；缺省使用提供商 API Key' }
    ]
  },
  async fetch(ctx) {
    // 脚本经 endpoints setting 读 Base URL；native 侧契约约定即提供商地址 ctx.baseUrl
    let base = ctx.baseUrl.replace(/\/+$/, '')
    if (!/\/v1(?:\/usage)?$/.test(base)) base += '/v1'
    if (!base.endsWith('/usage')) base += '/usage'
    // 脚本宿主 ctx.env.timeZone 的 native 等价写法（同为进程本地时区）
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const token = strOf(ctx.config.SUB2API_API_KEY) ?? (ctx.apiKey.trim() ? ctx.apiKey.trim() : null)
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    let response: QuotaHttpResponse<string>
    try {
      response = await ctx.http.get(`${base}?days=30&timezone=${encodeURIComponent(timezone)}`, {
        timeoutSeconds: 15,
        headers
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw ctx.fail.networkFailure(`sub2api network error: ${message || String(error)}`)
    }
    if (response.status === 401 || response.status === 403) {
      throw ctx.fail.authenticationExpired(
        'sub2api rejected the API key. Check that the key is active and assigned to a group.'
      )
    }
    if (response.status === 429) throw ctx.fail.rateLimited('sub2api API returned HTTP 429.')
    if (response.status >= 500) {
      throw ctx.fail.providerUnavailable(`sub2api API returned HTTP ${response.status}.`)
    }
    if (response.status < 200 || response.status >= 300) {
      throw ctx.fail.apiFailure(`sub2api API returned HTTP ${response.status}.`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(String(response.bodyText))
    } catch {
      throw ctx.fail.parseFailure('Could not parse sub2api usage: response was not valid JSON')
    }
    const data = recordOf(parsed)
    if (!data) throw ctx.fail.parseFailure('Could not parse sub2api usage: response must be an object')

    const optionalString = (value: unknown, field: string): string | null => {
      if (value === null || value === undefined) return null
      if (typeof value !== 'string') {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} has an invalid type`)
      }
      return value
    }
    const optionalNumber = (value: unknown, field: string): number | null => {
      if (value === null || value === undefined) return null
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} has an invalid type`)
      }
      return value
    }
    const optionalBoolean = (value: unknown, field: string): boolean | null => {
      if (value === null || value === undefined) return null
      if (typeof value !== 'boolean') {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} has an invalid type`)
      }
      return value
    }
    const requiredNumber = (value: unknown, field: string): number => {
      const number = optionalNumber(value, field)
      if (number === null) throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} is required`)
      return number
    }
    const requiredString = (value: unknown, field: string): string => {
      const string = optionalString(value, field)
      if (string === null || !string) {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} is required`)
      }
      return string
    }
    // 快照字段需要 epoch 毫秒：脚本 ctx.date.iso 返回 Date，这里取 getTime()
    const parseDate = (value: unknown, field: string): number | undefined => {
      const text = optionalString(value, field)
      if (text === null) return undefined
      try {
        return ctx.date.iso(text).getTime()
      } catch {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} is not a valid date`)
      }
    }

    optionalString(data.mode, 'mode')
    const isValid = optionalBoolean(data.isValid, 'isValid')
    optionalString(data.status, 'status')
    const planName = optionalString(data.planName, 'planName')
    optionalNumber(data.remaining, 'remaining')
    const balance = optionalNumber(data.balance, 'balance')
    const rootUnit = optionalString(data.unit, 'unit')
    if (isValid === false) {
      throw ctx.fail.authenticationExpired(
        'sub2api rejected the API key. Check that the key is active and assigned to a group.'
      )
    }

    let quota: Sub2apiQuota | null = null
    if (data.quota !== null && data.quota !== undefined) {
      const quotaRecord = recordOf(data.quota)
      if (!quotaRecord) {
        throw ctx.fail.parseFailure('Could not parse sub2api usage: quota must be an object')
      }
      quota = {
        limit: requiredNumber(quotaRecord.limit, 'quota.limit'),
        used: requiredNumber(quotaRecord.used, 'quota.used'),
        remaining: requiredNumber(quotaRecord.remaining, 'quota.remaining'),
        unit: optionalString(quotaRecord.unit, 'quota.unit')
      }
    }
    const unit = rootUnit || (quota && quota.unit) || 'USD'

    let subscription: Sub2apiSubscription | null = null
    if (data.subscription !== null && data.subscription !== undefined) {
      const subscriptionRecord = recordOf(data.subscription)
      if (!subscriptionRecord) {
        throw ctx.fail.parseFailure('Could not parse sub2api usage: subscription must be an object')
      }
      subscription = {
        dailyUsage: optionalNumber(subscriptionRecord.daily_usage_usd, 'subscription.daily_usage_usd') || 0,
        weeklyUsage: optionalNumber(subscriptionRecord.weekly_usage_usd, 'subscription.weekly_usage_usd') || 0,
        monthlyUsage: optionalNumber(subscriptionRecord.monthly_usage_usd, 'subscription.monthly_usage_usd') || 0,
        dailyLimit: optionalNumber(subscriptionRecord.daily_limit_usd, 'subscription.daily_limit_usd'),
        weeklyLimit: optionalNumber(subscriptionRecord.weekly_limit_usd, 'subscription.weekly_limit_usd'),
        monthlyLimit: optionalNumber(subscriptionRecord.monthly_limit_usd, 'subscription.monthly_limit_usd'),
        expiresAt: parseDate(subscriptionRecord.expires_at, 'subscription.expires_at')
      }
    }

    const money = (value: number, valueUnit = 'USD'): string =>
      valueUnit.toUpperCase() === 'USD'
        ? `$${ctx.format.number(value, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}`
        : `${Number(value).toFixed(2)} ${valueUnit}`
    const amount = (used: number, limit: number, valueUnit = 'USD'): string =>
      `${money(used, valueUnit)} / ${money(limit, valueUnit)}`
    const buildWindow = (
      used: number,
      limit: number | null,
      minutes: number | null,
      valueUnit = 'USD'
    ): QuotaRateWindow | null =>
      limit !== null && limit > 0
        ? {
            usedPercent: ctx.pct(used, limit),
            windowMinutes: minutes,
            resetDescription: amount(used, limit, valueUnit)
          }
        : null
    let primary: QuotaRateWindow | null = null
    let secondary: QuotaRateWindow | null = null
    let tertiary: QuotaRateWindow | null = null
    if (subscription) {
      primary = buildWindow(subscription.dailyUsage, subscription.dailyLimit, 1440)
      secondary = buildWindow(subscription.weeklyUsage, subscription.weeklyLimit, 10080)
      tertiary = buildWindow(subscription.monthlyUsage, subscription.monthlyLimit, 43200)
    } else if (quota) {
      primary = buildWindow(quota.used, quota.limit, null, quota.unit || unit)
      if (primary) delete primary.windowMinutes
    }

    let rateLimits: unknown = data.rate_limits
    if (rateLimits === null || rateLimits === undefined) rateLimits = []
    if (!Array.isArray(rateLimits)) {
      throw ctx.fail.parseFailure('Could not parse sub2api usage: rate_limits must be an array')
    }
    const minuteMap: Record<string, number> = { '5h': 300, '1d': 1440, '7d': 10080 }
    const titleMap: Record<string, string> = { '5h': '5 hour limit', '1d': 'Daily limit', '7d': '7 day limit' }
    const extraWindows: QuotaNamedWindow[] = rateLimits.map((rate: unknown, index: number) => {
      const record = recordOf(rate)
      if (!record) {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: rate_limits[${index}] must be an object`)
      }
      const rateWindow = requiredString(record.window, `rate_limits[${index}].window`)
      const limit = requiredNumber(record.limit, `rate_limits[${index}].limit`)
      const used = requiredNumber(record.used, `rate_limits[${index}].used`)
      requiredNumber(record.remaining, `rate_limits[${index}].remaining`)
      const lowered = rateWindow.toLowerCase()
      return {
        id: rateWindow,
        title: titleMap[lowered] || `${rateWindow} limit`,
        window: {
          usedPercent: ctx.pct(used, limit),
          windowMinutes: minuteMap[lowered],
          resetsAt: parseDate(record.reset_at, `rate_limits[${index}].reset_at`),
          resetDescription: amount(used, limit)
        }
      }
    })

    const totals = (value: unknown, field: string): Sub2apiTotals | null => {
      if (value === null || value === undefined) return null
      const record = recordOf(value)
      if (!record) {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} must be an object`)
      }
      const requests = optionalNumber(record.requests, `${field}.requests`) || 0
      const tokens = optionalNumber(record.total_tokens, `${field}.total_tokens`) || 0
      if (!Number.isInteger(requests) || !Number.isInteger(tokens)) {
        throw ctx.fail.parseFailure(`Could not parse sub2api usage: ${field} counts must be integers`)
      }
      return { requests, tokens, cost: optionalNumber(record.actual_cost, `${field}.actual_cost`) || 0 }
    }
    let usage: Record<string, unknown>
    if (data.usage === null || data.usage === undefined) {
      usage = {}
    } else {
      const usageRecord = recordOf(data.usage)
      if (!usageRecord) {
        throw ctx.fail.parseFailure('Could not parse sub2api usage: usage must be an object')
      }
      usage = usageRecord
    }
    const rows: QuotaDetailRow[] = []
    if (balance !== null) {
      rows.push({ label: 'Balance', value: money(balance, unit) })
    }
    const usageSections: Array<[string, Sub2apiTotals | null]> = [
      ['Today', totals(usage.today, 'usage.today')],
      ['All time', totals(usage.total, 'usage.total')]
    ]
    for (const [title, value] of usageSections) {
      if (!value) continue
      rows.push({ label: `${title} requests`, value: ctx.format.number(value.requests) })
      rows.push({
        label: `${title} tokens`,
        value: ctx.format.number(value.tokens),
        secondaryValue: money(value.cost)
      })
    }
    // subscriptionExpiresAt 字段宿主会丢弃，但 parseDate 对顶层 expires_at 的校验副作用需保留
    if (!(subscription && subscription.expiresAt)) {
      parseDate(data.expires_at, 'expires_at')
    }
    return {
      primary,
      secondary,
      tertiary,
      extraWindows,
      identity: { organization: planName ?? undefined, loginMethod: planName ?? undefined },
      details: rows.length ? [{ title: 'Usage summary', rows }] : undefined
    }
  }
}
