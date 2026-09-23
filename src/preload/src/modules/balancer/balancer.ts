import { ipcRenderer } from 'electron'
import type { ChannelHealthInfo } from '@common/types'

/** 负载均衡桥：渠道健康快照与手动重置（状态在主进程内存，按需轮询） */
export const balancerApi = {
  /** 全部未归档提供商的健康快照（可用度 / 状态 / 最近失败 / 额度阻断原因） */
  states(): Promise<ChannelHealthInfo[]> {
    return ipcRenderer.invoke('balancer:states')
  },
  /** 手动重置：可用度拉回满值并解除额度阻断（充值 / 修好 Key 后不想等下一轮刷新的逃生口） */
  reset(providerId: string): Promise<void> {
    return ipcRenderer.invoke('balancer:reset', providerId)
  }
}
