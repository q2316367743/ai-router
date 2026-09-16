/** 单条请求日志（列表轻量字段；正文与标头见 RequestLogDetail） */
export interface RequestLogItem {
  id: number
  /** 请求 ID：每次请求入口生成的 UUID */
  requestId: string
  /** 请求 / 完成时间（epoch ms） */
  startedAt: number
  finishedAt: number
  publicModel: string
  providerName: string
  upstreamModel: string
  path: string
  /** 响应状态码；本地拦截时为 400/401/404/502 等 */
  status: number
  durationMs: number
  stream: boolean
  promptTokens: number
  completionTokens: number
  /** 思考 token（提供商上报或 ai-sdk 详情字段） */
  reasoningTokens: number
  /** 缓存读取 / 写入 token */
  cacheReadTokens: number
  cacheWriteTokens: number
  /** 无法识别 token：提供商未返回用量时基于请求正文的兜底估算值 */
  unrecognizedTokens: number
  totalTokens: number
  error: string | null
}

/** 单条请求日志详情（含正文与标头原文；流式响应正文为全部 SSE 文本） */
export interface RequestLogDetail extends RequestLogItem {
  requestBody: string | null
  requestHeaders: string | null
  responseBody: string | null
  responseHeaders: string | null
}

/** 今日汇总统计（概览页） */
export interface TodayStats {
  requestCount: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  unrecognizedTokens: number
  totalTokens: number
}

/** 列表状态筛选口径：成功 = 2xx，失败 = 非 2xx */
export type LogStatusFilter = 'all' | 'success' | 'fail'

/** 日志列表查询参数（跨保留窗口按时间倒序分页；provider/model 为 null 表示不筛选） */
export interface LogListQuery {
  status: LogStatusFilter
  provider: string | null
  model: string | null
  page: number
  pageSize: number
}

/** 日志列表分页结果 */
export interface LogListResult {
  items: RequestLogItem[]
  total: number
}

/** 列表筛选项（现有日志中去重后的供应商 / 请求模型） */
export interface LogFilterOptions {
  providers: string[]
  models: string[]
}
