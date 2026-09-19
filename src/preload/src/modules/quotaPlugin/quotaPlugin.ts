import { ipcRenderer } from 'electron'
import type { QuotaPluginInfo, QuotaPluginInput } from '@common/types'

/** 外置余量策略（用户 JS 脚本）：可卸载可删除（归档假删除 + 连带解绑提供商） */
export const quotaPluginApi = {
  list(): Promise<QuotaPluginInfo[]> {
    return ipcRenderer.invoke('quotaPlugin:list')
  },
  create(input: QuotaPluginInput): Promise<string> {
    return ipcRenderer.invoke('quotaPlugin:create', input)
  },
  update(input: QuotaPluginInput): Promise<void> {
    return ipcRenderer.invoke('quotaPlugin:update', input)
  },
  archive(id: string): Promise<void> {
    return ipcRenderer.invoke('quotaPlugin:archive', id)
  }
}
