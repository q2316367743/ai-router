/**
 * 负载均衡参数：可调项存 settings（键 `router.balancing`，契约见 @common/types/balancer），
 * 机制常量写死在此。
 *
 * 比例类常量不开放配置：它们定义的是「先大后小的扣减 / 先小后大的回涨」这套口径本身，
 * 改了就不是同一套行为，出问题时无从复现（文档里的曲线表也按这些值推导）。
 */
import type { BalancerConfig } from '@common/types'
import { BALANCER_SETTING_KEY, DEFAULT_BALANCER_CONFIG, MAX_ATTEMPTS_LIMIT } from '@common/types'
import { parseBalancerConfig } from '@common/utils/balancerConfig'
import { getSetting } from '$/db/repo/settingRepo'

export { BALANCER_SETTING_KEY, DEFAULT_BALANCER_CONFIG, MAX_ATTEMPTS_LIMIT }
export type { BalancerConfig }

/** 失败扣减比例：扣掉当前可用度的 10%（可用度越高扣得越多 = 先大后小） */
export const DECAY_RATIO = 0.1
/** 成功回涨比例：涨回当前可用度的 10%（可用度越低涨得越少 = 先小后大） */
export const RECOVER_RATIO = 0.1
/** 单次步进下限：可用度极低时按比例只剩零点几，没有下限会永远趴在地上 */
export const MIN_STEP = 2
/** 可用度下限：普通失败衰减到此为止（0 只留给额度阻断） */
export const MIN_AVAILABILITY = 1
/** 初始可用度 */
export const INITIAL_AVAILABILITY = 100
/** 探针放行阈值：可用度 ≤ 此值且已无流量时，优先拿一次探测请求 */
export const PROBE_BELOW = 40
/** 探针冷却：同一渠道两次探测的最小间隔 */
export const PROBE_COOLDOWN_MS = 30_000
/** 首字节超时：上游迟迟不返回响应头时的兜底（拿到响应头立即清零，长请求不受影响） */
export const FIRST_BYTE_TIMEOUT_MS = 60_000
/** 响应侧推断的额度阻断时长（到期自动解除并拉满，等于放一次全量探测） */
export const QUOTA_BLOCK_TTL_MS = 10 * 60_000
/** 快照侧额度阻断的兜底时长：窗口没有 resetsAt 时最多阻断这么久，防配额接口长期不可用卡死 */
export const QUOTA_BLOCK_MAX_MS = 60 * 60_000
/** 会话亲和绑定存活时长（无访问即过期） */
export const SESSION_TTL_MS = 2 * 60 * 60_000
/** 会话亲和绑定表容量上限 */
export const SESSION_MAX = 2000
/** 会话指纹取样长度：只取首条 system / user 的前若干字符参与哈希 */
export const SESSION_FINGERPRINT_CHARS = 1000

/** 读取引擎配置（键缺失或损坏一律回落默认值）：每请求读一次，键值读取走 SQLite 主键查询 */
export function getBalancerConfig(): BalancerConfig {
  const raw = getSetting(BALANCER_SETTING_KEY)
  if (!raw) return DEFAULT_BALANCER_CONFIG
  try {
    return parseBalancerConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_BALANCER_CONFIG
  }
}
