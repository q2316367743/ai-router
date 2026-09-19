/**
 * 余量查询（quota）域契约：策略模式——内置策略与外置 JS 脚本策略共用同一套
 * 快照结构与执行上下文，形状对齐 CodexBar 插件契约（codexbar-plugin.d.ts）。
 */

/** 限流窗口：一个用量的时间窗（5 小时 / 周 / 月等） */
export interface QuotaRateWindow {
  /** 已用百分比 0~100 */
  usedPercent: number
  /** 窗口时长（分钟）：null/缺省 = 不定长窗口 */
  windowMinutes?: number | null
  /** 重置时刻（epoch ms） */
  resetsAt?: number | null
  /** 重置说明（如「5-hour」「MCP」「每周三」），展示在进度旁 */
  resetDescription?: string | null
}

/** 具名附加窗口（主/次窗口之外的额外限额，如月度 MCP、模型专属限额） */
export interface QuotaNamedWindow {
  id: string
  title: string
  window: QuotaRateWindow
}

/** 花费/余额快照（余额类策略用） */
export interface QuotaCostSnapshot {
  /** 已用金额或余额绝对值 */
  used: number
  limit?: number | null
  currency: string
  period?: string | null
  resetsAt?: number | null
  balance?: number | null
}

export interface QuotaDetailRow {
  label: string
  value: string
  secondaryValue?: string
}

/** 明细分区内嵌图表（策略经 details[].chart 提供，CodexBar 契约同构） */
export interface QuotaDetailChart {
  kind: 'bars' | 'line'
  title?: string | null
  /** 数值单位（展示在图表左上角，如 tokens） */
  unit?: string | null
  points: Array<{ label: string; value: number }>
}

export interface QuotaDetailSection {
  title: string
  rows: QuotaDetailRow[]
  chart?: QuotaDetailChart | null
}

export interface QuotaIdentity {
  email?: string
  organization?: string
  loginMethod?: string
  accountID?: string
}

/**
 * 策略执行结果（脚本 fetchUsage 返回值）：primary/secondary/tertiary 为主次窗口，
 * extraWindows 为具名附加窗口；至少应含一项有意义数据，否则视为无效快照。
 */
export interface QuotaSnapshot {
  primary?: QuotaRateWindow | null
  secondary?: QuotaRateWindow | null
  tertiary?: QuotaRateWindow | null
  extraWindows?: QuotaNamedWindow[] | null
  cost?: QuotaCostSnapshot | null
  details?: QuotaDetailSection[] | null
  identity?: QuotaIdentity | null
}

/** 失败分类（对齐 CodexBar __CODEXBAR_FAILURE_V2__ 的 8 种 kind） */
export type QuotaFailureKind =
  | 'authentication-expired'
  | 'missing-credential'
  | 'permission-denied'
  | 'parse-failure'
  | 'rate-limited'
  | 'provider-unavailable'
  | 'network-failure'
  | 'api-failure'

/** 分类失败错误：策略抛出，宿主解析 message 前缀后还原为结构化失败 */
export interface QuotaClassifiedFailure {
  kind: QuotaFailureKind
  message: string
}

/** 策略执行上下文：内置 TS 策略与外置脚本同构使用（脚本侧由 prelude 补全便捷层） */
export interface QuotaStrategyContext {
  /** 提供商 API Key（或 token / cookie 之外的通用凭证） */
  apiKey: string
  /** 提供商 Base URL（策略可据此推断区域，如 zai 的 bigmodel.cn） */
  baseUrl: string
  /** 提供商附加配置（strategyConfig JSON 解析后的键值对：cookie 头、区域、附加 token 等） */
  config: Record<string, string>
  /** 受限 HTTP 通道：走统一出站 axios（含代理）；脚本策略受 origin 白名单约束 */
  http: {
    getJSON(url: string, opts?: QuotaHttpOptions): Promise<QuotaHttpResponse<unknown>>
    get(url: string, opts?: QuotaHttpOptions): Promise<QuotaHttpResponse<string>>
    post(url: string, opts?: QuotaHttpOptions & { body: unknown }): Promise<QuotaHttpResponse<string>>
    postJSON(url: string, opts?: QuotaHttpOptions & { body: unknown }): Promise<QuotaHttpResponse<unknown>>
  }
  /** 策略设置读取器（key 由各策略的 resolveSettings 提供；未提供返回 null） */
  settings: { get(key: string): string | null }
  /** 分类失败构造器：throw ctx.fail.authenticationExpired('token 已过期') */
  fail: Record<
    | 'authenticationExpired'
    | 'missingCredential'
    | 'permissionDenied'
    | 'parseFailure'
    | 'rateLimited'
    | 'providerUnavailable'
    | 'networkFailure'
    | 'apiFailure',
    (message: string) => Error
  >
  log: (...args: unknown[]) => void
  /** used/limit → 0~100 百分比（钳制） */
  pct: (used: number, limit: number) => number
}

export interface QuotaHttpOptions {
  headers?: Record<string, string>
  /** 请求超时秒数（1~30，默认 15） */
  timeoutSeconds?: number
}

export interface QuotaHttpResponse<T> {
  status: number
  headers: Record<string, string>
  /** getJSON/postJSON 时为解析后的 JSON，get/post 时无 */
  json?: T
  /** get/post 时为响应体文本 */
  bodyText?: string
}

/** 策略元信息：目录展示与凭证要求说明 */
export interface QuotaStrategyMeta {
  id: string
  /** 展示名（如「Z.ai / GLM」） */
  label: string
  /** true = 内置策略（不可卸载不可删除） */
  builtin: boolean
  /**
   * 凭证要求：apiKey = 用提供商 API Key；token = 需访问令牌（OAuth/Codex 等，填 strategyConfig 或 apiKey）；
   * cookie = 需手贴浏览器 Cookie 头（strategyConfig.cookie）；none = 无需凭证
   */
  credential: 'apiKey' | 'token' | 'cookie' | 'none'
  /** 目录里的一句话说明 */
  description?: string
}

/** 注册表条目：元信息 + 受类型约束的执行方法 */
export interface QuotaStrategy {
  meta: QuotaStrategyMeta
  fetch: (ctx: QuotaStrategyContext) => QuotaSnapshot | Promise<QuotaSnapshot>
}

/** 策略目录项（IPC 返回）：注册表条目 + 外置策略启停状态 */
export interface QuotaStrategyInfo extends QuotaStrategyMeta {
  /** 外置策略的启停；内置恒为 true */
  enabled: boolean
}

/** 余量页列表项：绑定了策略的提供商 + 最新快照 */
export interface ProviderQuotaInfo {
  providerId: string
  providerName: string
  kind: string | null
  enabled: boolean
  strategyId: string | null
  strategyLabel: string | null
  snapshot: QuotaSnapshot | null
  /** 上次查询的失败原因（成功为 null） */
  error: string | null
  /** 上次查询时刻（epoch ms；从未查询为 null） */
  queriedAt: number | null
}

/** 外置策略（JS 脚本）新增/编辑入参：有 id 为更新，无 id 为新增 */
export interface QuotaPluginInput {
  id?: string
  name: string
  /** 脚本源码：顶层调用 defineProvider({...}) 的 JS（契约见 docs/app/11-余量查询.md） */
  script: string
  enabled: boolean
}

/** 外置策略行（IPC 返回，不含脚本正文则 tooLong——list 带全文，编辑需要） */
export interface QuotaPluginInfo {
  id: string
  name: string
  script: string
  enabled: boolean
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}
