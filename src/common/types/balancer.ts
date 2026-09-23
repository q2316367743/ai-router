/**
 * 负载均衡引擎契约：可调配置与渠道健康快照。
 *
 * 配置存于 settings 表单键（值为此配置的 JSON 文本），读写走 setting 域通用通道；
 * 健康状态是主进程内存态，经 `balancer:states` 轮询读取（不落库：重启后由余量快照重建额度阻断）。
 */

/** 可调配置（设置页「负载均衡」卡片） */
export interface BalancerConfig {
  /** 总开关：关闭 = 单渠道直连，不选路、不拦额度、不改道（其余开关一并失效） */
  enabled: boolean
  /** 会话亲和：同一会话固定同一渠道（保上游 prompt cache 命中） */
  sessionAffinity: boolean
  /** 额度前置拦截：余量快照显示额度耗尽时直接不给该渠道流量 */
  quotaGuard: boolean
  /** 单请求最多尝试的渠道数 */
  maxAttempts: number
}

export const DEFAULT_BALANCER_CONFIG: BalancerConfig = {
  enabled: true,
  sessionAffinity: true,
  quotaGuard: true,
  maxAttempts: 3
}

/** 最大尝试渠道数上限（设置项钳制用） */
export const MAX_ATTEMPTS_LIMIT = 5

/** settings 表存储键 */
export const BALANCER_SETTING_KEY = 'router.balancing'

/** 渠道状态分档 */
export type ChannelState = 'healthy' | 'degraded' | 'blocked'

/** 单个渠道的运行时健康（IPC 返回：提供商的可用度与最近事件） */
export interface ChannelHealthInfo {
  providerId: string
  providerName: string
  /** 可用度 0~100：即该渠道当前分到的流量权重；0 = 额度阻断 */
  availability: number
  /** 状态分档（由可用度与阻断标记派生，口径见 @common/utils/balancerDisplay） */
  state: ChannelState
  /** 额度阻断原因（未阻断为 null） */
  blockReason: string | null
  /** 阻断自动解除时刻（epoch ms）；null = 等下一次余量快照刷新 */
  blockUntil: number | null
  /** 连续失败次数（成功即清零） */
  consecutiveFailures: number
  /** 最近一次失败摘要 */
  lastError: string | null
  lastFailureAt: number | null
  lastSuccessAt: number | null
}
