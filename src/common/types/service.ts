/** 本地代理服务配置 */
export interface ServiceConfig {
  port: number
  apiKey: string
  enabled: boolean
  /** 上游请求代理（http/https URL；空串直连） */
  proxyUrl: string
}

/** 服务运行状态 */
export type ServiceState = 'stopped' | 'running' | 'error'

export interface ServiceStatus {
  state: ServiceState
  /** 监听端口（未启动时为配置端口） */
  port: number
  /** state === 'error' 时的错误描述 */
  error?: string
}
