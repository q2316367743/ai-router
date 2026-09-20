import type {
  QuotaDetailRow,
  QuotaDetailSection,
  QuotaRateWindow,
  QuotaSnapshot,
  QuotaStrategy,
  QuotaStrategyContext
} from '@common/types'
import { intOf, recordOf, strOf } from '../util'

const API_BASE = 'https://api.openai.com'

interface DayBucket {
  start: number
  end: number
  cost: number
  requests: number
  input: number
  cached: number
  output: number
  tokens: number
  models: Map<string, { requests: number; tokens: number }>
  lines: Map<string, number>
}

interface UsageRange {
  start: number
  end: number
  limit: number
}

function finiteOf(value: unknown, field: string, optional: boolean): number | null {
  if (optional && (value === null || value === undefined || value === '')) return null
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(numeric)) throw new Error(`OpenAI ${field} must be numeric`)
  return numeric
}

function integerOf(value: unknown, field: string, optional: boolean): number | null {
  const numeric = finiteOf(value, field, optional)
  if (numeric === null) return null
  if (!Number.isInteger(numeric)) throw new Error(`OpenAI ${field} must be an integer`)
  return numeric
}

function nameOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** 按 31 天一段切分 historyDays 查询区间（今天 UTC 零点起往前推） */
function rangesOf(historyDays: number): UsageRange[] {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  let cursor = Math.floor(today.getTime() / 1000) - (historyDays - 1) * 86400
  let remaining = historyDays
  const result: UsageRange[] = []
  while (remaining > 0) {
    const limit = Math.min(31, remaining)
    result.push({ start: cursor, end: cursor + limit * 86400, limit })
    cursor += limit * 86400
    remaining -= limit
  }
  return result
}

function queryURL(path: string, range: UsageRange, groupBy: string, page: string | null, projectID: string | null): string {
  const query = [
    `start_time=${range.start}`,
    `end_time=${range.end}`,
    'bucket_width=1d',
    `limit=${range.limit}`,
    `group_by=${encodeURIComponent(groupBy)}`
  ]
  if (projectID) query.push(`project_ids=${encodeURIComponent(projectID)}`)
  if (page) query.push(`page=${encodeURIComponent(page)}`)
  return `${API_BASE}${path}?${query.join('&')}`
}

/** 校验 usage bucket 结构并合入按日聚合表（start_time 相同视为同一天） */
function bucketOf(daily: Map<number, DayBucket>, raw: unknown): { bucket: DayBucket; results: unknown[] } {
  const record = recordOf(raw)
  const start = record ? intOf(record.start_time) : null
  const end = record ? intOf(record.end_time) : null
  const results = record && Array.isArray(record.results) ? record.results : null
  if (start === null || end === null || results === null) throw new Error('Failed to parse OpenAI usage bucket')
  let bucket = daily.get(start)
  if (!bucket) {
    bucket = {
      start,
      end,
      cost: 0,
      requests: 0,
      input: 0,
      cached: 0,
      output: 0,
      tokens: 0,
      models: new Map(),
      lines: new Map()
    }
    daily.set(start, bucket)
  }
  return { bucket, results }
}

/** 分页拉取一段接口的全部 bucket（has_more/next_page 游标 + 环检测 + 100 页上限） */
async function pages(
  ctx: QuotaStrategyContext,
  authHeaders: Record<string, string>,
  projectID: string | null,
  path: string,
  groupBy: string,
  historyDays: number
): Promise<unknown[]> {
  const buckets: unknown[] = []
  for (const range of rangesOf(historyDays)) {
    let page: string | null = null
    const seen = new Set<string>()
    for (let count = 0; count < 100; count += 1) {
      const response = await ctx.http.getJSON(queryURL(path, range, groupBy, page, projectID), {
        headers: authHeaders
      })
      if (response.status !== 200) throw new Error(`OpenAI ${path} error: HTTP ${response.status}`)
      const body = recordOf(response.json)
      const data = body && Array.isArray(body.data) ? body.data : null
      if (!body || data === null || typeof body.has_more !== 'boolean') {
        throw new Error(`Failed to parse OpenAI ${path} page`)
      }
      buckets.push(...data)
      if (!body.has_more) break
      const next = typeof body.next_page === 'string' ? body.next_page.trim() : ''
      if (!next) throw new Error(`OpenAI ${path} pagination cursor missing`)
      if (seen.has(next)) throw new Error(`OpenAI ${path} pagination cursor repeated`)
      seen.add(next)
      page = next
      if (count === 99) throw new Error(`OpenAI ${path} pagination exceeded 100 pages`)
    }
  }
  return buckets
}

