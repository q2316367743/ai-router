/**
 * 负载均衡引擎的领域类型：失败归类、可用度状态、渠道健康快照。
 *
 * 本模块（server/balancer/）不碰 HTTP —— 请求执行、响应改道与日志在 server/strategies/ 里，
 * 引擎只回答两件事：**这个渠道现在给多少流量**、**这次尝试该不该扣分**。
 */

/**
 * 一次渠道尝试的归类：决定是否扣减可用度、是否改道下一渠道。
 *
 * - `upstream` 上游服务问题（网络错误 / 5xx / 429 / 首字节超时 / 提交前断流）：扣分 + 改道
 * - `auth` 凭据问题（401/403）：扣分 + 改道（另一家可能凭据正常）
 * - `quota` 额度问题（402 / 正文含额度关键字）：**直接阻断** + 改道
 * - `missing` 上游没有该模型或端点（404）：不扣分（不是渠道健康问题）+ 改道
 * - `request` 请求侧问题（400/413/422 等）：不扣分 + 不改道，原样回给客户端
 * - `client` 客户端主动断开：不扣分 + 不改道
 */
export type AttemptKind = 'ok' | 'upstream' | 'auth' | 'quota' | 'missing' | 'request' | 'client'

/** 额度阻断来源：快照（权威，随余量刷新更新） / 响应推断（启发式，到期自动解除） */
export type QuotaBlockSource = 'snapshot' | 'response'

/** 运行中的渠道健康状态（内存态，键为 providerId） */
export interface ChannelHealth {
  providerId: string
  /**
   * 可用度 0~100，路由权重即此值。
   * 0 只由额度阻断产生；普通失败衰减到 `MIN_AVAILABILITY` 为止，永不为 0。
   */
  availability: number
  /** 是否处于额度阻断（可用度归零、不分配任何流量） */
  quotaBlocked: boolean
  /** 阻断原因（展示与日志用） */
  blockReason: string | null
  /** 阻断自动解除时刻（窗口 resetsAt / 推断 TTL）；null = 只能等下一次余量快照刷新解除 */
  blockUntil: number | null
  /** 阻断来源：快照阻断才会被「快照显示健康」解除 */
  blockSource: QuotaBlockSource | null
  /** 连续失败次数（成功即清零；展示用） */
  consecutiveFailures: number
  lastFailureAt: number | null
  /** 最近一次失败摘要 */
  lastError: string | null
  lastSuccessAt: number | null
  /** 最近一次被派发请求的时刻（含探测）：用于判断「这条渠道是否已经没人给它流量了」 */
  lastAttemptAt: number | null
  /** 最近一次探测派发时刻 */
  lastProbeAt: number | null
}

/** 额度阻断状态（由余量快照或错误响应推断） */
export interface QuotaBlock {
  reason: string
  /** 自动解除时刻；null = 等下一次快照刷新 */
  until: number | null
}
