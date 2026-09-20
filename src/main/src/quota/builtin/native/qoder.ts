import type { QuotaHttpResponse, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

/** 宽松字段读取：对象上取 camel/snake 两个候选字段的第一个真值（对齐 JS 的 || 回落链，非对象视为缺失） */
function fieldOr(record: unknown, camel: string, snake: string): unknown {
  const target = recordOf(record)
  if (!target) return undefined
  return target[camel] || target[snake]
}

/** 数值读取：Number(value[camel] ?? value[snake])，缺失时为 NaN 并继续传播（与 JS 一致） */
function readNumber(record: unknown, camel: string, snake: string): number {
  const target = recordOf(record)
  return Number(target ? (target[camel] ?? target[snake]) : undefined)
}

/**
 * Qoder：GET /api/v2/me/usages/big_model_credits（Cookie）→ 大模型积分用量，
 * qoder.com / qoder.com.cn 双站依次尝试（由 CodexBar qoder.js 1:1 移植）
 */
export const qoderStrategy: QuotaStrategy = {
  meta: {
    id: 'qoder',
    label: 'Qoder',
    builtin: true,
    credential: 'cookie',
    description: '积分用量；需附加配置粘贴浏览器 Cookie（qoder.com）',
    settings: [
      {
        key: 'cookie',
        title: '浏览器 Cookie',
        widget: 'textarea',
        hint: '在浏览器开发者工具复制 qoder.com 请求的 Cookie 头整段粘贴'
      }
    ]
  },
  async fetch(ctx) {
    const cookie = strOf(ctx.config.cookie)
    if (!cookie) throw ctx.fail.missingCredential('请在提供商的附加配置中粘贴 qoder.com 的 Cookie 头')

    let response: QuotaHttpResponse<unknown> | null = null
    for (const site of ['qoder.com', 'qoder.com.cn']) {
      const origin = `https://${site}`
      const candidate = await ctx.http.getJSON(`${origin}/api/v2/me/usages/big_model_credits`, {
        headers: {
          Cookie: cookie,
          Origin: origin,
          Referer: `${origin}/account/usage`,
          'X-Requested-With': 'XMLHttpRequest',
          'Bx-V': '2.5.35'
        }
      })
      if (candidate.status >= 200 && candidate.status < 300) {
        response = candidate
        break
      }
    }
    if (!response) throw new Error('Qoder credentials were rejected')

    const root = recordOf(response.json) ?? {}
    const container: unknown = root.totalQuota || root.total_quota
    const sharedContainer: unknown = root.sharedQuota || root.shared_quota
    const summary: unknown = container ? fieldOr(container, 'quotaSummary', 'quota_summary') : null
    const shared: unknown = sharedContainer
      ? fieldOr(sharedContainer, 'quotaSummary', 'quota_summary')
      : null
    if (!summary) throw new Error('Qoder response is missing quota summary')

    const used =
      readNumber(summary, 'usedValue', 'used_value') +
      (shared ? readNumber(shared, 'usedValue', 'used_value') : 0)
    const total =
      readNumber(summary, 'limitValue', 'limit_value') +
      (shared ? readNumber(shared, 'limitValue', 'limit_value') : 0)
    const percentage = shared
      ? ctx.pct(used, total)
      : Number(
          recordOf(summary)?.usagePercentage ??
            recordOf(summary)?.usage_percentage ??
            ctx.pct(used, total)
        )

    const reset: unknown = root.nextResetAt ?? root.next_reset_at
    const resetsAt: number | null =
      typeof reset === 'number'
        ? reset > 10000000000
          ? ctx.date.unixMillis(reset).getTime()
          : ctx.date.unixSeconds(reset).getTime()
        : reset
          ? ctx.date.iso(String(reset)).getTime()
          : null

    const format = (value: number): string =>
      ctx.format.number(value, { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 })
    return {
      primary: {
        usedPercent: Math.max(0, Math.min(100, percentage)),
        resetsAt,
        resetDescription: `${format(used)} / ${format(total)} credits`
      }
    }
  }
}
