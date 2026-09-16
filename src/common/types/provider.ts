/** 提供商信息（list 时附带模型映射数量） */
export interface ProviderInfo {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  modelCount: number
}

/** 提供商新增/编辑入参：有 id 为更新，无 id 为新增（id 由 main 生成） */
export interface ProviderInput {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  enabled: boolean
}
