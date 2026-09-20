import type { QuotaRateWindow, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

/**
 * Perplexity：GET /rest/billing/credits（Cookie）→ credit_grants 按
 * recurring / promotional / purchased 三类拆分为主/次/第三窗口（由 CodexBar perplexity.js 1:1 移植）
 */
export const perplexityStrategy: QuotaStrategy = {
  meta: {
    id: 'perplexity',
    label: 'Perplexity',
    builtin: true,
    credential: 'cookie',
    description: '余额查询；需附加配置粘贴浏览器 Cookie',
    settings: [
      {
        key: 'cookie',
        title: '浏览器 Cookie',
        widget: 'textarea',
        hint: '在浏览器开发者工具复制 www.perplexity.ai 请求的 Cookie 头整段粘贴'
      }
    ]
  },
  async fetch(ctx) {
    const cookie = strOf(ctx.config.cookie)
    if (!cookie) {
      throw ctx.fail.missingCredential('请在提供商的附加配置中粘贴 www.perplexity.ai 的 Cookie 头')
    }

    const response = await ctx.http.getJSON(
      'https://www.perplexity.ai/rest/billing/credits?version=2.18&source=default',
      {
        headers: {
          Cookie: cookie,
          Origin: 'https://www.perplexity.ai',
          Referer: 'https://www.perplexity.ai/account/usage'
        }
      }
    )
    if (response.status !== 200) throw new Error(`Perplexity API error: HTTP ${response.status}`)
    const data = recordOf(response.json) ?? {}

    const grantsRaw: unknown = data.credit_grants || data.creditGrants || []
    if (!Array.isArray(grantsRaw)) throw new TypeError('grants.filter is not a function')
    const grants: unknown[] = grantsRaw
    const now = Date.now() / 1000

    const amount = (grant: unknown): number => {
      const record = recordOf(grant)
      return Number((record?.amount_cents ?? record?.amountCents) ?? 0)
    }
    const grantType = (grant: unknown): unknown => recordOf(grant)?.type

    const recurring = grants
      .filter((grant) => grantType(grant) === 'recurring')
      .reduce<number>((sum, grant) => sum + amount(grant), 0)
    const promoGrants = grants.filter(
      (grant) =>
        grantType(grant) === 'promotional' &&
        Number((recordOf(grant)?.expires_at_ts ?? recordOf(grant)?.expiresAtTs) ?? Infinity) > now
    )
    const promo = promoGrants.reduce<number>((sum, grant) => sum + amount(grant), 0)
    const purchasedGrants = grants
      .filter((grant) => grantType(grant) === 'purchased')
      .reduce<number>((sum, grant) => sum + amount(grant), 0)
    const purchased = Math.max(
      purchasedGrants,
      Number((data.current_period_purchased_cents ?? data.currentPeriodPurchasedCents) ?? 0)
    )

    // 依次扣减：recurring → purchased → promo
    let remaining = Number((data.total_usage_cents ?? data.totalUsageCents) ?? 0)
    const recurringUsed = Math.min(remaining, recurring)
    remaining -= recurringUsed
    const purchasedUsed = Math.min(remaining, purchased)
    remaining -= purchasedUsed
    const promoUsed = Math.min(remaining, promo)

    const renewal = Number(data.renewal_date_ts ?? data.renewalDateTs)
    const promoExpiry = promoGrants
      .map((grant) => Number(recordOf(grant)?.expires_at_ts ?? recordOf(grant)?.expiresAtTs))
      .filter(Number.isFinite)
      .sort()[0]

    const integer = (value: number): string => String(Math.round(value))
    const promoDescription = `${integer(promoUsed)}/${integer(promo)} bonus`

    const primary: QuotaRateWindow | null =
      recurring > 0
        ? {
            usedPercent: ctx.pct(recurringUsed, recurring),
            resetsAt: ctx.date.unixSeconds(renewal).getTime(),
            resetDescription: `${integer(recurringUsed)}/${integer(recurring)} credits`
          }
        : promo > 0 || purchased > 0
          ? null
          : {
              usedPercent: 100,
              resetsAt: ctx.date.unixSeconds(renewal).getTime(),
              resetDescription: '0/0 credits'
            }
    const secondary: QuotaRateWindow = {
      usedPercent: promo > 0 ? ctx.pct(promoUsed, promo) : 100,
      resetDescription: promoExpiry
        ? `${promoDescription} · exp. ${ctx.format.monthDay(new Date(promoExpiry * 1000))}`
        : promoDescription
    }
    const tertiary: QuotaRateWindow = {
      usedPercent: purchased > 0 ? ctx.pct(purchasedUsed, purchased) : 100,
      resetDescription: `${integer(purchasedUsed)}/${integer(purchased)} credits`
    }
    return {
      primary,
      secondary,
      tertiary,
      identity: { loginMethod: recurring <= 0 ? undefined : recurring < 5000 ? 'Pro' : 'Max' }
    }
  }
}
