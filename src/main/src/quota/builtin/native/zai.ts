import type {
  QuotaDetailRow,
  QuotaDetailSection,
  QuotaRateWindow,
  QuotaSnapshot,
  QuotaStrategy,
  QuotaStrategyContext
} from '@common/types'
import { intOf, recordOf, strOf } from '../util'

/** limit.unit → 窗口分钟倍率（1=天 3=小时 5=分钟 6=周），与 CodexBar zai 插件一致 */
const UNIT_MINUTES: Record<number, number> = { 1: 1440, 3: 60, 5: 1, 6: 10080 }
const UNIT_NAMES: Record<number, string> = { 1: 'day', 3: 'hour', 5: 'minute', 6: 'week' }

interface ParsedLimit {
  type: string
  unit: number
  number: number
  usage: number | null
  remaining: number | null
  percent: number
  windowMinutes: number | null
  /** nextResetTime（epoch ms） */
  reset: number | null
  details: unknown[]
}

/** 查询串去掉旧 type= 参数后追加新值（team scope 用 type=2） */
function withType(url: string, value: number): string {
  const parts = url.split('?')
  const query = parts.length > 1 ? parts.slice(1).join('?').split('&').filter(Boolean) : []
  const filtered = query.filter((item) => decodeURIComponent(item.split('=')[0]) !== 'type')
  filtered.push(`type=${value}`)
  return `${parts[0]}?${filtered.join('&')}`
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value)) throw new Error(`z.ai ${field} must be an integer`)
  return value as number
}

function parseLimit(
  pct: (used: number, limit: number) => number,
  raw: unknown
): ParsedLimit | null {
  const record = recordOf(raw)
  const type = record?.type
  const unit = record ? intOf(record.unit) : null
  const number = record ? intOf(record.number) : null
  const percentage = record ? intOf(record.percentage) : null
  if (typeof type !== 'string' || unit === null || number === null || percentage === null) {
    throw new Error('Failed to parse z.ai limit entry')
  }
  if (type !== 'TOKENS_LIMIT' && type !== 'TIME_LIMIT' && type !== 'CREDIT_LIMIT') return null

  const usage = optionalInteger(record?.usage, 'limit.usage')
  const remaining = optionalInteger(record?.remaining, 'limit.remaining')
  const current = optionalInteger(record?.currentValue, 'limit.currentValue')
  let percent = percentage
  if (usage !== null && usage > 0) {
    let used: number | null = null
    if (remaining !== null)
      used = Math.max(usage - remaining, current === null ? usage - remaining : current)
    else if (current !== null) used = current
    if (used !== null) percent = pct(Math.max(0, Math.min(usage, used)), usage)
  }
  percent = Math.max(0, Math.min(100, percent))

  const multiplier = UNIT_MINUTES[unit]
  const windowMinutes = number > 0 && multiplier !== undefined ? number * multiplier : null
  const reset = optionalInteger(record?.nextResetTime, 'limit.nextResetTime')
  const details = record?.usageDetails ?? []
  if (!Array.isArray(details)) throw new Error('z.ai usageDetails must be an array')
  return { type, unit, number, usage, remaining, percent, windowMinutes, reset, details }
}

function windowOf(limit: ParsedLimit, nowMillis: number): QuotaRateWindow {
  const result: QuotaRateWindow = { usedPercent: limit.percent }
  if (limit.type === 'TIME_LIMIT') {
    // unit=5 & number=1 是月度 MCP 标记，实际窗口按 30 天展示
    if (limit.unit === 5 && limit.number === 1) result.windowMinutes = 30 * 24 * 60
    else if (limit.windowMinutes !== null) result.windowMinutes = limit.windowMinutes
  } else if (limit.windowMinutes !== null) {
    result.windowMinutes = limit.windowMinutes
  }
  // 5 小时 Coding Plan 的重置不可能在 10 小时外：宁可不给时间也不猜时区修正
  const isFiveHourPlan = limit.type !== 'TIME_LIMIT' && limit.windowMinutes === 300
  const resetIsPlausible =
    !isFiveHourPlan || (limit.reset || 0) <= nowMillis + (5 * 3600 + 60) * 1000
  if (limit.reset !== null && resetIsPlausible) result.resetsAt = limit.reset
  if (limit.type === 'TIME_LIMIT') result.resetDescription = 'MCP'
  else if (limit.windowMinutes === 300) result.resetDescription = '5-hour'
  else if (limit.windowMinutes !== null) {
    const name = UNIT_NAMES[limit.unit]
    if (name)
      result.resetDescription = `${limit.number} ${name}${limit.number === 1 ? '' : 's'} window`
  }
  return result
}

