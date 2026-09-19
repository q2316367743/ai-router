/** 提供商上游接口协议：决定出站认证头与请求/响应的线上格式 */
export type ProviderProtocol = 'openai' | 'openai-responses' | 'anthropic'

/**
 * 内置提供商类型：预设目录（渲染层 providers/presets.ts）与余量查询按此分发。
 * null = 自定义提供商；新增内置项时同步扩展 presets.ts 与 IPC 校验。
 */
export type ProviderKind = 'zai' | 'opencode' | 'deepseek' | 'siliconflow' | 'openai'

/** 提供商信息（list 时附带模型映射数量） */
export interface ProviderInfo {
  id: string
  name: string
  protocol: ProviderProtocol
  /** 内置提供商类型：null = 自定义（余量查询只对非空项生效） */
  kind: ProviderKind | null
  baseUrl: string
  apiKey: string
  /** 绑定的余量策略 id（内置策略 id 或外置策略 id）；null = 不查询余量 */
  quotaStrategyId: string | null
  /** 余量策略附加配置（JSON 字符串：cookie 头 / 区域 / 附加 token 等键值对）；null = 无 */
  strategyConfig: string | null
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
  /** 缺省/undefined 按自定义（null）落库 */
  kind?: ProviderKind | null
  baseUrl: string
  apiKey: string
  /** 缺省/undefined 按 null（不绑定）落库；绑定前 IPC 校验策略存在 */
  quotaStrategyId?: string | null
  /** 缺省/undefined 按 null 落库；非法 JSON 会被 IPC 校验拒绝 */
  strategyConfig?: string | null
  enabled: boolean
}
