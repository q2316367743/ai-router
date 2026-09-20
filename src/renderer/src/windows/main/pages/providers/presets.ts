import type { ProviderKind, ProviderProtocol } from '@common/types'

/** 内置提供商预设：驱动新增/编辑弹窗的「预设供应商」标签墙与列表类型标签 */
export interface ProviderPreset {
  kind: ProviderKind
  label: string
  /** 获取 API Key 的控制台页（弹窗内链接，target=_blank 经主窗口 openExternal 跳系统浏览器） */
  consoleUrl?: string
  /** 各协议的官方端点：选中预设或切换协议时据此回填 Base URL（缺该协议则保留手填值） */
  urls: Partial<Record<ProviderProtocol, string>>
}

/** 新增内置提供商：在此追加一行 + 扩展 common/types 的 ProviderKind 与 providerIpc 的 KINDS */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    kind: 'zai',
    label: 'Z.ai',
    consoleUrl: 'https://z.ai/manage-apikey/apikey-list',
    urls: {
      openai: 'https://api.z.ai/api/coding/paas/v4',
      anthropic: 'https://api.z.ai/api/anthropic'
    }
  },
  {
    kind: 'opencode',
    label: 'OpenCode Zen',
    consoleUrl: 'https://opencode.ai/zen',
    urls: { openai: 'https://opencode.ai/zen/v1' }
  },
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    urls: { openai: 'https://api.deepseek.com' }
  },
  {
    kind: 'openai',
    label: 'OpenAI',
    consoleUrl: 'https://platform.openai.com/api-keys',
    urls: { openai: 'https://api.openai.com/v1' }
  },
  {
    kind: 'siliconflow',
    label: 'SiliconFlow',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    urls: { openai: 'https://api.siliconflow.cn/v1' }
  }
]

const PRESET_BY_KIND = new Map(PROVIDER_PRESETS.map((p) => [p.kind, p]))

export function getPreset(kind: ProviderKind | null | undefined): ProviderPreset | null {
  return kind ? (PRESET_BY_KIND.get(kind) ?? null) : null
}

/** kind → 展示名，供列表类型标签使用 */
export const PRESET_LABELS = PROVIDER_PRESETS.reduce(
  (acc, p) => {
    acc[p.kind] = p.label
    return acc
  },
  {} as Record<ProviderKind, string>
)

/** 预设标签墙选项：「自定义」空串打头 */
export const KIND_CHIPS: Array<{ label: string; value: ProviderKind | '' }> = [
  { label: '自定义', value: '' },
  ...PROVIDER_PRESETS.map((p) => ({ label: p.label, value: p.kind }))
]

/** 选中预设回填协议时的候选顺序（内置厂商均无 openai-responses 端点） */
export const PRESET_PROTOCOL_ORDER: ProviderProtocol[] = ['openai', 'anthropic', 'openai-responses']

/** 接口类型 → Base URL 输入提示与说明 */
export const PROTOCOL_HINTS: Record<ProviderProtocol, { placeholder: string; help: string }> = {
  openai: {
    placeholder: 'https://api.deepseek.com/v1',
    help: '填完整 API 根（含 /v1 等版本/路径前缀，火山云形如 /api/plan/v3）：代理在其后拼 /chat/completions'
  },
  'openai-responses': {
    placeholder: 'https://api.openai.com/v1',
    help: '填完整 API 根（含 /v1 等版本/路径前缀）：代理在其后拼 /responses'
  },
  anthropic: {
    placeholder: 'https://api.anthropic.com/v1',
    help: '填完整 API 根（含 /v1 等版本/路径前缀）：代理在其后拼 /messages'
  }
}
