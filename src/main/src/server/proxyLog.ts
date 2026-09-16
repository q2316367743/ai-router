import { recordLog, startLog, type RequestLogStart } from '$/db/repo/logRepo'
import { accumulateUsage } from '$/db/repo/usageRepo'
import { refreshTrayUsage } from '$/app/tray'

/** token 用量（透传路径从响应提取，转换路径来自 ai-sdk 统一 usage；均为提供商上报值） */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

export interface ProxyLogEntry {
  path: string
  requestId: string
  publicModel: string
  providerName: string
  upstreamModel: string
  startedAt: number
  status: number
  stream: boolean
  usage: TokenUsage | null
  error: string | null
  /** 出站请求正文（实际发给提供商的 JSON 文本；未发起上游请求时为 null） */
  reqBody: string | null
  /** 出站请求标头（脱敏后的 JSON 文本；未发起上游请求时为 null） */
  reqHeaders: string | null
  /** 响应正文（提供商返回：非流式 JSON 文本 / 流式全部 SSE 文本；无上游响应时为 null） */
  resBody: string | null
  /** 响应标头（提供商响应头 JSON 文本；无上游响应时为 null） */
  resHeaders: string | null
}

/**
 * 请求进入转发前先落 pending 行（失败不影响代理服务）：日志页据此立即显示「进行中」。
 *
 * 只有走到转发阶段的请求（已路由命中）才落 pending：同步拦截的 400/401/404 直接由
 * `recordRequest` 单次写入，不留中间态。用量聚合表不在此阶段累加，口径不变。
 */
export function startRequest(entry: RequestLogStart): void {
  try {
    startLog(entry)
  } catch {
    // pending 落库失败不影响代理
  }
}

/**
 * 请求落库（失败不影响代理服务）：同一次调用同时写入详细日志与用量聚合表。
 *
 * - 详细日志：request_logs，保留 7 天，供日志页排查；按 requestId upsert，
 *   已落 pending 行的请求在此回填状态、耗时、token 与正文标头。
 * - 用量聚合：usage_daily / usage_hourly，永久 + 7 天，供统计看板；成功与失败都会计入请求数，
 *   token 只在成功请求时累加（失败请求 usage 为 null，本地拦截的估算值也不应污染 token 统计）。
 * - 提供商未上报用量时基于请求正文估算，计入 unrecognizedTokens（估算只做一次，两处共用）。
 */
export function recordRequest(entry: ProxyLogEntry): void {
  try {
    const finishedAt = Date.now()
    const usage = entry.usage
    const reported = usage
      ? usage.promptTokens +
        usage.completionTokens +
        usage.reasoningTokens +
        usage.cacheReadTokens +
        usage.cacheWriteTokens
      : 0
    const hasUsage = reported > 0 || (usage?.totalTokens ?? 0) > 0
    const estimated = hasUsage ? 0 : estimateTokens(entry.reqBody)
    const ok = entry.status >= 200 && entry.status < 300
    const durationMs = finishedAt - entry.startedAt

    recordLog({
      path: entry.path,
      requestId: entry.requestId,
      publicModel: entry.publicModel,
      providerName: entry.providerName,
      upstreamModel: entry.upstreamModel,
      startedAt: entry.startedAt,
      finishedAt,
      status: entry.status,
      durationMs,
      stream: entry.stream,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      unrecognizedTokens: estimated,
      totalTokens: hasUsage ? (usage?.totalTokens ?? 0) : estimated,
      requestBody: entry.reqBody,
      requestHeaders: entry.reqHeaders,
      responseBody: entry.resBody,
      responseHeaders: entry.resHeaders,
      error: entry.error
    })

    accumulateUsage({
      providerName: entry.providerName,
      publicModel: entry.publicModel,
      status: entry.status,
      durationMs,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      reasoningTokens: usage?.reasoningTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      totalTokens: hasUsage ? (usage?.totalTokens ?? 0) : estimated,
      unrecognizedTokens: estimated
    })

    if (ok) refreshTrayUsage()
  } catch {
    // 落库失败不影响代理服务
  }
}

/** 入库脱敏：请求头中携带密钥 / 会话的字段 */
const SENSITIVE_REQ_HEADERS: ReadonlySet<string> = new Set(['authorization', 'x-api-key', 'cookie'])
/** 入库脱敏：响应头中携带会话令牌的字段 */
const SENSITIVE_RES_HEADERS: ReadonlySet<string> = new Set(['set-cookie'])

/** 请求标头序列化入库（JSON 文本；剔除鉴权字段；无有效字段返回 null） */
export function serializeOutboundHeaders(headers: Record<string, string>): string | null {
  return stringifyHeaders(headers, SENSITIVE_REQ_HEADERS)
}

/** 响应标头序列化入库（JSON 文本；剔除 set-cookie；无有效字段返回 null） */
export function serializeResponseHeaders(headers: Headers): string | null {
  const record: Record<string, string> = {}
  headers.forEach((value, name) => {
    record[name] = value
  })
  return stringifyHeaders(record, SENSITIVE_RES_HEADERS)
}

function stringifyHeaders(
  source: Record<string, string | string[] | undefined>,
  excluded: ReadonlySet<string>
): string | null {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (excluded.has(name)) continue
    if (typeof value === 'string') out[name] = value
    else if (Array.isArray(value)) out[name] = value.join(', ')
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null
}

/** 兜底估算：提供商未返回用量时按请求正文估算（CJK 字符 1 字 1 token，其余 4 字符 1 token） */
export function estimateTokens(text: string | null): number {
  if (!text) return 0
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/g)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}
