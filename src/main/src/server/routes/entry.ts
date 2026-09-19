import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProviderProtocol } from '@common/types'
import { findMapping } from '$/db/repo/modelRepo'
import { parseClientName, recordRequest } from '../logging/requestLog'
import { forwardRequest } from '../strategies/forward'
import { strategyOf } from '../strategies/registry'

/** 经 express.json 解析后的请求：转发层只依赖 body，不引入框架类型 */
type ProxyRequest = IncomingMessage & { body?: unknown }
type HandleResult = (req: ProxyRequest, res: ServerResponse) => Promise<void>

/**
 * 入口路由工厂：按入口协议生成「校验 body → 查映射 → 策略分发」处理器。
 * 路由内的同步拦截（400 / 404）一律以该入口协议的错误信封返回；
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
        reqBody: null,
        reqHeaders: null,
        resBody,
        resHeaders: null
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
        // 日志为线上口径：未向提供商发起请求，出站请求侧记 null
        reqBody: null,
        reqHeaders: null,
        resBody,
        resHeaders: null
      })
      return
    }

    const route = findMapping(publicModel)
    // 已归档（映射自身或所属提供商）与「不存在 / 已禁用」区分报错：归档是对客户端的正式下线
    // 宣告，明确告知；禁用仍沿用不区分口径的 404，不泄漏配置
    const archived =
      route !== null && (route.mappingArchivedAt !== null || route.providerArchivedAt !== null)
    if (!route || archived || !route.mappingEnabled || !route.providerEnabled) {
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
        providerName: route?.providerName ?? '-',
        upstreamModel: route?.upstreamName ?? '-',
        providerId: route?.providerId ?? null,
        modelId: route?.modelId ?? null,
        client,
        startedAt,
        status: 404,
        stream: false,
        usage: null,
        error: archived ? 'model archived' : 'model not found or disabled',
        reqBody: null,
        reqHeaders: null,
        resBody,
        resHeaders: null
      })
      return
    }

    // 入口协议 × 上游协议由转发层组合：同协议透传，异协议转换
    await forwardRequest(
      { req, body: parsed, res, route, publicModel, requestId, client, startedAt },
      entry.protocol
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
