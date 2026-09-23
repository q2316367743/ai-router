import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProviderProtocol } from '@common/types'
import { findRoutes } from '$/db/repo/modelRepo'
import { getBalancerConfig, blockReasonOf, orderCandidates, sessionKeyOf } from '../balancer'
import { inboundBody, parseClientName, recordRequest } from '../logging/requestLog'
import { forwardRequest } from '../strategies/forward'
import { strategyOf } from '../strategies/registry'
import type { MappingRoute } from '$/db/repo/modelRepo'

/** 经 express.json 解析后的请求：转发层只依赖 body，不引入框架类型 */
type ProxyRequest = IncomingMessage & { body?: unknown }
type HandleResult = (req: ProxyRequest, res: ServerResponse) => Promise<void>

/**
 * 入口路由工厂：按入口协议生成「校验 body → 取该对外名的全部渠道 → 选路 → 转发」处理器。
 * 路由内的同步拦截（400 / 404 / 503）一律以该入口协议的错误信封返回；
 * 全局拦截（401 / 413 / 未知路由）在 app.ts 中、协议路由之前，仍为 OpenAI 信封。
 */
export function createEntryHandler(protocol: ProviderProtocol): HandleResult {
  const entry = strategyOf(protocol)
  return async (req: ProxyRequest, res: ServerResponse): Promise<void> => {
    const requestId = randomUUID()
    const startedAt = Date.now()
    const path = req.url ?? '/'
    // 来源客户端在入口解析一次：本地拦截与转发各分支共用，且早于任何早返回
    const client = parseClientName(req.headers['user-agent'])

    // express.json 已完成解析与 32MB 上限校验，此处只挡非对象 body（数组/标量）
    const parsed: unknown = req.body
    if (!isRecord(parsed)) {
      const resBody = entry.writeError(res, 400, 'Request body is not valid JSON')
      recordRequest({
        path,
        requestId,
        publicModel: '-',
        providerName: '-',
        upstreamModel: '-',
        providerId: null,
        modelId: null,
        client,
        startedAt,
        status: 400,
        stream: false,
        usage: null,
        error: 'invalid request body',
        local: true,
        // 非对象正文（数组 / 标量）没有可排查的请求侧信息
        reqBody: null,
        reqHeaders: null,
        resBody,
        resHeaders: null,
        retryTrace: null
      })
      return
    }

    const publicModel = typeof parsed['model'] === 'string' ? parsed['model'] : ''
    if (!publicModel) {
      const resBody = entry.writeError(res, 400, "'model' is required")
      recordRequest({
        path,
        requestId,
        publicModel: '-',
        providerName: '-',
        upstreamModel: '-',
        providerId: null,
        modelId: null,
        client,
        startedAt,
        status: 400,
        stream: false,
        usage: null,
        error: "'model' is required",
        // 本地拦截行：记客户端入站正文（未向提供商发起请求，出站侧本就不存在）
        local: true,
        reqBody: inboundBody(parsed),
        reqHeaders: null,
        resBody,
        resHeaders: null,
        retryTrace: null
      })
      return
    }

    // 同一对外名的多行 = 一个渠道组（负载均衡候选集）
    const routes = findRoutes(publicModel)
    const usable = routes.filter(isUsable)
    // 已归档（渠道自身或其提供商）与「不存在 / 已禁用」区分报错：归档是对客户端的正式下线
    // 宣告，明确告知；禁用仍沿用不区分口径的 404，不泄漏配置
    if (usable.length === 0) {
      const archived =
        routes.length > 0 &&
        routes.every(
          (route) => route.mappingArchivedAt !== null || route.providerArchivedAt !== null
        )
      const resBody = entry.writeError(
        res,
        404,
        archived
          ? `The model '${publicModel}' has been archived`
          : `The model '${publicModel}' does not exist`,
        archived ? 'model_archived' : 'model_not_found'
      )
      recordRequest({
        path,
        requestId,
        publicModel,
        providerName: routes[0]?.providerName ?? '-',
        upstreamModel: routes[0]?.upstreamName ?? '-',
        providerId: routes[0]?.providerId ?? null,
        modelId: routes[0]?.modelId ?? null,
        client,
        startedAt,
        status: 404,
        stream: false,
        usage: null,
        error: archived ? 'model archived' : 'model not found or disabled',
        local: true,
        reqBody: inboundBody(parsed),
        reqHeaders: null,
        resBody,
        resHeaders: null,
        retryTrace: null
      })
      return
    }

    const config = getBalancerConfig()
    const sessionKey = config.sessionAffinity ? sessionKeyOf(req, parsed) : null
    // 引擎关闭 = 单渠道直连（不选路、不拦额度、不改道），与改造前的行为一致
    const attempts = config.enabled ? orderCandidates(usable, sessionKey, publicModel) : usable.slice(0, 1)

    // 候选全部被额度阻断：直接拦截，不把请求送给已知没额度的渠道（这正是「等失败再降级」要避免的）
    if (attempts.length === 0) {
      const detail = usable
        .map((route) => `${route.providerName}（${blockReasonOf(route.providerId) ?? '不可用'}）`)
        .join('、')
      const message = `All channels for model '${publicModel}' are unavailable: ${detail}`
      const resBody = entry.writeError(res, 503, message, 'all_channels_unavailable')
      recordRequest({
        path,
        requestId,
        publicModel,
        providerName: usable[0]?.providerName ?? '-',
        upstreamModel: usable[0]?.upstreamName ?? '-',
        providerId: usable[0]?.providerId ?? null,
        modelId: usable[0]?.modelId ?? null,
        client,
        startedAt,
        status: 503,
        stream: false,
        usage: null,
        error: message,
        local: true,
        reqBody: inboundBody(parsed),
        reqHeaders: null,
        resBody,
        resHeaders: null,
        retryTrace: null
      })
      return
    }

    await forwardRequest(
      {
        req,
        body: parsed,
        res,
        publicModel,
        requestId,
        client,
        startedAt,
        attempts,
        sessionKey,
        maxAttempts: config.enabled ? config.maxAttempts : 1
      },
      entry.protocol
    )
  }
}

/** 该渠道此刻是否可被选为候选：渠道自身与提供商都启用且未归档 */
function isUsable(route: MappingRoute): boolean {
  return (
    route.mappingEnabled &&
    route.mappingArchivedAt === null &&
    route.providerEnabled &&
    route.providerArchivedAt === null
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
