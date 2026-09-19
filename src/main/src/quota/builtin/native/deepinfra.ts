import type { QuotaStrategy } from '@common/types'
import { numOf, recordOf } from '../util'

const USAGE_URL = 'https://api.deepinfra.com/payment/usage?from=current'
const CHECKLIST_URL = 'https://api.deepinfra.com/payment/checklist?compute_owed=true'

/** DeepInfra：GET payment/checklist（Bearer）→ stripe 余额；用量接口补充本期消费 */
export const deepinfraStrategy: QuotaStrategy = {
  meta: {
    id: 'deepinfra',
    label: 'DeepInfra',
    builtin: true,
    credential: 'apiKey',
    description: '账户余额与本期用量（按量计费）'
  },
  async fetch(ctx) {
    const headers = { Authorization: `Bearer ${ctx.apiKey}` }
    const balanceRes = await ctx.http.getJSON(CHECKLIST_URL, { headers })
    if (balanceRes.status === 401) throw ctx.fail.missingCredential('DeepInfra API Key 无效')
    if (balanceRes.status !== 200) throw ctx.fail.apiFailure(`HTTP ${balanceRes.status}`)

    const checklist = recordOf(balanceRes.json)
    let balance = numOf(recordOf(checklist?.data)?.stripe_balance) ?? numOf(checklist?.stripe_balance)
    let used: number | null = null

    const usageRes = await ctx.http.getJSON(USAGE_URL, { headers })
    if (usageRes.status === 200) {
      const usage = recordOf(usageRes.json)
      used = numOf(usage?.usage) ?? numOf(recordOf(usage?.data)?.usage)
    }
    if (balance === null && used === null) throw ctx.fail.parseFailure('未取到余额或用量数据')

    return {
      cost: {
        used: used ?? 0,
        balance: balance ?? null,
        currency: 'USD',
        period: '本期用量'
      }
    }
  }
}
