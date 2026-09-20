import type { QuotaStrategy } from '@common/types'
import { numOf, recordOf, strOf } from '../util'

/** Moonshot：GET /v1/users/me/balance（Bearer），区域决定域名（cn=api.moonshot.cn） */
export const moonshotStrategy: QuotaStrategy = {
  meta: {
    id: 'moonshot',
    label: 'Moonshot AI',
    builtin: true,
    credential: 'apiKey',
    description: '官方余额接口：现金余额 + 代金券余额；附加配置 region=cn 切换中国区',
    settings: [
      {
        key: 'region',
        title: '区域',
        widget: 'select',
        options: [
          { label: '国际区（api.moonshot.ai）', value: 'international' },
          { label: '中国区（api.moonshot.cn）', value: 'cn' }
        ],
        hint: '缺省国际区'
      }
    ]
  },
  async fetch(ctx) {
    const host = strOf(ctx.config.region) === 'cn' ? 'https://api.moonshot.cn' : 'https://api.moonshot.ai'
    const res = await ctx.http.getJSON(`${host}/v1/users/me/balance`, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    })
    if (res.status === 401) throw ctx.fail.missingCredential('Moonshot API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const data = recordOf(recordOf(res.json)?.data)
    const available = numOf(data?.available_balance)
    const cash = numOf(data?.cash_balance)
    const voucher = numOf(data?.voucher_balance)
    if (available === null) throw ctx.fail.parseFailure('响应缺少 data.available_balance')

    const parts: string[] = []
    if (cash !== null) parts.push(`现金 ${cash}`)
    if (voucher !== null) parts.push(`代金券 ${voucher}`)
    return {
      cost: {
        used: 0,
        balance: available,
        currency: String(data?.currency ?? 'CNY'),
        period: '账户余额',
        resetsAt: null
      },
      details: parts.length ? [{ title: '余额明细', rows: [{ label: '构成', value: parts.join(' + ') }] }] : null
    }
  }
}
