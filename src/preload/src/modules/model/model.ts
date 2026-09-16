import { ipcRenderer } from 'electron'
import type { ModelMappingInfo, ModelMappingInput } from '@common/types'

export const modelApi = {
  list(): Promise<ModelMappingInfo[]> {
    return ipcRenderer.invoke('model:list')
  },
  create(input: ModelMappingInput): Promise<string> {
    return ipcRenderer.invoke('model:create', input)
  },
  update(input: ModelMappingInput): Promise<void> {
    return ipcRenderer.invoke('model:update', input)
  },
  remove(id: string): Promise<void> {
    return ipcRenderer.invoke('model:remove', id)
  }
}
