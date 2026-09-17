import { Readable } from 'node:stream'
import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type AxiosResponseHeaders,
  type RawAxiosResponseHeaders
} from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getServiceConfig } from '$/db/repo/settingRepo'

/** 常见网络错误码 → 中文原因说明（describeNetworkError 拼接用） */
const NETWORK_HINTS: Readonly<Record<string, string>> = {
  ENOTFOUND: '域名解析失败（baseUrl 错误或 DNS 不可用）',
  EAI_AGAIN: 'DNS 暂时不可用（稍后重试或更换 DNS）',
  ECONNREFUSED: '连接被拒绝（端口未开放或被防火墙拦截）',
  ECONNRESET: '连接被重置（上游或中间网络中断，常见于代理/防火墙干扰）',
  ETIMEDOUT: '连接超时（上游不可达或网络不通）',
  ECONNABORTED: '请求中止或超时',
  EPROTO: '协议错误（TLS 握手失败，需确认上游地址与代理协议匹配）',
  EHOSTUNREACH: '无法路由到主机（网络不可达）',
  ENETUNREACH: '网络不可达',
  ERR_CANCELED: '请求已取消',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS 证书无法验证（证书链不完整或不受信任）',
  CERT_HAS_EXPIRED: 'TLS 证书已过期',
  DEPTH_ZERO_SELF_SIGNED_CERT: '自签名证书不受信任',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS 证书域名不匹配'
}

/** 网络层 AxiosError（无 response）的 message 增强为「底层原因: 中文提示」，日志与客户端错误直接展示 */
function describeNetworkError(err: AxiosError): string {
  const code = err.code ?? ''
  const cause = err.cause
  const raw = cause instanceof Error && cause.message ? cause.message : err.message
  const hint = NETWORK_HINTS[code]
  const segments: string[] = []
  if (code && !raw.includes(code)) segments.push(code)
  segments.push(raw)
  if (hint) segments.push(hint)
  return segments.join(': ')
}

let cached: { proxyUrl: string; client: AxiosInstance } | null = null

/**
 * 上游出站 axios 实例（Node http 适配器）：按代理配置缓存重建（连接复用）。
 * - timeout 0：长请求（大模型生成）不被掐断；
 * - proxy: false：屏蔽 axios 读 HTTP_PROXY 等环境变量的默认行为；
 * - 代理仅作用于 https 上游（CONNECT 隧道）；http 上游多为本地调试，直连；
 * - 响应拦截器统一增强网络层错误，调用方 catch 到的 AxiosError.message 已含具体原因。
 */
export function getUpstreamClient(): AxiosInstance {
  const proxyUrl = (getServiceConfig().proxyUrl ?? '').trim()
  if (cached?.proxyUrl === proxyUrl) return cached.client

  const config: AxiosRequestConfig = {
    timeout: 0,
    proxy: false,
    // 出站禁用上游压缩：axios 在 responseType: 'stream' 下不解压 gzip，禁用后响应体/响应头
    // 均为提供商原样明文（日志需记全文，且转发走本机回环，压缩无收益）
    headers: { 'Accept-Encoding': 'identity' }
  }
  if (proxyUrl) config.httpsAgent = new HttpsProxyAgent(proxyUrl)

  const client = axios.create(config)
  client.interceptors.response.use(undefined, (error: unknown) => {
    if (axios.isAxiosError(error) && !error.response) error.message = describeNetworkError(error)
    return Promise.reject(error)
  })
  cached = { proxyUrl, client }
  return client
}

/** HeadersInit → 普通记录（供出站捕获与 axios headers 透传） */
export function headersToRecord(init: HeadersInit | undefined): Record<string, string> {
  if (!init) return {}
  return Object.fromEntries(new Headers(init).entries())
}

/** axios 响应头 → WHATWG Headers（多值 append 保留），供日志序列化与 content-type 判定 */
export function responseHeadersOf(res: AxiosResponse): Headers {
  const headers = new Headers()
  const raw: AxiosResponseHeaders | RawAxiosResponseHeaders = res.headers
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || typeof value === 'boolean') continue
    if (Array.isArray(value)) for (const item of value) headers.append(key, item)
    else headers.set(key, value)
  }
  return headers
}

/**
 * fetch 兼容出站（注入 ai-sdk provider 的 fetch 选项）：axios 承载真实请求。
 * validateStatus 全放行保持 fetch「非 2xx 不 reject」语义（SDK 自行读 body 报错）；
 * body 以流透传，abort 时销毁上游连接。
 */
export const axiosFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const response = await getUpstreamClient().request<Readable>({
    url,
    method: init?.method ?? 'GET',
    data: init?.body ?? null,
    headers: headersToRecord(init?.headers),
    responseType: 'stream',
    validateStatus: () => true,
    signal: init?.signal ?? undefined
  })
  const stream = response.data
  const signal = init?.signal
  if (signal) {
    if (signal.aborted) stream.destroy()
    else signal.addEventListener('abort', () => stream.destroy(), { once: true })
  }
  const body = Readable.toWeb(stream) as unknown as BodyInit
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeadersOf(response)
  })
}
