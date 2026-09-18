/** 模型映射信息（联表带提供商名称） */
export interface ModelMappingInfo {
  id: string
  providerId: string
  providerName: string
  publicName: string
  upstreamName: string
  enabled: boolean
  /** 归档时间（epoch ms）：非空 = 已归档；归档保留对外名所有权，新建同名会被拒 */
  archivedAt: number | null
  /** 所属提供商归档时间：非空说明提供商已归档（其下映射必然连带归档），需先恢复提供商 */
  providerArchivedAt: number | null
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
