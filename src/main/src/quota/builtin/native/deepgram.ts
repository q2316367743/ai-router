import type { QuotaDetailRow, QuotaHttpResponse, QuotaStrategy } from '@common/types'
import { recordOf, strOf } from '../util'

const DEFAULT_API_URL = 'https://api.deepgram.com/v1'

interface UsageTotals {
  hours: number
  totalHours: number
  agentHours: number
  tokensIn: number
  tokensOut: number
  tts: number
  requests: number
}

interface ProjectRef {
  project_id: string
  name: string | null
}

/**
 * Deepgram：遍历（或指定）项目聚合 /usage/breakdown 用量汇总（由 CodexBar deepgram.js 1:1 移植）。
 * 认证为 Token scheme；DEEPGRAM_PROJECT_ID 缺省时先列 /projects 再逐项目累计。
 */
export const deepgramStrategy: QuotaStrategy = {
  meta: {
    id: 'deepgram',
    label: 'Deepgram',
    builtin: true,
    credential: 'apiKey',
    description: '余额与用量（API Key）',
    settings: [
      { key: 'DEEPGRAM_PROJECT_ID', title: 'Project ID', hint: '缺省自动列出账号全部项目' },
      { key: 'DEEPGRAM_API_URL', title: 'API URL', hint: '缺省 https://api.deepgram.com/v1' }
    ]
  },
  async fetch(ctx) {
    const base = (strOf(ctx.config.DEEPGRAM_API_URL) ?? DEFAULT_API_URL).replace(/\/+$/, '')
    const headers = { Authorization: `Token ${ctx.apiKey}` }

    function classifyStatus(status: number): Error {
      if (status === 401) return ctx.fail.authenticationExpired('Deepgram API key is invalid or expired.')
      if (status === 403) {
        return ctx.fail.permissionDenied(
          'Deepgram rejected access: The API key may not have access to the project or the Management API. HTTP 403'
        )
      }
      if (status === 429) return ctx.fail.rateLimited('Deepgram API error: HTTP 429')
      if (status >= 500) return ctx.fail.providerUnavailable(`Deepgram API error: HTTP ${status}`)
      return ctx.fail.apiFailure(`Deepgram API error: HTTP ${status}`)
    }

    async function getJSON(url: string): Promise<unknown> {
      let response: QuotaHttpResponse<string>
      try {
        response = await ctx.http.get(url, { headers })
      } catch (error) {
        const detail = (error instanceof Error && error.message) || String(error)
        throw ctx.fail.networkFailure(`Deepgram network error: ${detail}`)
      }
      if (response.status !== 200) throw classifyStatus(response.status)
      try {
        const parsed: unknown = JSON.parse(response.bodyText ?? '')
        return parsed
      } catch {
        throw ctx.fail.parseFailure('Deepgram parse error: response was not valid JSON')
      }
    }

    function optionalNumber(value: unknown, field: string, integer: boolean): number {
      if (value === null || value === undefined) return 0
      if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
        throw ctx.fail.parseFailure(`Deepgram parse error: ${field} has an invalid number`)
      }
      return value
    }

    function optionalString(value: unknown, field: string): string | null {
      if (value === null || value === undefined) return null
      if (typeof value !== 'string') {
        throw ctx.fail.parseFailure(`Deepgram parse error: ${field} must be a string`)
      }
      return value
    }

    function usagePayload(raw: unknown): UsageTotals & { start: string | null; end: string | null } {
      const payload = recordOf(raw)
      if (!payload || !Array.isArray(payload.results)) {
        throw ctx.fail.parseFailure('Deepgram parse error: usage results must be an array')
      }
      const result: UsageTotals & { start: string | null; end: string | null } = {
        start: optionalString(payload.start, 'start'),
        end: optionalString(payload.end, 'end'),
        hours: 0,
        totalHours: 0,
        agentHours: 0,
        tokensIn: 0,
        tokensOut: 0,
        tts: 0,
        requests: 0
      }
      if (payload.resolution !== null && payload.resolution !== undefined) {
        const resolution = recordOf(payload.resolution)
        if (!resolution) {
          throw ctx.fail.parseFailure('Deepgram parse error: resolution must be an object')
        }
        optionalString(resolution.units, 'resolution.units')
        optionalNumber(resolution.amount, 'resolution.amount', true)
      }
      const resultRows: unknown[] = payload.results
      for (const row of resultRows) {
        const record = recordOf(row)
        if (!record) {
          throw ctx.fail.parseFailure('Deepgram parse error: usage result must be an object')
        }
        result.hours += optionalNumber(record.hours, 'hours', false)
        result.totalHours += optionalNumber(record.total_hours, 'total_hours', false)
        result.agentHours += optionalNumber(record.agent_hours, 'agent_hours', false)
        result.tokensIn += optionalNumber(record.tokens_in, 'tokens_in', true)
        result.tokensOut += optionalNumber(record.tokens_out, 'tokens_out', true)
        result.tts += optionalNumber(record.tts_characters, 'tts_characters', true)
        result.requests += optionalNumber(record.requests, 'requests', true)
      }
      return result
    }

    const configuredProject = strOf(ctx.config.DEEPGRAM_PROJECT_ID)
    let projects: ProjectRef[]
    if (configuredProject) {
      projects = [{ project_id: configuredProject, name: null }]
    } else {
      const payload = await getJSON(`${base}/projects`)
      const root = recordOf(payload)
      if (!root || !Array.isArray(root.projects)) {
        throw ctx.fail.parseFailure('Deepgram parse error: projects must be an array')
      }
      const projectRows: unknown[] = root.projects
      projects = projectRows.map((project, index): ProjectRef => {
        const record = recordOf(project)
        if (!record || typeof record.project_id !== 'string') {
          throw ctx.fail.parseFailure(`Deepgram parse error: projects[${index}].project_id must be a string`)
        }
        return { project_id: record.project_id, name: optionalString(record.name, `projects[${index}].name`) }
      })
    }
    if (!projects.length) {
      throw ctx.fail.apiFailure('Deepgram project ID is invalid or no projects were returned for this API key.')
    }

    const totals: UsageTotals = { hours: 0, totalHours: 0, agentHours: 0, tokensIn: 0, tokensOut: 0, tts: 0, requests: 0 }
    let start: string | null = null
    let end: string | null = null
    for (const project of projects) {
      const summary = usagePayload(
        await getJSON(`${base}/projects/${encodeURIComponent(project.project_id)}/usage/breakdown`)
      )
      if (summary.start && (!start || summary.start < start)) start = summary.start
      if (summary.end && (!end || summary.end > end)) end = summary.end
      for (const field of Object.keys(totals) as Array<keyof UsageTotals>) totals[field] += summary[field]
    }

    const decimal = (value: number): string =>
      ctx.format.number(value, {
        minimumFractionDigits: value === Math.floor(value) ? 0 : 1,
        maximumFractionDigits: 1
      })
    const integer = (value: number): string => ctx.format.number(value, { maximumFractionDigits: 0 })
    const rows: QuotaDetailRow[] = [{ label: 'Requests', value: integer(totals.requests) }]
    if (totals.hours || totals.totalHours) {
      rows.push({
        label: 'Audio',
        value: `${decimal(totals.hours)} hours`,
        secondaryValue: `${decimal(totals.totalHours)} billable hours`
      })
    }
    if (totals.agentHours) rows.push({ label: 'Agent hours', value: decimal(totals.agentHours) })
    if (totals.tokensIn || totals.tokensOut) {
      rows.push({
        label: 'Tokens',
        value: integer(totals.tokensIn + totals.tokensOut)
      })
    }
    if (totals.tts) rows.push({ label: 'TTS characters', value: integer(totals.tts) })
    if (start && end) rows.push({ label: 'Period', value: `${start} to ${end}` })
    const loginMethod =
      projects.length > 1
        ? `${projects.length} projects`
        : `Project: ${projects[0].name || projects[0].project_id}`
    return { identity: { loginMethod }, details: [{ title: 'Usage summary', rows }] }
  }
}
