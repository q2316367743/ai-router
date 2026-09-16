/**
 * 服务状态订阅：取一次初始状态 + 订阅变更，并在端口未知时用配置里的端口兜底。
 *
 * 首页与托盘面板共用，避免两处各写一遍「端口兜底 + 退订」这两段容易写漏的逻辑。
 * 必须在 setup 中调用（内部使用 onMounted / onUnmounted）。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import type { ServiceStatus } from '@common/types'

export function useServiceStatus(): Ref<ServiceStatus> {
  const status = ref<ServiceStatus>({ state: 'stopped', port: 0 })
  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    // getStatus 在未运行时可能不返回端口，此时回落到配置值
    void window.preload.service.getConfig().then((cfg) => {
      if (status.value.port === 0) status.value = { ...status.value, port: cfg.port }
    })
    void window.preload.service.getStatus().then((next) => {
      status.value = next
    })
    unsubscribe = window.preload.service.onStatusChanged((next) => {
      status.value = next
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  return status
}

/** 状态 → 胶囊文案与 t-tag 主题：ServiceStatusBar 与托盘标题栏共用，避免两处措辞漂移 */
export function serviceStatusMeta(status: ServiceStatus): {
  label: string
  theme: 'success' | 'danger' | 'default'
} {
  if (status.state === 'running') return { label: '运行中', theme: 'success' }
  if (status.state === 'error') return { label: '异常', theme: 'danger' }
  return { label: '已停止', theme: 'default' }
}
