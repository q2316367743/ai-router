import type { QuotaRateWindow, QuotaStrategy } from '@common/types'
import { recordOf } from '../util'

const USAGE_URL = 'https://crof.ai/usage_api/'

/** Crof：GET /usage_api/ 公共用量接口 → 剩余额度与当日请求数（由 CodexBar crof.js 1:1 移植） */
export const crofStrategy: QuotaStrategy = {
  meta: {
    id: 'crof',
    label: 'Crof',
    builtin: true,
    credential: 'apiKey',
    description: '额度查询（API Key）'
  },
  async fetch(ctx) {
    const response = await ctx.http.getJSON(USAGE_URL, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
    if (response.status !== 200) throw new Error(`Crof API error: HTTP ${response.status}`)
    const payload = recordOf(response.json)
    if (!payload) {
      throw new Error('Failed to parse Crof response: expected an object')
    }
    if (typeof payload.credits !== 'number' || !Number.isFinite(payload.credits)) {
      throw new Error('Failed to parse Crof response: credits must be a number')
    }

    function optionalNumber(value: unknown, field: string): number | null {
      if (value === null || value === undefined) return null
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Failed to parse Crof response: ${field} must be a number`)
      }
      return value
    }

    const requestsPlan = optionalNumber(payload.requests_plan, 'requests_plan')
    const usableRequests = optionalNumber(payload.usable_requests, 'usable_requests')
    const credits = Math.max(0, payload.credits)
    const creditsWindow: QuotaRateWindow = {
      usedPercent: credits > 0 ? 0 : 100,
      resetDescription: `$${(Math.floor(credits * 100) / 100).toFixed(2)}`
    }

    if (requestsPlan === null || usableRequests === null) {
      return {
        primary: creditsWindow,
        identity: { loginMethod: 'API key' }
      }
    }

    const clampedRemaining = Math.max(0, Math.min(requestsPlan, usableRequests))
    const remainingPercent =
      requestsPlan > 0 ? Math.max(0, Math.min(100, Math.floor((clampedRemaining / requestsPlan) * 100))) : 0
    const displayedRequests = Math.max(0, usableRequests)
    const requestText = Number.isInteger(displayedRequests)
      ? displayedRequests.toFixed(0)
      : displayedRequests.toFixed(2)
    return {
      primary: {
        usedPercent: 100 - remainingPercent,
        windowMinutes: 1440,
        resetsAt: ctx.date.nextDailyReset('America/Chicago', 0).getTime(),
        resetDescription: `${requestText} requests left`
      },
      secondary: creditsWindow,
      identity: { loginMethod: 'API key' }
    }
  }
}
