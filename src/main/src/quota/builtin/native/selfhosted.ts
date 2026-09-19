import type { QuotaSnapshot, QuotaStrategy } from '@common/types'
import { numOf, pick, recordOf } from '../util'

/** LLMProxy：GET {baseUrl}/v1/quota-stats（Bearer）→ 各凭限额汇总 */
export const llmproxyStrategy: QuotaStrategy = {
  meta: {
    id: 'llmproxy',
    label: 'LLM Proxy',
    builtin: true,
    credential: 'apiKey',
    description: '自建代理服务：Base URL + API Key，读取 /v1/quota-stats'
  },
  async fetch(ctx) {
    if (!ctx.baseUrl) throw ctx.fail.missingCredential('需要在提供商 Base URL 填写代理服务地址')
    const res = await ctx.http.getJSON(`${ctx.baseUrl}/v1/quota-stats`, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    })
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    const active = numOf(pick(body, ['active_count', 'active']))
    const exhausted = numOf(pick(body, ['exhausted_count', 'exhausted']))
    const total = numOf(pick(body, ['credential_count', 'total']))
    if (total === null) throw ctx.fail.parseFailure('响应缺少 credential_count')

    return {
      primary:
        total > 0
          ? { usedPercent: ((exhausted ?? 0) / total) * 100, windowMinutes: null, resetsAt: null, resetDescription: '凭据耗尽占比' }
          : null,
      details: [{ title: '凭据统计', rows: [{ label: '可用 / 耗尽 / 总数', value: `${active ?? '?'} / ${exhausted ?? '?'} / ${total}` }] }]
    }
  }
}

/** LiteLLM：GET {baseUrl}/key/info（Bearer）→ spend / max_budget 预算余量 */
export const litellmStrategy: QuotaStrategy = {
  meta: {
    id: 'litellm',
    label: 'LiteLLM',
    builtin: true,
    credential: 'apiKey',
    description: '自建网关：Base URL + 虚拟密钥，读取 key/info 预算'
  },
  async fetch(ctx) {
    if (!ctx.baseUrl) throw ctx.fail.missingCredential('需要在提供商 Base URL 填写网关地址')
    const res = await ctx.http.getJSON(`${ctx.baseUrl}/key/info`, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    })
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    const info = recordOf(body?.info) ?? body
    const spend = numOf(pick(info, ['spend', 'total_spend']))
    const maxBudget = numOf(pick(info, ['max_budget', 'budget']))
    if (spend === null) throw ctx.fail.parseFailure('响应缺少 info.spend')

    const snapshot: QuotaSnapshot = {
      cost: { used: spend, limit: maxBudget, currency: 'USD', period: '预算周期' }
    }
    if (maxBudget !== null && maxBudget > 0) {
      snapshot.primary = { usedPercent: (spend / maxBudget) * 100, windowMinutes: null, resetsAt: null, resetDescription: '预算上限' }
    }
    return snapshot
  }
}
