/** 提供商上游接口协议：决定出站认证头与请求/响应的线上格式 */
export type ProviderProtocol = 'openai' | 'openai-responses' | 'anthropic'

/**
 * 内置提供商类型：预设目录（渲染层 providers/presets.ts）与余量查询按此分发。
 * null = 自定义提供商；新增内置项时同步扩展 presets.ts 与 IPC 校验。
 */
export type ProviderKind = 'zai' | 'opencode' | 'deepseek' | 'siliconflow'

/** 提供商信息（list 时附带模型映射数量） */
export interface ProviderInfo {
  id: string
  name: string
  protocol: ProviderProtocol
  /** 内置提供商类型：null = 自定义（余量查询只对非空项生效） */
  kind: ProviderKind | null
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
  /** 缺省/undefined 按自定义（null）落库 */
  kind?: ProviderKind | null
  baseUrl: string
  apiKey: string
  enabled: boolean
}
