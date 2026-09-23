/**
 * 模型渠道信息（联表带提供商名称）：**同一 publicName 的多行即一个渠道组**（负载均衡候选集）。
 */
export interface ModelMappingInfo {
  id: string
  providerId: string
  providerName: string
  publicName: string
  upstreamName: string
  enabled: boolean
  /** 归档时间（epoch ms）：非空 = 已归档；归档保留 (对外名, 提供商) 组合的所有权，重建同组合会被拒 */
  archivedAt: number | null
  /** 所属提供商归档时间：非空说明提供商已归档（其下渠道必然连带归档），需先恢复提供商 */
  providerArchivedAt: number | null
  createdAt: number
}

/** 渠道新增入参：对外名相同即归入同一渠道组（该名首次出现即「新建对外模型」） */
export interface ModelChannelInput {
  providerId: string
  publicName: string
  upstreamName: string
  enabled: boolean
}

/** 渠道编辑入参：对外模型名不属于渠道，改名走组级接口 */
export interface ModelChannelPatch {
  id: string
  providerId: string
  upstreamName: string
  enabled: boolean
}

/** 组级重命名入参（一次改该名下全部渠道，并改写历史统计与日志） */
export interface ModelGroupRenameInput {
  from: string
  to: string
}

/** 组级启停入参（一次改该名下全部未归档渠道） */
export interface ModelGroupEnabledInput {
  publicName: string
  enabled: boolean
}
