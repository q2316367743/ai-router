import { ipcRenderer } from 'electron'
import type { ProviderQuotaInfo, QuotaStrategyInfo } from '@common/types'

export const quotaApi = {
  /** 余量页列表：绑定了策略的提供商 + 最新快照（读库，不出站） */
  list(): Promise<ProviderQuotaInfo[]> {
    return ipcRenderer.invoke('quota:list')
  },
  /** 手动刷新（不传 id 刷全部），返回刷新后的列表 */
  refresh(providerId?: string): Promise<ProviderQuotaInfo[]> {
    return ipcRenderer.invoke('quota:refresh', providerId)
  },
  /** 策略目录：内置（只读）+ 外置（含启停状态） */
  strategies(): Promise<QuotaStrategyInfo[]> {
    return ipcRenderer.invoke('quota:strategies')
  }
}
