import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import type { BalancerConfig, ChannelHealthInfo, ModelMappingInfo } from '@common/types'
import { BALANCER_SETTING_KEY } from '@common/types'
import { parseBalancerConfig } from '@common/utils/balancerConfig'
import { routeShares } from '@common/utils/balancerDisplay'

/** 链路支线：一个渠道此刻的运行时状态（可用度即路由权重） */
export interface ModelChainBranch {
  /** 渠道行 id（v-for key；渠道在组内不可重复，用它做键最稳） */
  id: string
  providerId: string
  providerName: string
  upstreamName: string
  /** 可用度 0~100（0 = 额度阻断）；从未失败过的提供商按满值 */
  availability: number
  /** 按权重推算的组内占比 0~1（全组额度阻断时全为 0） */
  share: number
  /** 健康快照（未查到为 null，徽标按满值展示） */
  info: ChannelHealthInfo | null
}

/** 一条链路：一个对外模型名（分叉点）+ 参与分流的渠道（支线） */
export interface ModelChainGroup {
  publicName: string
  branches: ModelChainBranch[]
  /** 停用 / 归档而不参与分流的渠道数（>0 时界面给脚注，否则图形会骗人） */
  excludedCount: number
  /** 全部支线都被额度阻断：引擎对该模型的请求会直接回 503 */
  allBlocked: boolean
}

/**
 * 链路视图数据：模型组 → 支线（可用度 + 推算占比）。
 *
 * 数据全部来自已有通道，**零新增 IPC**：渠道与分组取页面已加载的 `models`，
 * 健康度取页面那份 `useChannelHealth` 的 Map（由页面独占轮询，避免两个视图各轮一次），
 * 引擎开关取 settings 键 `router.balancing`（与设置页共用 `parseBalancerConfig`，界面口径即引擎口径）。
 */
export function useModelChains(
  models: Ref<ModelMappingInfo[]>,
  health: Ref<Map<string, ChannelHealthInfo>>
): {
  chains: ComputedRef<ModelChainGroup[]>
  config: Ref<BalancerConfig>
} {
  const config = ref<BalancerConfig>(parseBalancerConfig(null))
  let unsubscribe: (() => void) | null = null

  async function loadConfig(): Promise<void> {
    try {
      config.value = parseBalancerConfig(await window.preload.setting.get(BALANCER_SETTING_KEY))
    } catch {
      // 读不到就按默认值展示（与设置页同口径）
    }
  }

  const chains = computed<ModelChainGroup[]>(() => {
    const buckets = new Map<string, ModelMappingInfo[]>()
    for (const channel of models.value) {
      const bucket = buckets.get(channel.publicName)
      if (bucket) bucket.push(channel)
      else buckets.set(channel.publicName, [channel])
    }

    const groups: ModelChainGroup[] = []
    for (const [publicName, all] of buckets) {
      // 与引擎 isUsable 同口径：渠道与提供商都启用且未归档
      const routing = all.filter(
        (channel) =>
          channel.enabled &&
          channel.archivedAt === null &&
          channel.providerArchivedAt === null
      )
      // 整组不可用（对外已归档）时不画：那种名字的请求会直接 404
      if (routing.length === 0) continue

      const availabilities = routing.map((channel) => availabilityOf(channel, health.value))
      const shares = routeShares(availabilities)
      groups.push({
        publicName,
        branches: routing.map((channel, index) => ({
          id: channel.id,
          providerId: channel.providerId,
          providerName: channel.providerName,
          upstreamName: channel.upstreamName,
          availability: availabilities[index],
          share: shares[index],
          info: health.value.get(channel.providerId) ?? null
        })),
        excludedCount: all.length - routing.length,
        allBlocked: availabilities.every((value) => value <= 0)
      })
    }
    return groups
  })

  onMounted(() => {
    void loadConfig()
    // 设置页改开关后切回本页立刻正确（同窗口广播，无需等下一次挂载）
    unsubscribe = window.preload.setting.onSettingChanged((key) => {
      if (key === BALANCER_SETTING_KEY) void loadConfig()
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return { chains, config }
}

/** 该渠道此刻的可用度：健康快照是按提供商记的，未查到（从未失败过）按满值 */
function availabilityOf(
  channel: ModelMappingInfo,
  health: Map<string, ChannelHealthInfo>
): number {
  return health.get(channel.providerId)?.availability ?? 100
}
