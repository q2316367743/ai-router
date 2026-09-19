import type { QuotaStrategy } from '@common/types'
import { numOf, pick, recordOf } from '../util'

const USAGE_URL = 'https://api.chutes.ai/users/me/subscription_usage'

/** Chutes：GET /users/me/subscription_usage（Bearer）→ 订阅配额百分比与请求计数 */
export const chutesStrategy: QuotaStrategy = {
  meta: {
    id: 'chutes',
    label: 'Chutes',
    builtin: true,
    credential: 'apiKey',
    description: '订阅用量：配额百分比 / 请求计数 / 硬上限'
  },
  async fetch(ctx) {
    const res = await ctx.http.getJSON(USAGE_URL, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
    if (res.status === 401 || res.status === 403) throw ctx.fail.missingCredential('Chutes API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    const data = recordOf(body?.data) ?? body
    const percentUsed = numOf(pick(data, ['percent_used', 'usagePercent', 'percentUsed']))
    const percentRemaining = numOf(pick(data, ['percent_remaining', 'percentRemaining']))
    const percent = percentUsed ?? (percentRemaining !== null ? 100 - percentRemaining : null)
    const used = numOf(pick(data, ['request_count', 'used']))
    const limit = numOf(pick(data, ['request_limit', 'quota_limit', 'monthly_limit', 'hard_limit']))
    if (percent === null && (used === null || limit === null)) {
      throw ctx.fail.parseFailure('响应缺少配额百分比或计数 Limit 字段')
    }

    return {
      primary: {
        usedPercent: percent ?? ((used ?? 0) / (limit ?? 1)) * 100,
        windowMinutes: 30 * 24 * 60,
        resetsAt: null,
        resetDescription: '订阅周期'
      }
    }
  }
}
