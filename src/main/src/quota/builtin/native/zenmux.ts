import type { QuotaSnapshot, QuotaStrategy } from '@common/types'
import { numOf, pick, recordOf, strOf } from '../util'

const MANAGEMENT_BASE = 'https://zenmux.ai/api/v1/management'

/** ZenMux：GET management/subscription/detail + payg/balance（Bearer）→ 订阅余量 + 按量余额 */
export const zenmuxStrategy: QuotaStrategy = {
  meta: {
    id: 'zenmux',
    label: 'ZenMux',
    builtin: true,
    credential: 'apiKey',
    description: '订阅额度与按量余额双查询'
  },
  async fetch(ctx) {
    const headers = { Authorization: `Bearer ${ctx.apiKey}` }
    const snapshot: QuotaSnapshot = {}

    const subRes = await ctx.http.getJSON(`${MANAGEMENT_BASE}/subscription/detail`, { headers })
    if (subRes.status === 200) {
      const body = recordOf(subRes.json)
      const sub = recordOf(body?.data) ?? body
      const used = numOf(pick(sub, ['used', 'usage', 'used_credits']))
      const limit = numOf(pick(sub, ['limit', 'quota', 'total_credits']))
      if (used !== null && limit !== null && limit > 0) {
        snapshot.primary = {
          usedPercent: (used / limit) * 100,
          windowMinutes: 30 * 24 * 60,
          resetsAt: null,
          resetDescription: '订阅周期'
        }
      }
      const plan = strOf(pick(sub, ['plan_name', 'plan', 'tier']))
      if (plan) snapshot.identity = { loginMethod: plan }
    }

    const paygRes = await ctx.http.getJSON(`${MANAGEMENT_BASE}/payg/balance`, { headers })
    if (paygRes.status === 200) {
      const body = recordOf(paygRes.json)
      const payg = recordOf(body?.data) ?? body
      const balance = numOf(pick(payg, ['balance', 'available', 'remaining', 'total_balance']))
      if (balance !== null) snapshot.cost = { used: 0, balance, currency: 'USD', period: '按量余额' }
    }

    if (!snapshot.primary && !snapshot.cost) {
      throw ctx.fail.parseFailure(`订阅与按量余额均未取到（HTTP ${subRes.status} / ${paygRes.status}）`)
    }
    return snapshot
  }
}

/** NeuralWatt：GET /v1/quota（Bearer）→ kwh 用量/剩余 */
export const neuralwattStrategy: QuotaStrategy = {
  meta: {
    id: 'neuralwatt',
    label: 'NeuralWatt',
    builtin: true,
    credential: 'apiKey',
    description: '算力配额：kwh 用量与剩余'
  },
  async fetch(ctx) {
    const res = await ctx.http.getJSON('https://api.neuralwatt.com/v1/quota', {
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    })
    if (res.status === 401) throw ctx.fail.missingCredential('NeuralWatt API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    const data = recordOf(body?.data) ?? body
    const used = numOf(pick(data, ['kwh_used', 'used']))
    const remaining = numOf(pick(data, ['kwh_remaining', 'remaining']))
    if (used === null && remaining === null) throw ctx.fail.parseFailure('响应缺少 kwh 用量字段')

    return {
      primary:
        used !== null && remaining !== null && used + remaining > 0
          ? { usedPercent: (used / (used + remaining)) * 100, windowMinutes: 30 * 24 * 60, resetsAt: null, resetDescription: '配额周期' }
          : null,
      details: [
        { title: '算力配额', rows: [{ label: '已用 / 剩余 (kWh)', value: `${used ?? '?'} / ${remaining ?? '?'}` }] }
      ]
    }
  }
}
