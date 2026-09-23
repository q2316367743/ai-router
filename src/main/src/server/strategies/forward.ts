import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProviderProtocol, RetryAttempt } from '@common/types'
import type { MappingRoute } from '$/db/repo/modelRepo'
import { recordRequest } from '../logging/requestLog'
import { errMsg } from '../respond'
import { joinEndpoint, upstreamPathOf } from '../upstream/urls'
import {
  bindSession,
  displaySessionKey,
  isPenalizing,
  isRetryable,
  markAttempt,
  reportFailure,
  reportSuccess
} from '../balancer'
import { strategyOf } from './registry'
import { passthrough } from './passthrough'
import { converted } from './converted'
import { toTokenUsage, type Conversation } from './conversation'
import type { AttemptOutcome, RequestContext } from './types'

/** 转发现场：路由层已校验/选路后的全部入参 */
export interface ForwardRequest {
  req: IncomingMessage & { body?: unknown }
  body: Record<string, unknown>
  res: ServerResponse
  publicModel: string
  requestId: string
  client: string | null
  startedAt: number
  /** 本次请求的候选渠道，首位即首选（见 balancer/selector） */
  attempts: MappingRoute[]
  /** 会话标识：改道或成功后据此改绑（null = 不做亲和） */
  sessionKey: string | null
  /** 单请求最多尝试的渠道数 */
  maxAttempts: number
}

/**
 * 转发与故障转移主循环：按候选顺序尝试，**只在尚未向客户端写出任何字节时改道**。
 *
 * - 同协议 → raw 透传；异协议 → 会话转换（每个渠道各按自己的协议选路，候选可以混协议）；
 * - 失败按归类扣可用度（见 balancer/classify），额度类失败直接阻断该渠道；
 * - 改道成功后把会话重绑到实际服务的渠道，下次不必再撞一次坏渠道；
 * - **一次客户端请求只落一条日志**：最终渠道的线上口径 + `retryTrace`（失败过的渠道）。
 */
export async function forwardRequest(
  base: ForwardRequest,
  entryProtocol: ProviderProtocol
): Promise<void> {
  const entry = strategyOf(entryProtocol)
  const { res, body } = base
  // 请求级中断信号：**只**表客户端断开（首字节超时用尝试级信号，见 upstream/httpClient），
  // 断开后 abort，正在进行的上游读取随之终止，也不再有下一次尝试
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  const attempts = base.attempts.slice(0, Math.max(1, base.maxAttempts))
  const retryTrace: RetryAttempt[] = []
  // 会话解析与渠道无关：多协议候选下也只在第一次需要转换时解析一次
  let conversation: Conversation | null = null

  for (let index = 0; index < attempts.length; index += 1) {
    const route = attempts[index]
    if (res.destroyed || res.writableEnded) return
    const ctx: RequestContext = {
      req: base.req,
      body,
      res,
      route,
      publicModel: base.publicModel,
      requestId: base.requestId,
      client: base.client,
      startedAt: base.startedAt,
      firstAttempt: index === 0,
      controller
    }

    const upstream = strategyOf(route.providerProtocol)
    let outcome: AttemptOutcome
    if (upstream.protocol === entry.protocol) {
      outcome = await passthrough(ctx, upstream)
    } else {
      let parsed: Conversation
      try {
        parsed = conversation ?? entry.parseRequest(body)
        conversation = parsed
      } catch (err) {
        // 会话解析失败 = 请求本身不合法：不扣分也不改道（换渠道同样解析不了）
        const message = errMsg(err)
        const resBody = entry.writeError(res, 400, message)
        recordRequest({
          path: upstreamPathOf(joinEndpoint(route.providerBaseUrl, upstream.upstreamPath)),
          requestId: base.requestId,
          publicModel: base.publicModel,
          providerName: route.providerName,
          upstreamModel: route.upstreamName,
          providerId: route.providerId,
          modelId: route.modelId,
          client: base.client,
          startedAt: base.startedAt,
          status: 400,
          stream: false,
          usage: null,
          error: message,
          reqBody: null,
          reqHeaders: null,
          resBody,
          resHeaders: null,
          retryTrace: null
        })
        return
      }
      outcome = await converted(ctx, entry, upstream, parsed)
    }

    markAttempt(route.providerId)
    if (outcome.kind === 'ok') {
      reportSuccess(route.providerId)
      if (base.sessionKey) bindSession(base.sessionKey, base.publicModel, route.providerId)
    } else if (isPenalizing(outcome.kind)) {
      reportFailure(route.providerId, outcome.kind, outcome.message ?? '未知错误')
    }

    const canRetry =
      !outcome.committed &&
      isRetryable(outcome.kind) &&
      index < attempts.length - 1 &&
      !controller.signal.aborted &&
      !res.destroyed &&
      !res.writableEnded

    if (!canRetry) {
      serveOutcome(base, ctx, outcome, retryTrace)
      return
    }
    retryTrace.push({
      provider: route.providerName,
      status: outcome.upstreamStatus,
      error: outcome.message ?? '未知错误',
      at: Date.now()
    })
    console.log(
      `[balancer] ${base.publicModel} ← ${route.providerName} 失败（${outcome.status}），改道下一渠道 · 会话 ${displaySessionKey(base.sessionKey)}`
    )
  }
}

/** 收口：把最终结果（成功 / 原样回放的失败）交给客户端并落一条日志 */
function serveOutcome(
  base: ForwardRequest,
  ctx: RequestContext,
  outcome: AttemptOutcome,
  retryTrace: RetryAttempt[]
): void {
  const servedBody = outcome.serve ? outcome.serve() : null
  // 每请求一行：会话键是亲和是否命中的唯一观测点（绑定表只在内存里，日志页看不到）
  const retried = retryTrace.length > 0 ? `，重试 ${retryTrace.length} 次` : ''
  console.log(
    `[balancer] ${base.publicModel} → ${ctx.route.providerName}（状态 ${outcome.status}${retried}）· 会话 ${displaySessionKey(base.sessionKey)}`
  )
  recordRequest({
    path: outcome.path,
    requestId: base.requestId,
    publicModel: base.publicModel,
    providerName: ctx.route.providerName,
    upstreamModel: ctx.route.upstreamName,
    providerId: ctx.route.providerId,
    modelId: ctx.route.modelId,
    client: base.client,
    startedAt: base.startedAt,
    status: outcome.status,
    stream: outcome.stream,
    usage: outcome.usage ? toTokenUsage(outcome.usage) : null,
    error: outcome.message,
    reqBody: outcome.wire.body,
    reqHeaders: outcome.wire.headers,
    resBody: outcome.resBody ?? servedBody,
    resHeaders: outcome.resHeaders,
    retryTrace: retryTrace.length > 0 ? JSON.stringify(retryTrace) : null
  })
}