function limitRow(label: string, limit: ParsedLimit): QuotaDetailRow {
  const parts: string[] = []
  if (limit.usage !== null) parts.push(`${limit.usage} limit`)
  if (limit.remaining !== null) parts.push(`${limit.remaining} remaining`)
  return {
    label,
    value: `${limit.percent.toFixed(limit.percent % 1 ? 1 : 0)}% used`,
    secondaryValue: parts.join(' · ') || undefined
  }
}

function countdownText(millis: number): string {
  const seconds = Math.max(0, millis / 1000)
  if (seconds < 1) return 'now'
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60
  if (days > 0) {
    if (hours > 0) return `in ${days}d ${hours}h`
    if (minutes > 0) return `in ${days}d ${minutes}m`
    return `in ${days}d`
  }
  if (hours > 0) return minutes > 0 ? `in ${hours}h ${minutes}m` : `in ${hours}h`
  return `in ${totalMinutes}m`
}

/** 峰值 = 工作日 06:00-10:00 UTC（14:00-18:00 UTC+8），周末全天离峰；纯本地时钟函数 */
function quotaRateRow(nowMillis: number): QuotaDetailRow {
  const PEAK_START = 6
  const PEAK_END = 10
  const now = new Date(nowMillis)
  const hour = now.getUTCHours()
  const isPeak =
    now.getUTCDay() >= 1 && now.getUTCDay() <= 5 && hour >= PEAK_START && hour < PEAK_END
  const boundary = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      isPeak ? PEAK_END : PEAK_START
    )
  )
  if (!isPeak) {
    if (hour >= PEAK_START) boundary.setUTCDate(boundary.getUTCDate() + 1)
    while (boundary.getUTCDay() === 0 || boundary.getUTCDay() === 6) {
      boundary.setUTCDate(boundary.getUTCDate() + 1)
    }
  }
  const countdown = countdownText(boundary.getTime() - now.getTime())
  return {
    label: 'Quota rate',
    value: isPeak ? 'Peak' : 'Off-peak',
    secondaryValue: `${isPeak ? 'off-peak' : 'peak'} ${countdown}`
  }
}

/** 1e6/1e9 量级缩写（0/1/2 位小数按量级选择，去尾零） */
function compactTokenCount(value: number): string {
  const divisor = value >= 1_000_000_000 ? 1_000_000_000 : value >= 1_000_000 ? 1_000_000 : null
  if (divisor === null) return String(value)
  const suffix = divisor === 1_000_000_000 ? 'B' : 'M'
  const digits = value >= divisor * 100 ? 0 : value >= divisor * 10 ? 1 : 2
  const scaled = (value / divisor).toFixed(digits)
  return `${scaled.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}${suffix}`
}

interface UsageAggregate {
  points: Array<{ label: string; value: number }>
  totals: Array<{ name: string; tokens: number }>
}

