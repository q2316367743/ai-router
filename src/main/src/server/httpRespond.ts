import type { ServerResponse } from 'node:http'

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

/** 本地生成的错误统一走 OpenAI 错误信封返回客户端 */
export function sendOpenAiError(
  res: ServerResponse,
  status: number,
  message: string,
  code?: string
): void {
  sendJson(res, status, {
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
