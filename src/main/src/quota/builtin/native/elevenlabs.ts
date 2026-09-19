import type { QuotaStrategy } from '@common/types'
import { numOf, recordOf, strOf } from '../util'

const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription'

/** ElevenLabs：GET /v1/user/subscription（xi-api-key 头）→ 字符额度已用/上限 */
export const elevenlabsStrategy: QuotaStrategy = {
  meta: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    builtin: true,
    credential: 'apiKey',
    description: '订阅额度：字符用量 / 套餐上限'
  },
  async fetch(ctx) {
    const res = await ctx.http.getJSON(SUBSCRIPTION_URL, { headers: { 'xi-api-key': ctx.apiKey } })
    if (res.status === 401) throw ctx.fail.missingCredential('ElevenLabs API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    const used = numOf(body?.character_count)
    const limit = numOf(body?.character_limit)
    if (used === null || limit === null || limit <= 0) throw ctx.fail.parseFailure('响应缺少 character_count / character_limit')

    const tier = strOf(body?.tier)
    return {
      primary: { usedPercent: (used / limit) * 100, windowMinutes: null, resetsAt: null, resetDescription: '订阅周期' },
      identity: tier ? { loginMethod: `套餐 ${tier}` } : null
    }
  }
}
