import type { QuotaRateWindow, QuotaSnapshot, QuotaStrategy } from '@common/types'
import { numOf, percentOf, recordOf, resetsAtOf } from '../util'

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** OpenCode Go：GET /zen/go/v1/usage（Bearer）→ usage.rolling / weekly / monthly 三窗口 */
export const opencodeStrategy: QuotaStrategy = {
  meta: {
    id: 'opencode',
    label: 'OpenCode Zen',
    builtin: true,
    credential: 'apiKey',
    description: 'OpenCode Go 订阅：5 小时 / 每周 / 每月滚动限额（API Key 鉴权）'
  },
  async fetch(ctx) {
    const res = await ctx.http.getJSON(USAGE_URL, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
    if (res.status === 401 || res.status === 403) throw ctx.fail.missingCredential('OpenCode API Key 无效或已过期')
    if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`)

    const usage = recordOf(recordOf(res.json)?.usage)
    const rolling = recordOf(usage?.rolling)
    const percent = percentOf(rolling)
    if (percent === null) throw ctx.fail.parseFailure('响应缺少 usage.rolling 百分比字段')

    const windowOf = (record: Record<string, unknown> | null, minutes: number): QuotaRateWindow => ({
      usedPercent: Math.min(100, Math.max(0, percentOf(record) ?? 0)),
      windowMinutes: minutes,
      resetsAt: resetsAtOf(record)
    })

    const snapshot: QuotaSnapshot = {
      primary: windowOf(rolling, 5 * 60),
      secondary: usage?.weekly ? windowOf(recordOf(usage.weekly), 7 * 24 * 60) : null,
      tertiary: usage?.monthly ? windowOf(recordOf(usage.monthly), 30 * 24 * 60) : null
    }
    const renewsAt = numOf((recordOf(res.json) as Record<string, unknown>)?.renewsAt)
    if (renewsAt && renewsAt > 0) {
      snapshot.identity = { loginMethod: `订阅续期：${new Date(renewsAt < 1e12 ? renewsAt * 1000 : renewsAt).toLocaleDateString()}` }
    }
    return snapshot
  }
}
