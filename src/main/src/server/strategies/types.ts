import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProviderProtocol } from '@common/types'
import type { MappingRoute } from '$/db/repo/modelRepo'
import type { Completion, Conversation, StreamEvent } from './conversation'
import type { SseEvent } from './sse'

/** 策略执行上下文：路由命中后的完整请求现场（body 校验、映射解析已在路由层完成） */
export interface RequestContext {
  /** 原始请求：透传取请求头，转换取自定义头（不引入 express 类型） */
  req: IncomingMessage & { body?: unknown }
  /** 已校验为对象的请求体（= req.body，路由层收窄后传入，策略内无需重复判断） */
  body: Record<string, unknown>
  res: ServerResponse
  route: MappingRoute
  publicModel: string
  requestId: string
  /** 来源客户端标识（入口已由 `parseClientName` 解析） */
  client: string | null
  startedAt: number
}

/** 策略构建的出站请求（即线上口径的请求报文） */
export interface WireRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** 上游返回的非 2xx 或流内错误（状态码与摘要消息，用于回写客户端与日志 error） */
export interface UpstreamFailure {
  status: number
  message: string
}

/** 统一事件 → 入口协议响应的编码器（惰性响应头 + 背压） */
export interface EntryEncoder {
  readonly headWritten: boolean
  /** 写一个统一流事件（实现该协议的 SSE 帧 / 块） */
  write(event: StreamEvent): Promise<void>
  /** 流已开始后中途出错：以该协议的流内错误帧收尾 */
  writeError(message: string): Promise<void>
  /** 结束：写协议终止帧并 res.end() */
  end(): void
}

/** 上游协议 SSE → 统一流事件（事件经构造时注入的 sink 交付） */
export interface UpstreamDecoder {
  /** 处理一个上游 SSE 事件；到达终态后继续喂入的事件被忽略 */
  handleEvent(event: SseEvent): Promise<void>
  /** 读取循环结束（上游流正常关闭）后调用一次：合成仅在流末可知的终态（如 OpenAI 系缺 [DONE] 时补 finish） */
  flush(): Promise<void>
  /** 是否已到终态（finish 或失败），执行骨架据此提前终止上游读取 */
  readonly done: boolean
  /** 是否已产出 finish 事件（用于识别「上游流提前中断」） */
  readonly completed: boolean
  /** 流内失败（上游 error 事件 / response.failed 等） */
  readonly failure: UpstreamFailure | null
}

/**
 * 协议策略 = 一个协议的双向编解码器，可入可出：
 * - 入口方向：该协议作为对外接口（parse + encode）；
 * - 上游方向：该协议作为提供商接口（request + decode）；
 * - 传输特征：同协议 raw 透传所需的端点与鉴权头。
 * 转发层任意组合「入口协议 × 上游协议」，同协议走 raw 透传（见 forward.ts）。
 */
export interface ProtocolStrategy {
  readonly protocol: ProviderProtocol

  /** 入口请求体 → 统一会话（不合规抛 ChatParseError → 400） */
  parseRequest(body: unknown): Conversation
  /** 统一结果 → 入口非流式响应体（写出并返回正文供日志；连接已关闭返回 null） */
  encodeCompletion(res: ServerResponse, model: string, completion: Completion): string | null
  /** 统一流事件 → 入口 SSE 编码器 */
  createEntryEncoder(res: ServerResponse, model: string): EntryEncoder
  /** 该协议的错误信封（返回实际写出的正文文本供日志） */
  writeError(res: ServerResponse, status: number, message: string, code?: string): string | null

  /** 统一会话 → 上游报文（线上口径） */
  buildRequest(
    conversation: Conversation,
    route: MappingRoute,
    extraHeaders: Record<string, string>
  ): WireRequest
  /** 上游非流式 JSON → 统一结果（宽松：结构不识别时返回空结果，供透传抽 usage 用） */
  decodeResponse(payload: unknown): Completion
  /** 上游 SSE → 统一流事件（sink 由执行骨架注入：转换流接入口编码器，透传流只抽 usage） */
  createUpstreamDecoder(onEvent: (event: StreamEvent) => Promise<void>): UpstreamDecoder

  /** 同协议透传的上游端点路径（/chat/completions | /messages | /responses） */
  readonly upstreamPath: string
  /** 同协议透传时在客户端透传头之上追加/替换的认证与协议头 */
  upstreamAuthHeaders(route: MappingRoute): Record<string, string>
}
