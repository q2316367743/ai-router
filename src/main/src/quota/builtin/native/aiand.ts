import type { QuotaStrategy } from '@common/types'
import { numOf, pick, recordOf } from '../util'

const LOGS_URL = 'https://api.aiand.com/logs'

/** AiAnd：GET /logs（Bearer）→ 聚合请求/额度用量 */
export const aiandStrategy: QuotaStrategy = {
  meta: {
    id: 'aiand',
    label: 'AiAnd',
    builtin: true,
    credential: 'apiKey',
    description: '账号用量日志聚合（API Key 鉴权）'
  },
  async fetch(ctx) {
    const res = await ctx.http.getJSON(LOGS_URL, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
    if (res.status === 401) throw ctx.fail.missingCredential('AiAnd API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    const data = recordOf(body?.data) ?? body
    const used = numOf(pick(data, ['used', 'credits_used', 'total_used', 'usage']))
    const limit = numOf(pick(data, ['limit', 'credits_limit', 'quota', 'total_limit']))
    if (used === null && limit === null) throw ctx.fail.parseFailure('响应缺少用量字段')

    return {
      primary: limit && limit > 0
        ? { usedPercent: ((used ?? 0) / limit) * 100, windowMinutes: 30 * 24 * 60, resetsAt: null, resetDescription: '订阅周期' }
        : null,
      cost: used !== null && limit === null ? { used, currency: 'credit', period: '已用额度' } : null
    }
  }
}
