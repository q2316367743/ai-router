/** 提供商上游接口协议：决定出站认证头与请求/响应的线上格式 */
export type ProviderProtocol = 'openai' | 'openai-responses' | 'anthropic'

/** 提供商信息（list 时附带模型映射数量） */
export interface ProviderInfo {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  enabled: boolean
  /** 归档时间（epoch ms）：非空 = 已归档（对外不可见、请求报 model_archived）；与 enabled 正交 */
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  /** 可用模型映射数（不含已归档映射） */
  modelCount: number
}

/** 提供商新增/编辑入参：有 id 为更新，无 id 为新增（id 由 main 生成） */
export interface ProviderInput {
  id?: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  enabled: boolean
}
