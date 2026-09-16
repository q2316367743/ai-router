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
  remove(id: string): Promise<void> {
    return ipcRenderer.invoke('provider:remove', id)
  }
}
