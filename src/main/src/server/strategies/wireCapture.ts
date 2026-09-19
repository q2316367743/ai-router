/**
 * 一次上游请求的线上数据捕获：日志「发给提供商的请求 + 提供商返回的响应」的数据源。
 * 出站为 axios 直连后报文由策略自行构建，请求侧直接赋值；响应正文在读取流时增量累积
 * （流式为原始 SSE 文本、非流式为原始 JSON；中断保留已收部分）。
 */
export interface WireCapture {
  /** 发给提供商的请求正文（字符串 body；未发起上游请求为 null） */
  requestBody: string | null
  /** 发给提供商的请求标头（脱敏后 JSON 文本） */
  requestHeaders: string | null
  /** 提供商返回的响应正文 */
  responseBody: string | null
  /** 提供商返回的响应标头（脱敏后 JSON 文本） */
  responseHeaders: string | null
}

export function createWireCapture(): WireCapture {
  return { requestBody: null, requestHeaders: null, responseBody: null, responseHeaders: null }
}

/** 响应正文增量累积 */
export function captureResponseText(capture: WireCapture, text: string): void {
  capture.responseBody = (capture.responseBody ?? '') + text
}
