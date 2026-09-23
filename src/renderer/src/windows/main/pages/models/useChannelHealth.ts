import { onMounted, ref, type Ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { ChannelHealthInfo } from '@common/types'

/** 健康快照轮询间隔：状态在主进程内存里变化（每次请求都可能变），没有推送通道，按页面挂载期轮询 */
const POLL_MS = 5000

/**
 * 渠道健康快照（页面私有 hook）：按 providerId 建索引供表格与链路视图取用。
 *
 * 定时器交给 useIntervalFn（自动导入）：组件卸载时由 tryOnScopeDispose 自动停，无需手写清理。
 * 失败静默：健康列读不到不该影响模型列表本身。
 */
export function useChannelHealth(): {
  health: Ref<Map<string, ChannelHealthInfo>>
  reload: () => Promise<void>
} {
  const health = ref(new Map<string, ChannelHealthInfo>())

  async function reload(): Promise<void> {
    try {
      const list = await window.preload.balancer.states()
      health.value = new Map(list.map((item) => [item.providerId, item]))
    } catch {
      // 健康快照读取失败不影响列表
    }
  }

  onMounted(() => void reload())
  useIntervalFn(() => void reload(), POLL_MS)

  return { health, reload }
}