/**
 * OpenAI Platform（区别于 Codex 订阅限额）：/v1/organization/costs 与 usage/completions
 * 双分页聚合 → 花费 / Token 明细与日花费图；附加配置 OPENAI_PROJECT_ID 过滤项目、
 * OPENAI_HISTORY_DAYS（1~365，默认 30）控制区间、OPENAI_ALLOW_BALANCE_FALLBACK=1 在
 * 用量接口失败时回落 credit_grants 余额。由 CodexBar openai.js 1:1 移植。
 */
export const openaiStrategy: QuotaStrategy = {
  meta: {
    id: 'openai',
    label: 'OpenAI Platform',
    builtin: true,
    credential: 'apiKey',
    description: 'OpenAI 平台：费用用量与 API 余额（区别于 Codex 订阅限额）',
    settings: [
      { key: 'OPENAI_PROJECT_ID', title: '项目 ID', hint: '仅统计该项目的用量，缺省统计全部' },
      { key: 'OPENAI_HISTORY_DAYS', title: '历史天数', placeholder: '30', hint: '1~365 的整数，缺省 30' },
      {
        key: 'OPENAI_ALLOW_BALANCE_FALLBACK',
        title: '用量失败回落余额',
        widget: 'select',
        options: [
          { label: '关闭', value: '0' },
          { label: '开启', value: '1' }
        ],
        hint: '开启后用量接口失败时改查 credit_grants 余额'
      }
    ]
  },
  async fetch(ctx) {
    const projectID = strOf(ctx.config.OPENAI_PROJECT_ID)
    const rawHistoryDays = Number(strOf(ctx.config.OPENAI_HISTORY_DAYS) ?? '30')
    const historyDays = Number.isInteger(rawHistoryDays) ? Math.max(1, Math.min(365, rawHistoryDays)) : 30
    const authHeaders = { Authorization: `Bearer ${ctx.apiKey}` }
    const numberText = (value: number): string => ctx.format.number(value, { maximumFractionDigits: 1 })

    try {
      const costBuckets = await pages(ctx, authHeaders, projectID, '/v1/organization/costs', 'line_item', historyDays)
      const completionBuckets = await pages(
        ctx,
        authHeaders,
        projectID,
        '/v1/organization/usage/completions',
        'model',
        historyDays
      )
      const daily = new Map<number, DayBucket>()
      for (const raw of costBuckets) {
        const { bucket: day, results } = bucketOf(daily, raw)
        for (const item of results) {
          const record = recordOf(item)
          if (!record) throw new Error('Failed to parse OpenAI cost result')
          const amountRecord = recordOf(record.amount)
          const amount = (amountRecord ? finiteOf(amountRecord.value, 'cost amount', true) : null) ?? 0
          day.cost += amount
          const line = nameOf(record.line_item, 'API')
          day.lines.set(line, (day.lines.get(line) ?? 0) + amount)
        }
      }
      for (const raw of completionBuckets) {
        const { bucket: day, results } = bucketOf(daily, raw)
        for (const item of results) {
          const record = recordOf(item)
          if (!record) throw new Error('Failed to parse OpenAI completion result')
          const input = integerOf(record.input_tokens, 'input_tokens', true) ?? 0
          const cached = integerOf(record.input_cached_tokens, 'input_cached_tokens', true) ?? 0
          const audioInput = integerOf(record.input_audio_tokens, 'input_audio_tokens', true) ?? 0
          const output = integerOf(record.output_tokens, 'output_tokens', true) ?? 0
          const audioOutput = integerOf(record.output_audio_tokens, 'output_audio_tokens', true) ?? 0
          const requests = integerOf(record.num_model_requests, 'num_model_requests', true) ?? 0
          const tokens = input + audioInput + output + audioOutput
          day.requests += requests
          day.input += input + audioInput
          day.cached += cached
          day.output += output + audioOutput
          day.tokens += tokens
          const modelName = nameOf(record.model, 'Responses and Chat Completions')
          const model = day.models.get(modelName) ?? { requests: 0, tokens: 0 }
          model.requests += requests
          model.tokens += tokens
          day.models.set(modelName, model)
        }
      }

      const days = [...daily.values()].sort((a, b) => a.start - b.start)
      const totals = days.reduce(
        (sum, day) => {
          sum.cost += day.cost
          sum.requests += day.requests
          sum.input += day.input
          sum.cached += day.cached
          sum.output += day.output
          sum.tokens += day.tokens
          return sum
        },
        { cost: 0, requests: 0, input: 0, cached: 0, output: 0, tokens: 0 }
      )
      const models = new Map<string, { requests: number; tokens: number }>()
      const lines = new Map<string, number>()
      for (const day of days) {
        for (const [modelName, value] of day.models) {
          const model = models.get(modelName) ?? { requests: 0, tokens: 0 }
          model.requests += value.requests
          model.tokens += value.tokens
          models.set(modelName, model)
        }
        for (const [line, cost] of day.lines) lines.set(line, (lines.get(line) ?? 0) + cost)
      }
      const topModels = [...models.entries()].sort((a, b) => b[1].tokens - a[1].tokens || a[0].localeCompare(b[0]))
      const topLines = [...lines.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      const chartDays = days.slice(-120)
      const summaryRows: QuotaDetailRow[] = [
        { label: 'Spend', value: ctx.format.usd(totals.cost), secondaryValue: `Last ${historyDays} days` },
        { label: 'Requests', value: numberText(totals.requests) },
        {
          label: 'Tokens',
          value: numberText(totals.tokens),
          secondaryValue: `${numberText(totals.input)} input · ${numberText(totals.output)} output`
        },
        { label: 'Cached input', value: numberText(totals.cached) }
      ]
      if (days.length > chartDays.length) {
        summaryRows.push({ label: 'Chart range', value: `Last ${chartDays.length} days` })
      }
      const details: QuotaDetailSection[] = [
        {
          title: 'Usage summary',
          rows: summaryRows,
          chart: {
            kind: 'bars',
            title: 'Daily spend',
            unit: 'USD',
            points: chartDays.map((day) => ({
              label: new Date(day.start * 1000).toISOString().slice(0, 10),
              value: day.cost
            }))
          }
        }
      ]
      if (topModels.length) {
        details.push({
          title: 'Models',
          rows: topModels.slice(0, 24).map(([modelName, value]) => ({
            label: modelName,
            value: `${numberText(value.tokens)} tokens`,
            secondaryValue: `${value.requests} requests`
          }))
        })
      }
      if (topLines.length) {
        details.push({
          title: 'Line items',
          rows: topLines.slice(0, 24).map(([line, lineCost]) => ({ label: line, value: ctx.format.usd(lineCost) }))
        })
      }
      const identity: QuotaSnapshot['identity'] = { loginMethod: projectID ? `Admin API: ${projectID}` : 'Admin API' }
      if (projectID) identity.organization = `Project: ${projectID}`
      return {
        cost: {
          used: totals.cost,
          currency: 'USD',
          period: historyDays === 1 ? 'Today' : `Last ${historyDays} days`
        },
        identity,
        details
      }
    } catch (usageError) {
      if (strOf(ctx.config.OPENAI_ALLOW_BALANCE_FALLBACK) !== '1') throw usageError

      // 余额回落：credit_grants 总量/已用/可用 + 最近一次未过期赠金作为重置时刻
      const response = await ctx.http.getJSON(`${API_BASE}/v1/dashboard/billing/credit_grants`, {
        headers: authHeaders
      })
      if (response.status !== 200) throw usageError
      const body = recordOf(response.json)
      if (!body) throw usageError
      const granted = finiteOf(body.total_granted, 'total_granted', false)
      const used = finiteOf(body.total_used, 'total_used', false)
      const available = finiteOf(body.total_available, 'total_available', false)
      if (granted === null || used === null || available === null) throw usageError
      const grants = recordOf(body.grants)
      const grantsData = grants && Array.isArray(grants.data) ? grants.data : []
      const futureExpiries = grantsData
        .map((item) => {
          const record = recordOf(item)
          return record ? integerOf(record.expires_at, 'expires_at', true) : null
        })
        .filter((value): value is number => value !== null && value * 1000 > Date.now())
        .sort((a, b) => a - b)
      const resetsAt = futureExpiries.length ? futureExpiries[0] * 1000 : null
      const primary: QuotaRateWindow = {
        usedPercent: granted > 0 ? ctx.pct(used, granted) : available > 0 ? 0 : 100,
        resetDescription: `${ctx.format.usd(available)} available`
      }
      if (resetsAt !== null) primary.resetsAt = resetsAt
      const cost: NonNullable<QuotaSnapshot['cost']> = {
        used: Math.max(0, used),
        limit: Math.max(0, granted),
        currency: 'USD',
        period: 'API credits'
      }
      if (resetsAt !== null) cost.resetsAt = resetsAt
      return {
        primary,
        cost,
        identity: { loginMethod: `API balance: ${ctx.format.usd(available)}` },
        details: [
          {
            title: 'API credits',
            rows: [
              { label: 'Available', value: ctx.format.usd(available) },
              { label: 'Used', value: ctx.format.usd(used) },
              { label: 'Granted', value: ctx.format.usd(granted) }
            ]
          }
        ]
      }
    }
  }
}
