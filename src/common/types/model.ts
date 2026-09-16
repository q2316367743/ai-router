/** 模型映射信息（联表带提供商名称） */
export interface ModelMappingInfo {
  id: string
  providerId: string
  providerName: string
  publicName: string
  upstreamName: string
  enabled: boolean
  createdAt: number
}

/** 模型映射新增/编辑入参：有 id 为更新 */
export interface ModelMappingInput {
  id?: string
  providerId: string
  publicName: string
  upstreamName: string
  enabled: boolean
}