/** 模型用量序列（小时/天粒度），超展示边界直接抛错由调用方吞掉（图表为尽力而为） */
async function modelUsage(
  ctx: QuotaStrategyContext,
  headers: Record<string, string>,
  team: boolean,
  endpoint: string,
  daysBack: number
): Promise<UsageAggregate> {
  const end = ctx.date.now()
  const start = new Date(end)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - Math.max(1, daysBack))
  const rangeEnd = new Date(end)
  rangeEnd.setMinutes(59, 59, 0)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const type = team ? '&type=3' : ''
  const url =
    `${endpoint.split('?')[0]}?startTime=${encodeURIComponent(stamp(start))}` +
    `&endTime=${encodeURIComponent(stamp(rangeEnd))}${type}`
  const response = await ctx.http.getJSON(url, { headers })
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
  const body = recordOf(response.json)
  if (!body || body.success !== true || body.code !== 200)
    throw new Error('invalid model usage response')
  const data = recordOf(body.data) ?? {}
  const labels = Array.isArray(data.x_time) ? data.x_time : []
  const modelList = Array.isArray(data.modelDataList) ? data.modelDataList : []
  const models = modelList.map((model: unknown) => {
    const record = recordOf(model)
    return {
      name: record && typeof record.modelName === 'string' ? record.modelName : 'Unknown',
      tokens:
        record && Array.isArray(record.tokensUsage)
          ? record.tokensUsage.map((value: unknown) => {
              const count = intOf(value)
              return count !== null && count > 0 ? count : 0
            })
          : []
    }
  })
  const points = labels
    .map((label: unknown, index: number) => ({
      label: String(label),
      value: models.reduce((sum, model) => sum + (model.tokens[index] || 0), 0)
    }))
    .filter((point) => point.value > 0)
  const totals = models
    .map((model) => ({
      name: model.name,
      tokens: model.tokens.reduce((sum, value) => sum + value, 0)
    }))
    .filter((item) => item.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
  if (
    points.length > 120 ||
    points.some((point) => !Number.isFinite(point.value) || !ctx.isDetailLabel(point.label)) ||
    totals
      .slice(0, 20)
      .some((item) => !Number.isFinite(item.tokens) || !ctx.isDetailLabel(item.name))
  ) {
    throw new Error('model usage exceeds display bounds')
  }
  return { points, totals }
}

/**
 * Z.ai / GLM（GLM Coding Plan）：配额限额 + 峰值时段 + 月度 MCP + 模型用量图，由 CodexBar zai.js 1:1 移植。
 * 区域按 Base URL 自动推断（bigmodel.cn → 大陆区），可用附加配置 Z_AI_REGION/Z_AI_USAGE_SCOPE/
 * Z_AI_ORGANIZATION/Z_AI_PROJECT/Z_AI_QUOTA_ENDPOINT/Z_AI_MODEL_USAGE_ENDPOINT/Z_AI_BALANCE_ENDPOINT 覆盖。
 */
