import type { QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

const TEAMS_ROOT = 'https://management-api.x.ai/v1/billing/teams'
const AUTH_EXPIRED_MESSAGE =
  'xAI rejected the Management API key. Create one in the xAI Console under Settings > Management Keys; inference API keys are not accepted.'

/** UTC 时间戳：YYYY-MM-DD HH:mm:ss */
function timestamp(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(
    2,
    '0'
  )}:${String(date.getUTCSeconds()).padStart(2, '0')}`
}

/** xAI：Management API 查询团队预付费余额与近 30 天日用量（由 CodexBar xai.js 1:1 移植） */
export const xaiStrategy: QuotaStrategy = {
  meta: {
    id: 'xai',
    label: 'xAI',
    builtin: true,
    credential: 'apiKey',
    description: '团队账单余额（Management API Key）',
    settings: [{ key: 'XAI_TEAM_ID', title: '团队 ID', hint: '必填；余额与用量按该团队查询' }]
  },
  async fetch(ctx) {
    const team = strOf(ctx.config.XAI_TEAM_ID)
    if (!team || team.includes('/') || team === '.' || team === '..') {
      throw ctx.fail.missingCredential('Missing or invalid xAI team ID')
    }
    const root = `${TEAMS_ROOT}/${encodeURIComponent(team)}`
    const authHeaders = { Authorization: `Bearer ${ctx.apiKey}` }

    const balanceResponse = await ctx.http.getJSON(`${root}/prepaid/balance`, { headers: authHeaders })
    if (balanceResponse.status === 401 || balanceResponse.status === 403) {
      throw ctx.fail.authenticationExpired(AUTH_EXPIRED_MESSAGE)
    }
    if (balanceResponse.status === 404) {
      throw ctx.fail.apiFailure(
        'xAI returned 404 for this team. Check the team ID, and that the Management key belongs to the same team.'
      )
    }
    if (balanceResponse.status === 429) {
      throw ctx.fail.rateLimited('xAI Management API rate limit exceeded. Usage will refresh on the next cycle.')
    }
    if (balanceResponse.status < 200 || balanceResponse.status >= 300) {
      throw ctx.fail.apiFailure(`xAI Management API returned HTTP ${balanceResponse.status}.`)
    }
    const raw = recordOf(recordOf(balanceResponse.json)?.total)?.val
    if (typeof raw !== 'string' || !/^-?\d+(\.\d+)?$/.test(raw.trim())) {
      throw ctx.fail.parseFailure('Could not parse xAI billing data: balance total.val is not a cent amount')
    }
    const balance = -Number(raw) / 100

    const now = ctx.date.now()
    const start = new Date(now)
    start.setUTCDate(start.getUTCDate() - 29)
    start.setUTCHours(0, 0, 0, 0)

    let daily: Array<{ label: string; value: number }> = []
    let partial = false
    let historyAvailable = false
    try {
      const usage = await ctx.http.postJSON(`${root}/usage`, {
        headers: authHeaders,
        body: {
          analyticsRequest: {
            timeRange: { startTime: timestamp(start), endTime: timestamp(now), timezone: 'Etc/GMT' },
            timeUnit: 'TIME_UNIT_DAY',
            values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
            groupBy: [],
            filters: []
          }
        }
      })
      if (usage.status === 401 || usage.status === 403) {
        throw ctx.fail.authenticationExpired(AUTH_EXPIRED_MESSAGE)
      }
      if (usage.status >= 200 && usage.status < 300) {
        const body = recordOf(usage.json)
        const timeSeries = body && Array.isArray(body.timeSeries) ? body.timeSeries : null
        if (!body || timeSeries === null) throw new Error('invalid xAI usage history')

        const totals: Record<string, number> = {}
        for (const series of timeSeries) {
          const seriesRecord = recordOf(series)
          const dataPoints =
            seriesRecord && Array.isArray(seriesRecord.dataPoints) ? seriesRecord.dataPoints : null
          if (!seriesRecord || dataPoints === null) throw new Error('invalid xAI usage history')
          for (const point of dataPoints) {
            const pointRecord = recordOf(point)
            if (!pointRecord) throw new Error('invalid xAI usage history')
            // JS 直接 new Date(point.timestamp)：字符串/数值原样，其余走 Number 强转
            const rawTimestamp = pointRecord.timestamp
            const date = new Date(
              typeof rawTimestamp === 'string' || typeof rawTimestamp === 'number'
                ? rawTimestamp
                : Number(rawTimestamp)
            )
            const values = Array.isArray(pointRecord.values) ? pointRecord.values : null
            const value = values ? values[0] : undefined
            if (
              !Number.isFinite(date.getTime()) ||
              typeof value !== 'number' ||
              !Number.isFinite(value) ||
              value < 0
            ) {
              throw new Error('invalid xAI usage history')
            }
            const day = date.toISOString().slice(0, 10)
            totals[day] = (totals[day] || 0) + value
          }
        }
        daily = Object.keys(totals)
          .sort()
          .map((day) => ({ label: day, value: totals[day] }))
        partial = body.limitReached === true
        historyAvailable = true
      }
    } catch (error) {
      // 认证类失败原样抛出；其余历史失败静默降级为无图表（与 JS 一致）
      if (error instanceof Error && /rejected the Management API key/.test(error.message)) throw error
    }

    return {
      cost: { used: balance, currency: 'USD', period: 'Prepaid credits' },
      identity: { loginMethod: 'Management API' },
      // JS 会另挂 dataConfidence，宿主 normalizeSnapshot 丢弃该字段，移植时省略；partial 仍控制明细文案
      details: [
        {
          title: 'Billing summary',
          rows: [
            { label: 'Prepaid balance', value: `$${balance.toFixed(2)}` },
            {
              label: partial ? 'Last 30 days (partial)' : 'Last 30 days',
              value: `$${daily.reduce((sum, point) => sum + point.value, 0).toFixed(2)}`
            }
          ],
          // 成功拉到历史时即使 0 天也输出图表：用于区分「零花销」与「分析不可用」
          chart: historyAvailable ? { kind: 'bars', title: 'Daily spend', unit: 'USD', points: daily } : undefined
        }
      ]
    }
  }
}
