import { ipcRenderer } from 'electron'
import type { ProviderInfo, ProviderInput } from '@common/types'

export const providerApi = {
  list(): Promise<ProviderInfo[]> {
    return ipcRenderer.invoke('provider:list')
  },
  create(input: ProviderInput): Promise<string> {
    return ipcRenderer.invoke('provider:create', input)
  },
  update(input: ProviderInput): Promise<void> {
    return ipcRenderer.invoke('provider:update', input)
  },
  /** 归档（假删除）：连带归档其下未归档映射 */
  archive(id: string): Promise<void> {
    return ipcRenderer.invoke('provider:archive', id)
  },
  /** 恢复：只恢复提供商自身，其下映射需在模型页逐个恢复 */
  restore(id: string): Promise<void> {
    return ipcRenderer.invoke('provider:restore', id)
  }
}
