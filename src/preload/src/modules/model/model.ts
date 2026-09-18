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
  /** 归档（假删除）：对外名所有权保留，对外列表与请求路由随即不可见 */
  archive(id: string): Promise<void> {
    return ipcRenderer.invoke('model:archive', id)
  },
  /** 恢复：所属提供商仍归档时该映射依旧不可用，需先恢复提供商 */
  restore(id: string): Promise<void> {
    return ipcRenderer.invoke('model:restore', id)
  }
}
