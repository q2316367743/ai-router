/** 单条请求日志（仅当天，元数据级） */
export interface RequestLogItem {
  id: number
  createdAt: number
  publicModel: string
  providerName: string
  upstreamModel: string
  path: string
  /** 上游响应状态码；本地拦截时为 401/404/502 等 */
  status: number
  durationMs: number
  stream: boolean
  promptTokens: number
  completionTokens: number
  totalTokens: number
  error: string | null
}

/** 今日汇总统计（概览页） */
export interface TodayStats {
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}
