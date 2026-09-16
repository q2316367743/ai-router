import type { ServerResponse } from 'node:http'

/** 写出 JSON 响应，返回实际写出的正文文本（供日志捕获）；连接已关闭时返回 null */
export function sendJson(res: ServerResponse, status: number, payload: unknown): string | null {
  if (res.writableEnded || res.destroyed) return null
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body)
  return body
}

/** 本地生成的错误统一走 OpenAI 错误信封返回客户端，返回实际写出的正文文本 */
export function sendOpenAiError(
  res: ServerResponse,
  status: number,
  message: string,
  code?: string
): string | null {
  return sendJson(res, status, {
    error: {
      message,
      type:
        status === 401
          ? 'authentication_error'
          : status >= 500
            ? 'api_error'
            : 'invalid_request_error',
      code: code ?? null
    }
  })
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
