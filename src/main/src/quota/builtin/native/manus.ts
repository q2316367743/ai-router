import type { QuotaRateWindow, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

const CREDITS_URL = 'https://api.manus.im/user.v1.UserService/GetAvailableCredits'
const CREDIT_KEYS = [
  'totalCredits',
  'freeCredits',
  'periodicCredits',
  'addonCredits',
  'refreshCredits',
  'maxRefreshCredits',
  'proMonthlyCredits',
  'eventCredits'
]

/**
 * Manus：POST /user.v1.UserService/GetAvailableCredits（Cookie 中 session_id 作 Bearer）
 * → 积分余额：月度积分 + 刷新积分双窗口（由 CodexBar manus.js 1:1 移植）
 */
export const manusStrategy: QuotaStrategy = {
  meta: {
    id: 'manus',
    label: 'Manus',
    builtin: true,
    credential: 'cookie',
    description: '积分余额；需附加配置粘贴浏览器 Cookie',
    settings: [
      {
        key: 'cookie',
        title: '浏览器 Cookie',
        widget: 'textarea',
        hint: '在浏览器开发者工具复制 manus.im 请求的 Cookie 头整段粘贴'
      }
    ]
  },
  async fetch(ctx) {
    const cookies = strOf(ctx.config.cookie)
    if (!cookies) throw ctx.fail.missingCredential('请在提供商的附加配置中粘贴 manus.im 的 Cookie 头')
    const match = /(?:^|;\s*)session_id=([^;]+)/i.exec(cookies)
    if (!match) throw new Error('Manus session cookie is missing')

    const response = await ctx.http.postJSON(CREDITS_URL, {
      body: {},
      headers: {
        Authorization: `Bearer ${match[1]}`,
        Origin: 'https://manus.im',
        Referer: 'https://manus.im/',
        'Connect-Protocol-Version': '1'
      }
    })
    if (response.status !== 200) throw new Error(`Manus API error: HTTP ${response.status}`)

    const root = recordOf(response.json) ?? {}
    const data: unknown = root.data ?? root.result ?? root.response ?? root.availableCredits ?? root
    const record = recordOf(data)
    const hasCreditField = record
      ? CREDIT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key))
      : false
    if (!record || !hasCreditField) {
      throw new Error('Manus response missing expected credits fields')
    }

    const number = (key: string): number => Number(record[key] || 0)
    const total = number('totalCredits')
    const free = number('freeCredits')
    const monthly = number('proMonthlyCredits')
    const periodic = number('periodicCredits')
    const refresh = number('refreshCredits')
    const maxRefresh = number('maxRefreshCredits')
    const format = (value: number): string =>
      ctx.format.number(Math.round(value), { maximumFractionDigits: 0 })

    const primary: QuotaRateWindow | null =
      monthly > 0
        ? {
            usedPercent: ctx.pct(monthly - periodic, monthly),
            resetDescription: `Total ${format(total)} • Free ${format(free)}`
          }
        : null
    const secondary: QuotaRateWindow | null =
      maxRefresh > 0
        ? {
            usedPercent: ctx.pct(maxRefresh - refresh, maxRefresh),
            resetsAt: record.nextRefreshTime
              ? ctx.date.iso(String(record.nextRefreshTime)).getTime()
              : null,
            resetDescription: record.refreshInterval
              ? `${String(record.refreshInterval).replace(/^./, (value) => value.toUpperCase())}: ${format(refresh)} / ${format(maxRefresh)}`
              : `${format(refresh)} / ${format(maxRefresh)}`
          }
        : null
    return {
      primary,
      secondary,
      identity: { loginMethod: `Balance: ${format(total)} credits` }
    }
  }
}
