import { recordLog } from '$/db/repo/logRepo'
import { addUsage } from '$/db/repo/usageRepo'
import { refreshTrayUsage } from '$/app/tray'

/** token 用量（透传路径从响应提取，转换路径来自 ai-sdk 统一 usage） */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ProxyLogEntry {
  path: string
  publicModel: string
  providerName: string
  upstreamModel: string
  startedAt: number
  status: number
  stream: boolean
  usage: TokenUsage | null
  error: string | null
}

/** 请求日志落库（失败不影响代理服务） */
export function recordLocalLog(entry: ProxyLogEntry): void {
  try {
    recordLog({
      publicModel: entry.publicModel,
      providerName: entry.providerName,
      upstreamModel: entry.upstreamModel,
      path: entry.path,
      status: entry.status,
      durationMs: Date.now() - entry.startedAt,
      stream: entry.stream,
      promptTokens: entry.usage?.promptTokens ?? 0,
      completionTokens: entry.usage?.completionTokens ?? 0,
      totalTokens: entry.usage?.totalTokens ?? 0,
      error: entry.error
    })
  } catch {
    // 日志落库失败不影响代理服务
  }
}

/** 用量落库并刷新托盘（失败不影响代理服务） */
export function addUsageQuietly(publicModel: string, usage: TokenUsage | null): void {
  try {
    addUsage({
      publicModel,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0
    })
    refreshTrayUsage()
  } catch {
    // 用量落库失败不影响代理服务
  }
}
