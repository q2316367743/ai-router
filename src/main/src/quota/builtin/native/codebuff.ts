import type { QuotaSnapshot, QuotaStrategy } from '@common/types'
import { numOf, pick, recordOf, strOf } from '../util'

const USAGE_URL = 'https://www.codebuff.com/api/v1/usage'
const SUBSCRIPTION_URL = 'https://www.codebuff.com/api/user/subscription'

/** Codebuff：GET /api/v1/usage + /api/user/subscription（Bearer）→ 用量计数与订阅档位 */
export const codebuffStrategy: QuotaStrategy = {
  meta: {
    id: 'codebuff',
    label: 'Codebuff',
    builtin: true,
    credential: 'token',
    description: '账号用量与订阅信息；令牌来自附加配置 token（或本地凭证）',
    settings: [{ key: 'token', title: 'Codebuff 令牌', type: 'secure', hint: '缺省使用提供商 API Key' }]
  },
  async fetch(ctx) {
    const token = strOf(ctx.config.token) ?? (ctx.apiKey.trim() ? ctx.apiKey.trim() : null)
    if (!token) throw ctx.fail.missingCredential('未配置 Codebuff 令牌')
    const headers = { Authorization: `Bearer ${token}` }

    const usageRes = await ctx.http.getJSON(USAGE_URL, { headers })
    if (usageRes.status !== 200) throw ctx.fail.apiFailure(`usage HTTP ${usageRes.status}`)
    const usage = recordOf(usageRes.json)

    const used = numOf(pick(usage, ['used', 'credits_used', 'total_used']))
    const limit = numOf(pick(usage, ['limit', 'credits_limit', 'total_limit', 'quota']))
    const snapshot: QuotaSnapshot = {}
    if (used !== null && limit !== null && limit > 0) {
      snapshot.primary = { usedPercent: (used / limit) * 100, windowMinutes: 30 * 24 * 60, resetsAt: null, resetDescription: '订阅周期' }
    }

    const subRes = await ctx.http.getJSON(SUBSCRIPTION_URL, { headers })
    if (subRes.status === 200) {
      const sub = recordOf(subRes.json)
      const plan = strOf(pick(sub, ['plan', 'tier', 'product_id', 'name']))
      if (plan) snapshot.identity = { loginMethod: `订阅 ${plan}` }
    }
    if (!snapshot.primary && !snapshot.identity) throw ctx.fail.parseFailure('未取到用量或订阅数据')
    return snapshot
  }
}
