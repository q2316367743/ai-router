import { axiosFetch, headersToRecord } from '../upstreamHttp'
import { serializeOutboundHeaders, serializeResponseHeaders } from '../proxyLog'

/** 一次上游请求的线上数据捕获：日志记录「发给提供商的请求 + 提供商返回的响应」的数据源 */
export interface WireCapture {
  /** 发给提供商的请求正文（字符串 body；无 body 为 null） */
  requestBody: string | null
  /** 发给提供商的请求标头（脱敏后 JSON 文本） */
  requestHeaders: string | null
  /** 提供商返回的响应正文（增量累积；流式为原始 SSE 文本） */
  responseBody: string | null
  /** 提供商返回的响应标头（脱敏后 JSON 文本） */
  responseHeaders: string | null
}

/**
 * 构造供 ai-sdk provider `fetch` 选项注入的 fetch 包装：请求原样转发，同时捕获线上请求与响应。
 *
 * - 请求侧：init.body / init.headers 在转发前捕获（SDK 发起 fetch 时才生成真实出站报文）。
 * - 响应侧：标头在 resolve 时捕获；正文经 TransformStream 边透传边增量累积，
 *   中途 abort 只保留已收到部分，不影响 SDK 对响应的正常消费。
 * - 底层出站为 axios（axiosFetch），与透传路径共享连接与代理配置。
 */
export function createWireCapture(): { fetch: typeof fetch; capture: WireCapture } {
  const capture: WireCapture = {
    requestBody: null,
    requestHeaders: null,
    responseBody: null,
    responseHeaders: null
  }

  const wired: typeof fetch = async (input, init) => {
    capture.requestBody = typeof init?.body === 'string' ? init.body : null
    capture.requestHeaders = serializeOutboundHeaders(headersToRecord(init?.headers))

    const response = await axiosFetch(input, init)
    capture.responseHeaders = serializeResponseHeaders(response.headers)
    if (!response.body) return response

    const decoder = new TextDecoder()
    const tapped = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          capture.responseBody = (capture.responseBody ?? '') + decoder.decode(chunk, { stream: true })
          controller.enqueue(chunk)
        }
      })
    )
    return new Response(tapped, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }

  return { fetch: wired, capture }
}