export const zaiStrategy: QuotaStrategy = {
  meta: {
    id: 'zai',
    label: 'Z.ai / GLM',
    builtin: true,
    credential: 'apiKey',
    description: 'GLM Coding Plan：5 小时 / 每周 / 月度 MCP 限额；区域按 Base URL 自动推断',
    settings: [
      {
        key: 'Z_AI_REGION',
        title: '区域',
        widget: 'select',
        options: [
          { label: '国际区（api.z.ai）', value: 'global' },
          { label: '大陆区（bigmodel.cn）', value: 'bigmodel-cn' }
        ],
        hint: '缺省按提供商 Base URL 是否含 bigmodel.cn 自动推断'
      },
      {
        key: 'Z_AI_USAGE_SCOPE',
        title: '查询范围',
        widget: 'select',
        options: [
          { label: '个人', value: 'personal' },
          { label: '团队', value: 'team' }
        ],
        hint: '团队查询需填写组织与项目'
      },
      { key: 'Z_AI_ORGANIZATION', title: '组织 ID', hint: '查询范围=团队时必填' },
      { key: 'Z_AI_PROJECT', title: '项目 ID', hint: '查询范围=团队时必填' },
      {
        key: 'Z_AI_QUOTA_ENDPOINT',
        title: '配额端点覆盖',
        placeholder: 'https://api.z.ai/api/monitor/usage/quota/limit'
      },
      {
        key: 'Z_AI_MODEL_USAGE_ENDPOINT',
        title: '模型用量端点覆盖',
        placeholder: 'https://api.z.ai/api/monitor/usage/model-usage'
      },
      {
        key: 'Z_AI_BALANCE_ENDPOINT',
        title: '余额端点覆盖（大陆区）',
        placeholder: 'https://www.bigmodel.cn/api/biz/account/query-customer-account-report'
      }
    ]
  },
  async fetch(ctx) {
    const region =
      strOf(ctx.config.Z_AI_REGION) ??
      (/bigmodel\.cn/i.test(ctx.baseUrl) ? 'bigmodel-cn' : 'global')
    const scope = strOf(ctx.config.Z_AI_USAGE_SCOPE) ?? 'personal'
    const organization = strOf(ctx.config.Z_AI_ORGANIZATION)
    const project = strOf(ctx.config.Z_AI_PROJECT)
    if (region !== 'global' && region !== 'bigmodel-cn') throw new Error('Unsupported z.ai region')
    if (scope !== 'personal' && scope !== 'team') throw new Error('Unsupported z.ai usage scope')
    if (scope === 'team' && (!organization || !project)) {
      throw new Error('z.ai team scope needs organization and project')
    }

    const base = region === 'bigmodel-cn' ? 'https://open.bigmodel.cn' : 'https://api.z.ai'
    const quotaEndpoint =
      strOf(ctx.config.Z_AI_QUOTA_ENDPOINT) ?? `${base}/api/monitor/usage/quota/limit`
    const modelUsageEndpoint =
      strOf(ctx.config.Z_AI_MODEL_USAGE_ENDPOINT) ?? `${base}/api/monitor/usage/model-usage`
    const headers: Record<string, string> = { Authorization: `Bearer ${ctx.apiKey}` }
    if (scope === 'team' && organization && project) {
      headers['Bigmodel-Organization'] = organization
      headers['Bigmodel-Project'] = project
    }

    const quotaURL = scope === 'team' ? withType(quotaEndpoint, 2) : quotaEndpoint
    const quotaResponse = await ctx.http.getJSON(quotaURL, { headers })
    if (quotaResponse.status !== 200)
      throw new Error(`z.ai quota API error: HTTP ${quotaResponse.status}`)
    const root = recordOf(quotaResponse.json)
    if (!root || root.success !== true || root.code !== 200) {
      throw new Error(`z.ai quota API error: ${strOf(root?.msg) ?? 'invalid response'}`)
    }
    const data = recordOf(root.data)
    const limitsRaw = data && Array.isArray(data.limits) ? data.limits : null
    if (!limitsRaw) throw new Error('Failed to parse z.ai quota data')

    const nowMillis = ctx.date.nowMillis()
    const limits = limitsRaw
      .map((raw) => parseLimit(ctx.pct, raw))
      .filter((item): item is ParsedLimit => item !== null)
    const tokenLimits = limits
      .filter((item) => item.type === 'TOKENS_LIMIT' || item.type === 'CREDIT_LIMIT')
      .sort(
        (a, b) =>
          (a.windowMinutes ?? Number.MAX_SAFE_INTEGER) -
          (b.windowMinutes ?? Number.MAX_SAFE_INTEGER)
      )
    const timeLimit = limits.filter((item) => item.type === 'TIME_LIMIT').pop() ?? null
    const tokenLimit: ParsedLimit | null = tokenLimits.length
      ? tokenLimits[tokenLimits.length - 1]
      : null
    const primaryLimit: ParsedLimit | null = tokenLimits.length ? tokenLimits[0] : timeLimit

    const detailRows: QuotaDetailRow[] = []
    const sections: QuotaDetailSection[] = [{ title: 'Quota details', rows: detailRows }]
    const snapshot: QuotaSnapshot = {
      primary: primaryLimit ? windowOf(primaryLimit, nowMillis) : null,
      identity: {},
      details: sections
    }
    if (tokenLimits.length >= 2 && tokenLimit) snapshot.secondary = windowOf(tokenLimit, nowMillis)
    if (tokenLimit && timeLimit) {
      snapshot.extraWindows = [
        { id: 'zai-mcp', title: 'MCP', window: windowOf(timeLimit, nowMillis) }
      ]
    }
    if (tokenLimit) {
      detailRows.push(
        limitRow(tokenLimit.type === 'CREDIT_LIMIT' ? 'Credit quota' : 'Token quota', tokenLimit)
      )
    }
    if (tokenLimits.length >= 2 && primaryLimit) {
      detailRows.push(
        limitRow(
          primaryLimit.type === 'CREDIT_LIMIT' ? 'Session credit quota' : 'Session token quota',
          primaryLimit
        )
      )
    }
    const hasCreditLimit = [tokenLimit, primaryLimit].some((item) => item?.type === 'CREDIT_LIMIT')
    if (hasCreditLimit) detailRows.push(quotaRateRow(nowMillis))
    if (timeLimit) {
      detailRows.push(limitRow('MCP quota', timeLimit))
      for (const detail of timeLimit.details.slice(0, 20)) {
        const record = recordOf(detail)
        if (record && typeof record.modelCode === 'string' && intOf(record.usage) !== null) {
          detailRows.push({ label: record.modelCode, value: String(record.usage) })
        }
      }
    }
    const planField = data
      ? [data.planName, data.plan, data.plan_type, data.packageName, data.level].find(
          (value) => typeof value === 'string' && value.trim()
        )
      : undefined
    if (typeof planField === 'string') snapshot.identity = { loginMethod: planField.trim() }

    // 大陆区按量付费账户余额（www.bigmodel.cn 控制台端点，同时接受 Bearer 与裸 Key）；
    // 尽力而为：余额查询失败绝不影响配额展示，超时压到 5s 避免拖住整体
    if (region === 'bigmodel-cn') {
      try {
        const balanceEndpoint =
          strOf(ctx.config.Z_AI_BALANCE_ENDPOINT) ??
          'https://www.bigmodel.cn/api/biz/account/query-customer-account-report'
        const response = await ctx.http.getJSON(balanceEndpoint, {
          headers: { Authorization: `Bearer ${ctx.apiKey}` },
          timeoutSeconds: 5
        })
        const body = recordOf(response.json)
        if (response.status === 200 && body && body.success === true) {
          const balanceData = recordOf(body.data) ?? {}
          const numeric = (value: unknown): number | undefined =>
            value === null || value === undefined ? undefined : Number(value)
          const available = numeric(balanceData.availableBalance)
          const current = numeric(balanceData.balance)
          const value = available !== undefined && Number.isFinite(available) ? available : current
          if (value !== undefined && Number.isFinite(value)) {
            const recharged = numeric(balanceData.rechargeAmount)
            const granted = numeric(balanceData.giveAmount)
            const spent = numeric(balanceData.totalSpendAmount)
            const secondary: string[] = []
            if (recharged !== undefined && Number.isFinite(recharged))
              secondary.push(`recharged ¥${recharged.toFixed(2)}`)
            if (granted !== undefined && Number.isFinite(granted) && granted > 0)
              secondary.push(`granted ¥${granted.toFixed(2)}`)
            if (spent !== undefined && Number.isFinite(spent))
              secondary.push(`spent ¥${spent.toFixed(2)}`)
            detailRows.push({
              label: 'Account balance',
              value: `¥${value.toFixed(2)}`,
              secondaryValue: secondary.join(' · ') || undefined
            })
          }
        }
      } catch {
        // 余额可选，失败静默
      }
    }

    for (const [days, title] of [
      [1, 'Hourly tokens'],
      [30, 'Daily tokens']
    ] as const) {
      try {
        const usage = await modelUsage(ctx, headers, scope === 'team', modelUsageEndpoint, days)
        if (usage.points.length) {
          sections.push({
            title,
            rows: usage.totals.slice(0, 20).map((item) => ({
              label: item.name,
              value: compactTokenCount(item.tokens)
            })),
            chart: { kind: 'bars', title, unit: 'tokens', points: usage.points }
          })
        }
      } catch {
        // 用量图表尽力而为，失败不影响主快照
      }
    }
    return snapshot
  }
}
