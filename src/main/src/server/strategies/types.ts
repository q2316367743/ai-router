import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProviderProtocol } from '@common/types'
import type { MappingRoute } from '$/db/repo/modelRepo'
import type { AttemptKind } from '../balancer/types'
import type { ApiUsage, Completion, Conversation, StreamEvent } from './conversation'
import type { SseEvent } from './sse'

/** 策略执行上下文：单次渠道尝试的完整请求现场（body 校验、映射解析、改道选择已在路由层完成） */
export interface RequestContext {
  /** 原始请求：透传取请求头，转换取自定义头（不引入 express 类型） */
  req: IncomingMessage & { body?: unknown }
  /** 已校验为对象的请求体（= req.body，路由层收窄后传入，策略内无需重复判断） */
  body: Record<string, unknown>
  res: ServerResponse
  /** 本次尝试的渠道（同一请求的多次尝试各有各的渠道） */
  route: MappingRoute
  publicModel: string
  requestId: string
  /** 来源客户端标识（入口已由 `parseClientName` 解析） */
  client: string | null
  startedAt: number
  /** 是否本请求的首次尝试：只有首次尝试落 pending 日志行（startLog 是纯插入，重复调用会撞唯一索引） */
  firstAttempt: boolean
  /** 请求级中断控制器（客户端断开时 abort，由转发循环持有并传入每次尝试）；首字节超时也挂在它上面 */
  controller: AbortController
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

/** 出站报文（日志口径） */
export interface WireLog {
  body: string | null
  headers: string | null
}

/**
 * 一次渠道尝试的结果。
 *
 * 关键字段是 `committed`：**是否已经向客户端写出过任何字节**。只有未提交的失败才允许改道——
 * 一旦写了响应头，换渠道就会让同一个响应里混进两家上游的内容。
 *
 * 未提交的失败必须带上 `serve`：改道循环在「无可改道」时才调用它把这次失败交给客户端，
 * 因此失败的响应体要先缓冲好（上游错误报文原样回放 / 本地错误信封）。
 */
export interface AttemptOutcome {
  kind: AttemptKind
  committed: boolean
  status: number
  /** 上游真实状态码（网络层失败 / 客户端断开为 null），记入重试轨迹用 */
  upstreamStatus: number | null
  stream: boolean
  /** 本次尝试的上游请求路径（日志 path 字段：透传保留入站 query，转换不带） */
  path: string
  /** 上游上报用量（统一形态；落库前由转发循环换算成 TokenUsage） */
  usage: ApiUsage | null
  /** 供日志：本次实际发出的报文 */
  wire: WireLog
  /** 供日志：响应正文（错误正文 / 成功响应文本；流式为全部 SSE 文本） */
  resBody: string | null
  /** 供日志：响应标头 */
  resHeaders: string | null
  /** 失败摘要（kind 非 ok / client 时非空） */
  message: string | null
  /** 未提交失败的回放函数：写出响应并返回实际写出的正文（供日志） */
  serve: (() => string | null) | null
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
