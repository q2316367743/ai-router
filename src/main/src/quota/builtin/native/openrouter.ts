import type { QuotaDetailRow, QuotaDetailSection, QuotaRateWindow, QuotaSnapshot, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

const DEFAULT_API_BASE = 'https://openrouter.ai/api/v1'
/** 管理凭证绝不跟随用户可配置的 API Base 跳转代理：activity 恒定走官方域名 */
const ACTIVITY_URL = 'https://openrouter.ai/api/v1/activity'
/** credits/key/activity 属可选信息，用短超时避免拖住主快照 */
const OPTIONAL_TIMEOUT_SECONDS = 4

interface CreditsData {
  totalCredits: number
  totalUsage: number
  balance: number
}

function isOfficialAPIBase(value: string): boolean {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)(\/[^?#]*)?$/.exec(value)
  return (
    match !== null &&
    match[1].toLowerCase() === 'https' &&
    ['openrouter.ai', 'openrouter.ai:443'].includes(match[2].toLowerCase()) &&
    match[3] === '/api/v1'
  )
}

function money(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`
}

function degradationReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /timed out|-1001/i.test(message) ? 'Request timed out' : 'Request failed'
}

/**
 * OpenRouter：/credits（账户余额）+ /key（Key 限额与用量）+ /activity（近 30 个已完成 UTC 日活动）
 * 三段独立降级，全部失败才报错。credits/key 走可配置 API Base（Bearer 主 Key）；
 * activity 恒走官方域名，认证用附加配置 OPENROUTER_MANAGEMENT_API_KEY（优先）或主 Key（其为管理 Key 时）。
 * 其余附加配置：OPENROUTER_API_URL / OPENROUTER_HTTP_REFERER / OPENROUTER_X_TITLE。
 * 由 CodexBar openrouter.js 1:1 移植（移植时修正：脚本宿主桥此前忽略 management key 认证标记）。
 */
export const openrouterStrategy: QuotaStrategy = {
  meta: {
    id: 'openrouter',
    label: 'OpenRouter',
    builtin: true,
    credential: 'apiKey',
    description: '额度与用量（API Key）',
    settings: [
      {
        key: 'OPENROUTER_MANAGEMENT_API_KEY',
        title: 'Management API Key',
        type: 'secure',
        hint: '可选；用于查询近 30 天 Activity，普通 Key 查不了'
      },
      {
        key: 'OPENROUTER_API_URL',
        title: 'API Base 覆盖',
        placeholder: 'https://openrouter.ai/api/v1',
        hint: 'credits/key 走此地址；Activity 恒走官方域名'
      },
      { key: 'OPENROUTER_HTTP_REFERER', title: 'HTTP-Referer' },
      { key: 'OPENROUTER_X_TITLE', title: 'X-Title', placeholder: 'ai-router' }
    ]
  },
  async fetch(ctx) {
    function finite(value: unknown, field: string, optional: true): number | null
    function finite(value: unknown, field: string, optional: false): number
    function finite(value: unknown, field: string, optional: boolean): number | null {
      if (optional && (value === null || value === undefined)) return null
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw ctx.fail.parseFailure(`Failed to parse OpenRouter response: ${field} must be a finite number`)
      }
      return value
    }

    const base = (strOf(ctx.config.OPENROUTER_API_URL) ?? DEFAULT_API_BASE).replace(/\/+$/, '')
    const headers: Record<string, string> = {
      'X-Title': strOf(ctx.config.OPENROUTER_X_TITLE) ?? 'ai-router',
      Authorization: `Bearer ${ctx.apiKey}`
    }
    const referer = strOf(ctx.config.OPENROUTER_HTTP_REFERER)
    if (referer) headers['HTTP-Referer'] = referer

    let creditsData: CreditsData | null = null
    let creditsDegradation: string | null = null
    try {
      const response = await ctx.http.get(`${base}/credits`, {
        headers,
        timeoutSeconds: OPTIONAL_TIMEOUT_SECONDS
      })
      if (response.status !== 200) {
        creditsDegradation = `Request returned HTTP ${response.status}`
      } else {
        try {
          const payload: unknown = typeof response.bodyText === 'string' ? JSON.parse(response.bodyText) : null
          const credits = recordOf(recordOf(payload)?.data)
          if (!credits) throw new TypeError('credits.data must be an object')
          const totalCredits = finite(credits.total_credits, 'credits.total_credits', false)
          const totalUsage = finite(credits.total_usage, 'credits.total_usage', false)
          creditsData = { totalCredits, totalUsage, balance: Math.max(0, totalCredits - totalUsage) }
        } catch {
          creditsDegradation = 'Response was invalid'
        }
      }
    } catch (error) {
      creditsDegradation = degradationReason(error)
    }
    if (!creditsData && !creditsDegradation) creditsDegradation = 'Response was unavailable'

    let keyData: Record<string, unknown> | null = null
    let keyDegradation: string | null = null
    try {
      const response = await ctx.http.get(`${base}/key`, {
        headers,
        timeoutSeconds: OPTIONAL_TIMEOUT_SECONDS
      })
      if (response.status !== 200) {
        keyDegradation = `Request returned HTTP ${response.status}`
      } else {
        try {
          const payload: unknown = typeof response.bodyText === 'string' ? JSON.parse(response.bodyText) : null
          const candidate = recordOf(recordOf(payload)?.data)
          if (candidate) {
            for (const field of ['limit', 'limit_remaining', 'usage', 'usage_daily', 'usage_weekly', 'usage_monthly']) {
              finite(candidate[field], `key.${field}`, true)
            }
            const reset = candidate.limit_reset
            if (reset !== null && reset !== undefined && typeof reset !== 'string') {
              throw new TypeError('key.limit_reset must be a string')
            }
            keyData = candidate
          }
        } catch {
          keyDegradation = 'Response was invalid'
        }
      }
    } catch (error) {
      keyDegradation = degradationReason(error)
    }
    if (!keyData && !keyDegradation) keyDegradation = 'Response was unavailable'

    const managementKey = strOf(ctx.config.OPENROUTER_MANAGEMENT_API_KEY)
    const managementKeyConfigured = managementKey !== null
    let activityDegradation: string | null = null
    let activityTokens = 0
    let activityRequests = 0
    let activityModels = 0
    let hasActivityData = false
    if (!managementKeyConfigured && !(isOfficialAPIBase(base) && keyData?.is_management_key === true)) {
      activityDegradation = 'Management API key not configured'
    } else {
      const now = ctx.date.now()
      const latestCompletedDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const latestCompleted = latestCompletedDate.toISOString().slice(0, 10)
      const cutoff = new Date(latestCompletedDate.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const activityHeaders = { Authorization: `Bearer ${managementKey ?? ctx.apiKey}` }
      try {
        const [historyResponse, latestResponse] = await Promise.all([
          ctx.http.get(ACTIVITY_URL, { headers: activityHeaders, timeoutSeconds: OPTIONAL_TIMEOUT_SECONDS }),
          ctx.http.get(`${ACTIVITY_URL}?date=${encodeURIComponent(latestCompleted)}`, {
            headers: activityHeaders,
            timeoutSeconds: OPTIONAL_TIMEOUT_SECONDS
          })
        ])
        if (historyResponse.status !== 200 || latestResponse.status !== 200) {
          const failed = historyResponse.status !== 200 ? historyResponse : latestResponse
          activityDegradation =
            failed.status === 403 ? 'Management API key required' : `Request returned HTTP ${failed.status}`
        } else {
          try {
            const payloads = [historyResponse, latestResponse].map((response) =>
              typeof response.bodyText === 'string' ? JSON.parse(response.bodyText) : null
            )
            const rows = payloads.flatMap((payload) => {
              const data = recordOf(payload)?.data
              if (!Array.isArray(data)) throw new TypeError('activity.data must be an array')
              return data
            })
            if (rows.length > 20000) throw new TypeError('activity.data exceeds 20000 rows')

            // 逐行校验 + 按 (日期,模型,端点,供应商,工作区) 去重，与 CodexBar 行为一致
            const seen = new Map<string, string>()
            const models = new Set<string>()
            let aggregateInput = 0
            let aggregateOutput = 0
            let aggregateReasoning = 0
            let aggregateRequests = 0
            let aggregateCost = 0
            let aggregateEstimatedCost = 0
            for (const [index, row] of rows.entries()) {
              const record = recordOf(row)
              if (!record) throw new TypeError(`activity.data[${index}] must be an object`)
              const rawDate = typeof record.date === 'string' ? record.date.trim() : ''
              if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(rawDate)) {
                throw new TypeError(`activity.data[${index}].date must be YYYY-MM-DD or YYYY-MM-DD HH:MM:SS`)
              }
              const date = rawDate.slice(0, 10)
              const parsedDate = new Date(`${date}T00:00:00Z`)
              if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
                throw new TypeError(`activity.data[${index}].date must be a real calendar date`)
              }
              if (date > latestCompleted) {
                throw new TypeError(`activity.data[${index}].date must be a completed UTC day`)
              }
              if (date < cutoff) continue
              const rawModel = record.model_permaslug ?? record.model
              const model = typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : null
              if (model !== null && model.length > 64) {
                throw new TypeError(`activity.data[${index}].model exceeds 64 characters`)
              }
              const inputTokens = finite(record.prompt_tokens, `activity.data[${index}].prompt_tokens`, false)
              const outputTokens = finite(record.completion_tokens, `activity.data[${index}].completion_tokens`, false)
              const reasoningTokens = finite(record.reasoning_tokens, `activity.data[${index}].reasoning_tokens`, true)
              const requests = finite(record.requests, `activity.data[${index}].requests`, false)
              const meteredCost = finite(record.usage, `activity.data[${index}].usage`, false)
              const estimatedCost = finite(record.byok_usage_inference, `activity.data[${index}].byok_usage_inference`, true) ?? 0
              const cost = meteredCost + estimatedCost
              for (const [field, value] of [
                ['prompt_tokens', inputTokens],
                ['completion_tokens', outputTokens],
                ['reasoning_tokens', reasoningTokens],
                ['requests', requests]
              ] as const) {
                if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
                  throw new TypeError(`activity.data[${index}].${field} must be a nonnegative safe integer`)
                }
              }
              // activity 可能报出超过 completion 的 reasoning 数：两个计数都保留，Token 总量只算 prompt+completion
              if (meteredCost < 0 || estimatedCost < 0 || !Number.isFinite(cost)) {
                throw new TypeError(`activity.data[${index}] spend must be finite and nonnegative`)
              }
              if (!Number.isSafeInteger(inputTokens + outputTokens)) {
                throw new TypeError(`activity.data[${index}] token total overflowed`)
              }
              const identity = JSON.stringify([
                date,
                model,
                record.endpoint_id || null,
                record.provider_name || null,
                record.workspace_id || null
              ])
              const signature = JSON.stringify([inputTokens, outputTokens, reasoningTokens, requests, meteredCost, estimatedCost])
              const prior = seen.get(identity)
              if (prior !== undefined) {
                if (prior !== signature) {
                  throw new TypeError(`activity.data[${index}] conflicts with a duplicate activity row`)
                }
                continue
              }
              seen.set(identity, signature)
              aggregateInput += inputTokens
              aggregateOutput += outputTokens
              aggregateReasoning += reasoningTokens ?? 0
              aggregateRequests += requests
              aggregateCost += cost
              aggregateEstimatedCost += estimatedCost
              if (
                !Number.isSafeInteger(aggregateInput + aggregateOutput) ||
                !Number.isSafeInteger(aggregateReasoning) ||
                !Number.isSafeInteger(aggregateRequests)
              ) {
                throw new TypeError('activity aggregate must be within the safe integer range')
              }
              if (!Number.isFinite(aggregateCost) || !Number.isFinite(aggregateEstimatedCost)) {
                throw new TypeError('activity spend aggregate overflowed')
              }
              if (model) models.add(model)
              if (seen.size > 10000) throw new TypeError('activity.data exceeds 10000 distinct rows')
            }
            hasActivityData = true
            activityTokens = aggregateInput + aggregateOutput
            activityRequests = aggregateRequests
            activityModels = models.size
          } catch {
            activityDegradation = 'Response was invalid'
          }
        }
      } catch (error) {
        activityDegradation = degradationReason(error)
      }
    }
    if (!hasActivityData && !activityDegradation) activityDegradation = 'Response was unavailable'

    let keyLimit: number | null = null
    let keyUsage: number | null = null
    let keyRemaining: number | null = null
    let primary: QuotaRateWindow | null = null
    if (keyData) {
      keyLimit = finite(keyData.limit, 'key.limit', true)
      keyUsage = finite(keyData.usage, 'key.usage', true)
      // 与 Swift 路径一致：优先服务端 reported remaining，其次重置窗口对应用量，最后累计用量
      const limitRemaining = finite(keyData.limit_remaining, 'key.limit_remaining', true)
      let used: number | null
      if (limitRemaining !== null) {
        // 钳到 [0, keyLimit]：remaining 超出上限时按 0% 展示而不是藏起计量条
        used = (keyLimit ?? 0) - Math.min(keyLimit ?? 0, Math.max(0, limitRemaining))
      } else {
        const windowKey =
          keyData.limit_reset === 'daily'
            ? 'usage_daily'
            : keyData.limit_reset === 'weekly'
              ? 'usage_weekly'
              : keyData.limit_reset === 'monthly'
                ? 'usage_monthly'
                : null
        used = windowKey && keyData ? finite(keyData[windowKey], `key.${windowKey}`, true) : null
        if (used === null) used = keyUsage
      }
      if (keyLimit !== null && keyLimit > 0 && used !== null && Number.isFinite(used) && used >= 0) {
        primary = { usedPercent: ctx.pct(used, keyLimit) }
        keyRemaining = Math.max(0, keyLimit - used)
      }
    }

    let cost: QuotaSnapshot['cost'] = null
    // 已设上限的 Key 自带配额计量条，花费周期只能来自其自身计数，不能回落到累计用量
    if (!(keyLimit !== null && keyLimit > 0) && keyData?.is_management_key !== true) {
      const monthly = keyData ? finite(keyData.usage_monthly, 'key.usage_monthly', true) : null
      const used = monthly ?? keyUsage ?? creditsData?.totalUsage ?? null
      if (used !== null) {
        cost = {
          used: Math.max(0, used),
          limit: 0,
          currency: 'USD',
          balance: creditsData?.balance ?? null,
          period:
            monthly !== null ? 'This month (API key)' : keyUsage !== null ? 'Total key usage' : 'Total account usage'
        }
      }
    }

    const details: QuotaDetailSection[] = []
    if (creditsData) {
      details.push({
        title: 'Credits',
        rows: [
          { label: 'Remaining', value: money(creditsData.balance) },
          { label: 'Used', value: money(creditsData.totalUsage) },
          { label: 'Total added', value: money(creditsData.totalCredits) }
        ]
      })
    } else {
      details.push({
        title: 'Credits',
        rows: [{ label: 'Balance', value: 'Unavailable right now', secondaryValue: creditsDegradation ?? undefined }]
      })
    }

    if (keyData) {
      const rows: QuotaDetailRow[] = []
      if (keyLimit !== null && keyLimit > 0) {
        rows.push({ label: 'API key limit', value: money(keyLimit), secondaryValue: 'Spending cap, not balance' })
        if (keyRemaining !== null) rows.push({ label: 'API key remaining', value: money(keyRemaining) })
        if (keyUsage !== null) rows.push({ label: 'API key used', value: money(keyUsage) })
      } else {
        rows.push({ label: 'API key limit', value: 'No limit configured' })
      }
      const resetWindow = typeof keyData.limit_reset === 'string' ? keyData.limit_reset.trim() : ''
      if (resetWindow) rows.push({ label: 'Reset window', value: resetWindow })
      const points: Array<{ label: string; value: number }> = []
      for (const [label, field] of [
        ['Today', 'usage_daily'],
        ['This week', 'usage_weekly'],
        ['This month', 'usage_monthly']
      ] as const) {
        const value = finite(keyData[field], `key.${field}`, true)
        if (value !== null) {
          rows.push({ label, value: money(value) })
          points.push({ label, value })
        }
      }
      details.push({
        title: 'API key',
        rows,
        chart: points.length ? { kind: 'bars', title: 'Key spend', unit: 'USD', points } : null
      })
    } else {
      details.push({
        title: 'API key',
        rows: [{ label: 'API key limit', value: 'Unavailable right now', secondaryValue: keyDegradation ?? undefined }]
      })
    }

    if (hasActivityData) {
      details.push({
        title: 'Activity (last 30 completed UTC days)',
        rows: [
          { label: 'Tokens', value: String(activityTokens) },
          { label: 'Requests', value: String(activityRequests) },
          { label: 'Models', value: String(activityModels) }
        ]
      })
    } else {
      details.push({
        title: 'Spend history',
        rows: [{ label: 'Last 30 days', value: 'Unavailable right now', secondaryValue: activityDegradation ?? undefined }]
      })
    }

    if (!creditsData && !keyData && !hasActivityData) {
      throw ctx.fail.apiFailure(
        `OpenRouter API error: ${keyDegradation ?? creditsDegradation ?? activityDegradation ?? 'unknown'}`
      )
    }

    const snapshot: QuotaSnapshot = {
      identity: creditsData ? { loginMethod: `Balance: ${money(creditsData.balance)}` } : null,
      details
    }
    if (cost) snapshot.cost = cost
    if (primary) snapshot.primary = primary
    return snapshot
  }
}
