/**
 * 候选渠道排序：返回的数组首位即本次选定渠道，其余是改道顺序。
 *
 * 三条规则按优先级叠加：
 * 1. **会话亲和** —— 绑定的渠道仍可用时排第一（保 prompt cache 命中）；
 * 2. **探针优先** —— 可用度低且已经没人给它流量的渠道，先放一次探测（否则按权重几乎选不到、
 *    也就永远等不到成功来回涨，自动恢复会变成死锁）。只在**没有亲和绑定**的请求上生效，
 *    否则探针会把活跃会话从绑定渠道上拽走，白丢一次 cache 命中；
 * 3. **可用度加权洗牌** —— 权重即可用度，可用度越低被选中的概率越低。
 *
 * 额度阻断（可用度 0）的渠道直接剔除，不参与排序也不做探测。
 */
import { PROBE_BELOW, PROBE_COOLDOWN_MS } from './config'
import { availabilityOf, markAttempt, needsProbe } from './health'
import { boundProviderOf } from './session'

/** 排序候选渠道：返回空数组表示该模型的全部候选都被额度阻断（调用方据此回 503） */
export function orderCandidates<T extends { providerId: string }>(
  candidates: T[],
  sessionKey: string | null,
  publicModel: string
): T[] {
  const now = Date.now()
  const usable = candidates.filter((candidate) => availabilityOf(candidate.providerId, now) > 0)
  if (usable.length <= 1) return usable

  let rest = usable
  const head: T[] = []

  const boundId = sessionKey ? boundProviderOf(sessionKey, publicModel) : null
  const bound = boundId ? rest.find((candidate) => candidate.providerId === boundId) : undefined
  if (bound) {
    head.push(bound)
    rest = rest.filter((candidate) => candidate !== bound)
  } else {
    const probe = pickProbe(rest, now)
    if (probe) {
      head.push(probe)
      markAttempt(probe.providerId, now, true)
      rest = rest.filter((candidate) => candidate !== probe)
    }
  }

  return [
    ...head,
    ...weightedShuffle(rest, (candidate) => availabilityOf(candidate.providerId, now))
  ]
}

/** 探测目标：最该救的那条（可用度最低）且确实已经断流 */
function pickProbe<T extends { providerId: string }>(candidates: T[], now: number): T | null {
  const eligible = candidates
    .filter((candidate) => needsProbe(candidate.providerId, PROBE_BELOW, PROBE_COOLDOWN_MS, now))
    .sort((a, b) => availabilityOf(a.providerId, now) - availabilityOf(b.providerId, now))
  return eligible[0] ?? null
}

/**
 * 加权洗牌（不放回抽样）：首位是按权重随机选中的渠道，其余按同一权重继续排出改道顺序。
 * 用不放回抽样而不是「排序」，是为了让降级中的渠道既能拿到对应比例的流量，
 * 又不至于在失败时被固定排在最后。
 */
function weightedShuffle<T>(items: T[], weightOf: (item: T) => number): T[] {
  const pool = items.map((item) => ({ item, weight: Math.max(0, weightOf(item)) }))
  const ordered: T[] = []
  while (pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0)
    let index = 0
    if (total > 0) {
      let point = Math.random() * total
      while (index < pool.length - 1 && point >= pool[index].weight) {
        point -= pool[index].weight
        index += 1
      }
    }
    const picked = pool[index]
    ordered.push(picked.item)
    pool.splice(index, 1)
  }
  return ordered
}
