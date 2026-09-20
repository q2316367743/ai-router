import type { QuotaStrategy } from '@common/types'
import { numOf, recordOf } from '../util'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** DeepSeek：GET /user/balance（Bearer）→ balance_infos 首项总余额（按用量计费账户，无限额窗口） */
export const deepseekStrategy: QuotaStrategy = {
  meta: {
    id: 'deepseek',
    label: 'DeepSeek',
    builtin: true,
    credential: 'apiKey',
    description: '官方余额接口：按用量计费账户的人民币/美元余额'
  },
  async fetch(ctx) {
    const res = await ctx.http.getJSON(BALANCE_URL, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    })
    if (res.status === 401) throw ctx.fail.missingCredential('DeepSeek API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const infos = recordOf(res.json)?.balance_infos
    const first = Array.isArray(infos) ? recordOf(infos[0]) : null
    const balance = numOf(first?.total_balance)
    if (balance === null) throw ctx.fail.parseFailure('响应缺少 balance_infos[0].total_balance')

    return {
      cost: {
        used: 0,
        balance,
        currency: String(first?.currency ?? 'CNY'),
        period: '账户余额'
      }
    }
  }
}
