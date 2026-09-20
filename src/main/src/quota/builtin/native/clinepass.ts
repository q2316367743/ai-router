import type { QuotaHttpResponse, QuotaRateWindow, QuotaSnapshot, QuotaStrategy } from '@common/types'
import { recordOf } from '../util'

const USAGE_LIMITS_URL = 'https://api.cline.bot/api/v1/users/me/plan/usage-limits'

/** Cline Pass：GET /api/v1/users/me/plan/usage-limits → 5 小时 / 周期 / 月度三档用量窗口（由 CodexBar clinepass.js 1:1 移植） */
export const clinepassStrategy: QuotaStrategy = {
  meta: {
    id: 'clinepass',
    label: 'Cline Pass',
    builtin: true,
    credential: 'apiKey',
    description: '订阅用量（API Key）'
  },
  async fetch(ctx) {
    let response: QuotaHttpResponse<string>
    try {
      response = await ctx.http.get(USAGE_LIMITS_URL, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        timeoutSeconds: 15
      })
    } catch (error) {
      const detail = (error instanceof Error && error.message) || String(error)
      throw ctx.fail.networkFailure(`ClinePass network error: ${detail}`)
    }
    if (response.status === 401 || response.status === 403) {
      throw ctx.fail.authenticationExpired('ClinePass API key was rejected.')
    }
    if (response.status === 429) {
      throw ctx.fail.rateLimited('ClinePass API error: HTTP 429')
    }
    if (response.status >= 500) {
      throw ctx.fail.providerUnavailable(`ClinePass API error: HTTP ${response.status}`)
    }
    if (response.status !== 200) {
      throw ctx.fail.apiFailure(`ClinePass API error: HTTP ${response.status}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(response.bodyText ?? '')
    } catch {
      throw ctx.fail.parseFailure('Failed to parse ClinePass response: response was not valid JSON')
    }
    const payload = recordOf(parsed)
    if (!payload) {
      throw ctx.fail.parseFailure('Failed to parse ClinePass response: expected an object')
    }
    if (payload.success !== true) {
      if (payload.success === false) {
        throw ctx.fail.parseFailure('Failed to parse ClinePass response: Response success was false.')
      }
      throw ctx.fail.parseFailure('Failed to parse ClinePass response: success must be a boolean')
    }
    const data = recordOf(payload.data)
    if (!data) {
      throw ctx.fail.parseFailure('Failed to parse ClinePass response: data must be an object')
    }
    if (!Array.isArray(data.limits)) {
      throw ctx.fail.parseFailure('Failed to parse ClinePass response: data.limits must be an array')
    }
    const limitRows: unknown[] = data.limits

    const windows: Record<string, QuotaRateWindow> = {}
    const windowMinutes: Record<string, number> = {
      five_hour: 5 * 60,
      weekly: 7 * 24 * 60,
      monthly: 30 * 24 * 60
    }
    for (const rawLimit of limitRows) {
      const limit = recordOf(rawLimit)
      if (!limit) {
        throw ctx.fail.parseFailure('Failed to parse ClinePass response: limit must be an object')
      }
      if (typeof limit.type !== 'string') {
        throw ctx.fail.parseFailure('Failed to parse ClinePass response: limit type must be a string')
      }
      const minutes = windowMinutes[limit.type]
      if (minutes === undefined) continue
      if (typeof limit.percentUsed !== 'number' || !Number.isFinite(limit.percentUsed)) {
        throw ctx.fail.parseFailure(
          `Failed to parse ClinePass response: percentUsed must be a number for ${limit.type}.`
        )
      }
      let resetsAt: number | undefined
      if (limit.resetsAt !== null && limit.resetsAt !== undefined) {
        if (typeof limit.resetsAt !== 'string') {
          throw ctx.fail.parseFailure(
            `Failed to parse ClinePass response: Invalid resetsAt timestamp for ${limit.type}.`
          )
        }
        try {
          resetsAt = ctx.date.iso(limit.resetsAt).getTime()
        } catch {
          throw ctx.fail.parseFailure(
            `Failed to parse ClinePass response: Invalid resetsAt timestamp for ${limit.type}.`
          )
        }
      }
      windows[limit.type] = {
        usedPercent: Math.min(100, Math.max(0, limit.percentUsed)),
        windowMinutes: minutes,
        resetsAt
      }
    }

    const snapshot: QuotaSnapshot = {
      primary: windows.five_hour,
      secondary: windows.weekly,
      tertiary: windows.monthly,
      identity: { loginMethod: 'API key' }
    }
    return snapshot
  }
}
