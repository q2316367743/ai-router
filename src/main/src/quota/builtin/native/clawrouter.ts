import type {
  QuotaCostSnapshot,
  QuotaDetailSection,
  QuotaRateWindow,
  QuotaSnapshot,
  QuotaStrategy
} from '@common/types'
import { intOf, recordOf, strOf } from '../util'

const DEFAULT_BASE = 'https://clawrouter.openclaw.ai'

interface ProviderStat {
  provider: string
  requests: number
  success: number
  errors: number
  tokens: number
  cost: number
}

interface ChartItem {
  provider: string
  cost: number
}

/**
 * ClawRouter：GET /usage 账本用量与月度预算查询（由 CodexBar clawrouter.js 1:1 移植）。
 * micros 字段为百万分之一美元的严格整数；windowKey 形如 YYYY-MM，重置时刻取次月 1 日 UTC 零点。
 */
export const clawrouterStrategy: QuotaStrategy = {
  meta: {
    id: 'clawrouter',
    label: 'ClawRouter',
    builtin: true,
    credential: 'apiKey',
    description: '额度查询（API Key）',
    settings: [{ key: 'CLAWROUTER_BASE_URL', title: 'Base URL', hint: '缺省 https://clawrouter.openclaw.ai' }]
  },
  async fetch(ctx) {
    const base = (strOf(ctx.config.CLAWROUTER_BASE_URL) ?? DEFAULT_BASE).replace(/\/+$/, '')
    const url = base.endsWith('/v1') ? `${base}/usage` : `${base}/v1/usage`
    const response = await ctx.http.get(url, { headers: { Authorization: `Bearer ${ctx.apiKey}` } })
    if (response.status === 401 || response.status === 403) {
      throw ctx.fail.authenticationExpired('ClawRouter rejected the API key. Check the key and its policy status.')
    }
    if (response.status === 429) throw ctx.fail.rateLimited('ClawRouter API returned HTTP 429.')
    if (response.status >= 500) {
      throw ctx.fail.providerUnavailable(`ClawRouter API returned HTTP ${response.status}.`)
    }
    if (response.status < 200 || response.status >= 300) {
      throw ctx.fail.apiFailure(`ClawRouter API returned HTTP ${response.status}.`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(response.bodyText ?? '')
    } catch {
      throw ctx.fail.parseFailure('Could not parse ClawRouter usage: response was not valid JSON')
    }
    const root = recordOf(parsed)
    if (!root || !root.budget || !root.usage) {
      throw ctx.fail.parseFailure('Could not parse ClawRouter usage: response shape is invalid')
    }
    const usage = recordOf(root.usage)
    if (!usage || !usage.summary || !Array.isArray(usage.providers)) {
      throw ctx.fail.parseFailure('Could not parse ClawRouter usage: response shape is invalid')
    }
    const providerRows: unknown[] = usage.providers

    function integerOf(value: unknown, field: string): number {
      const parsed = intOf(value)
      if (parsed === null) {
        throw ctx.fail.parseFailure(`Could not parse ClawRouter usage: ${field} must be an integer`)
      }
      return parsed
    }
    function microsOf(value: unknown, field: string, optional: true): number | null
    function microsOf(value: unknown, field: string, optional: false): number
    function microsOf(value: unknown, field: string, optional: boolean): number | null {
      if (optional && (value === null || value === undefined)) return null
      return integerOf(value, field) / 1000000
    }
    function monthlyReset(windowKey: unknown): number | null {
      if (typeof windowKey !== 'string') return null
      const match = /(\d{4})-(\d{2})$/.exec(windowKey)
      if (!match) return null
      let year = Number(match[1])
      let month = Number(match[2]) + 1
      if (month === 13) {
        year += 1
        month = 1
      }
      return ctx.date.iso(`${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`).getTime()
    }

    const budget = recordOf(root.budget)
    if (!budget || typeof budget.configured !== 'boolean' || typeof budget.ledger !== 'string') {
      throw ctx.fail.parseFailure('Could not parse ClawRouter usage: budget is invalid')
    }
    const limit = microsOf(budget.limitMicros, 'budget.limitMicros', true)
    const spent = microsOf(budget.spentMicros, 'budget.spentMicros', true)
    const remaining = microsOf(budget.remainingMicros, 'budget.remainingMicros', true)
    const resetsAt = monthlyReset(budget.windowKey)
    const summary = recordOf(usage.summary)
    const requestCount = integerOf(summary?.requestCount, 'summary.requestCount')
    const successCount = integerOf(summary?.successCount, 'summary.successCount')
    const errorCount = integerOf(summary?.errorCount, 'summary.errorCount')
    const inputTokens = integerOf(summary?.inputTokens, 'summary.inputTokens')
    const outputTokens = integerOf(summary?.outputTokens, 'summary.outputTokens')
    const totalTokens = integerOf(summary?.totalTokens, 'summary.totalTokens')
    const actualCost = microsOf(summary?.actualCostMicros, 'summary.actualCostMicros', false)

    const providers: ProviderStat[] = providerRows
      .map((item): ProviderStat => {
        const record = recordOf(item)
        if (!record || typeof record.provider !== 'string') {
          throw ctx.fail.parseFailure('Could not parse ClawRouter usage: provider name must be a string')
        }
        return {
          provider: record.provider.trim() || 'Unknown',
          requests: integerOf(record.requestCount, 'provider.requestCount'),
          success: integerOf(record.successCount, 'provider.successCount'),
          errors: integerOf(record.errorCount, 'provider.errorCount'),
          tokens: integerOf(record.totalTokens, 'provider.totalTokens'),
          cost: microsOf(record.actualCostMicros, 'provider.actualCostMicros', false)
        }
      })
      .sort((a, b) => b.cost - a.cost || b.requests - a.requests || a.provider.localeCompare(b.provider))

    const details: QuotaDetailSection[] = [
      {
        title: 'Usage',
        rows: [
          {
            label: 'Requests',
            value: String(requestCount),
            secondaryValue: `${successCount} succeeded · ${errorCount} failed`
          },
          {
            label: 'Tokens',
            value: String(totalTokens),
            secondaryValue: `${inputTokens} input · ${outputTokens} output`
          },
          { label: 'Actual cost', value: `$${actualCost.toFixed(6)}` },
          { label: 'Budget ledger', value: budget.ledger }
        ]
      }
    ]
    const snapshot: QuotaSnapshot = {
      identity: {
        organization: `${providers.length} routed providers`,
        loginMethod: budget.configured ? 'Managed monthly budget' : 'Unmetered'
      },
      details
    }

    if (spent !== null && limit !== null) {
      if (limit > 0) {
        const primary: QuotaRateWindow = { usedPercent: ctx.pct(spent, limit) }
        if (resetsAt !== null) primary.resetsAt = resetsAt
        snapshot.primary = primary
      }
      const cost: QuotaCostSnapshot = { used: spent, limit, currency: 'USD', period: 'This month' }
      if (resetsAt !== null) cost.resetsAt = resetsAt
      snapshot.cost = cost
      details[0].rows.push({
        label: 'Monthly budget',
        value: `$${spent.toFixed(6)} / $${limit.toFixed(2)}`,
        secondaryValue: remaining === null ? undefined : `$${remaining.toFixed(6)} remaining`
      })
    } else if (actualCost > 0) {
      const cost: QuotaCostSnapshot = { used: actualCost, currency: 'USD', period: 'This month' }
      if (resetsAt !== null) cost.resetsAt = resetsAt
      snapshot.cost = cost
    }

    if (providers.length) {
      let visible: ChartItem[] = providers
      if (providers.length > 119) {
        const kept: ChartItem[] = providers.slice(0, 119)
        const other = providers.slice(119).reduce<number>((sum, item) => sum + item.cost, 0)
        visible = kept.concat([{ provider: 'Other', cost: other }])
      }
      details.push({
        title: 'Routed providers',
        rows: providers.slice(0, 20).map((item) => ({
          label: item.provider,
          value: `${item.requests} requests`,
          secondaryValue: `$${item.cost.toFixed(6)} · ${item.tokens} tokens`
        })),
        chart: {
          kind: 'bars',
          title: 'Provider cost',
          unit: 'USD',
          points: visible.map((item) => ({ label: item.provider, value: item.cost }))
        }
      })
    }
    return snapshot
  }
}
