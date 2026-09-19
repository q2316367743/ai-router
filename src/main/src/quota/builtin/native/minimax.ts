import type { QuotaRateWindow, QuotaStrategy } from '@common/types'
import { numOf, pick, recordOf, strOf } from '../util'

/**
 * MiniMax Coding Plan：GET {区域}/v1/api/openplatform/coding_plan/remains（Bearer）。
 * 附加配置 region=global 切海外（api.minimax.io），默认中国区（api.minimaxi.com）。
 */
export const minimaxStrategy: QuotaStrategy = {
  meta: {
    id: 'minimax',
    label: 'MiniMax',
    builtin: true,
    credential: 'apiKey',
    description: 'Coding Plan 剩余量：当期窗口用量；附加配置 region=global 切海外区'
  },
  async fetch(ctx) {
    const host = strOf(ctx.config.region) === 'global' ? 'https://api.minimax.io' : 'https://api.minimaxi.com'
    const res = await ctx.http.getJSON(`${host}/v1/api/openplatform/coding_plan/remains`, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    })
    if (res.status === 401 || res.status === 403) throw ctx.fail.missingCredential('MiniMax API Key 无效')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const body = recordOf(res.json)
    if (body && numOf(body.base_resp === null ? null : undefined) === null) {
      // base_resp.status_code 非 0 为业务错误（MiniMax 惯例）
      const baseResp = recordOf(body.base_resp)
      const statusCode = numOf(baseResp?.status_code)
      if (statusCode !== null && statusCode !== 0) {
        throw ctx.fail.apiFailure(strOf(baseResp?.status_msg) ?? `业务错误码 ${statusCode}`)
      }
    }

    const data = recordOf(body?.data)
    if (!data) throw ctx.fail.parseFailure('响应缺少 data 字段')

    const windows: QuotaRateWindow[] = []
    const intervalUsed = numOf(pick(data, ['current_interval_usage_count']))
    const intervalTotal = numOf(pick(data, ['current_interval_total_count']))
    if (intervalUsed !== null && intervalTotal !== null && intervalTotal > 0) {
      windows.push({ usedPercent: (intervalUsed / intervalTotal) * 100, windowMinutes: 5 * 60, resetsAt: null })
    }
    const weekUsed = numOf(pick(data, ['current_weekly_usage_count']))
    const weekTotal = numOf(pick(data, ['current_weekly_total_count']))
    if (weekUsed !== null && weekTotal !== null && weekTotal > 0) {
      windows.push({ usedPercent: (weekUsed / weekTotal) * 100, windowMinutes: 7 * 24 * 60, resetsAt: null })
    }
    if (windows.length === 0) throw ctx.fail.parseFailure('响应缺少当期用量计数字段')

    const balance = numOf(pick(data, ['points_balance', 'credit_balance', 'point_balance', 'credits_balance']))
    return {
      primary: windows[0],
      secondary: windows[1] ?? null,
      cost: balance !== null ? { used: 0, balance, currency: 'point', period: '积分余额' } : null
    }
  }
}
