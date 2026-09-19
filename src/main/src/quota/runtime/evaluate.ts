/**
 * 脚本策略加载器：把 defineProvider 形态的 JS 插件源码加载为可执行策略。
 *
 * 复刻 CodexBar ProviderPluginRuntime 的加载流程：
 *   1. 间接 eval prelude 源码 → 得到 applyProviderPluginPrelude(ctx, host) 函数；
 *   2. new Function('defineProvider', src) 执行插件源码，顶层 defineProvider({...}) 被捕获；
 *   3. manifest（端点白名单 / auth / settings / cookie 域 / capabilities）在加载期提取校验。
 *
 * eval 无沙箱：脚本能访问 Node 全局，属于本地应用执行用户自带脚本的已知风险（见 docs/app/11）。
 */

export interface PluginAuth {
  type: 'bearer' | 'x-api-key' | 'header' | 'authorization-scheme'
  /** header / authorization-scheme 型的头名或前缀 */
  header?: string
  scheme?: string
  /** 凭证所在的 secure 设置键（宿主注入值后按类型附加认证头） */
  secret: string
}

export interface PluginSetting {
  key: string
  title: string
  type: 'secure' | 'plain'
}

export interface PluginEndpointSetting {
  key: string
  policy: string
}

/** 加载期提取的插件清单：宿主执行与安全约束的全部依据 */
export interface PluginManifest {
  id: string
  label: string
  settings: PluginSetting[]
  auth: PluginAuth | null
  capabilities: string[]
  cookieDomains: string[]
  /** 字符串端点的 origin（HTTPS） */
  staticOrigins: string[]
  /** setting 型端点：运行时从设置值解析 origin */
  settingOrigins: PluginEndpointSetting[]
}

export interface LoadedPlugin {
  manifest: PluginManifest
  fetchUsage: (ctx: unknown) => unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 解析端点声明的 origin：字符串端点必须为合法 URL；setting 型记录键与访问策略 */
function parseEndpoints(raw: unknown): { staticOrigins: string[]; settingOrigins: PluginEndpointSetting[] } {
  const staticOrigins: string[] = []
  const settingOrigins: PluginEndpointSetting[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item === 'string') {
      try {
        staticOrigins.push(new URL(item).origin)
      } catch {
        // 非法端点字符串直接忽略：加载可用性优先，运行时白名单少一条而已
      }
    } else if (isRecord(item) && typeof item.setting === 'string') {
      settingOrigins.push({ key: item.setting, policy: typeof item.policy === 'string' ? item.policy : 'https' })
    }
  }
  return { staticOrigins, settingOrigins }
}

function parseAuth(raw: unknown): PluginAuth | null {
  if (!isRecord(raw) || typeof raw.secret !== 'string' || !raw.secret) return null
  const type = raw.type
  if (type === 'bearer' || type === 'x-api-key' || type === 'header' || type === 'authorization-scheme') {
    return {
      type,
      header: typeof raw.header === 'string' ? raw.header : undefined,
      scheme: typeof raw.scheme === 'string' ? raw.scheme : undefined,
      secret: raw.secret
    }
  }
  return null
}

/** 加载期类型校验：不满足最低形状（id/name/endpoints/fetchUsage）即拒绝安装 */
function validateDefinition(
  raw: unknown
): { id: string; name: string; fetchUsage: (ctx: unknown) => unknown } | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.name !== 'string' || !raw.name) return null
  if (!Array.isArray(raw.endpoints)) return null
  if (typeof raw.fetchUsage !== 'function') return null
  return { id: raw.id, name: raw.name, fetchUsage: raw.fetchUsage as (ctx: unknown) => unknown }
}

/** 加载脚本插件：执行源码捕获 definition 并提取 manifest。
 * 抛出的中文错误用于安装/保存时的即时反馈。
 */
export function evaluatePlugin(source: string): LoadedPlugin {
  let captured: unknown = null
  const defineProvider = (definition: unknown) => {
    captured = definition
  }
  try {
    new Function('defineProvider', source)(defineProvider)
  } catch (err) {
    throw new Error(`脚本执行失败：${err instanceof Error ? err.message : String(err)}`)
  }

  const validated = validateDefinition(captured)
  if (!validated) throw new Error('脚本未调用 defineProvider({...})，或缺少 id / name / endpoints / fetchUsage 字段')

  const definition = (captured ?? {}) as Record<string, unknown>
  const { staticOrigins, settingOrigins } = parseEndpoints(definition.endpoints)
  const settings = (Array.isArray(definition.settings) ? definition.settings : []).filter(
    (item): item is PluginSetting =>
      isRecord(item) && typeof item.key === 'string' && (item.type === 'secure' || item.type === 'plain')
  )
  const manifest: PluginManifest = {
    id: validated.id,
    label: validated.name,
    settings,
    auth: parseAuth(definition.auth),
    capabilities: asStringArray(definition.capabilities),
    cookieDomains: asStringArray(definition.cookieDomains),
    staticOrigins,
    settingOrigins
  }
  return { manifest, fetchUsage: validated.fetchUsage }
}
