import { ipcRenderer } from 'electron'
import type {
  ModelChannelInput,
  ModelChannelPatch,
  ModelGroupEnabledInput,
  ModelGroupRenameInput,
  ModelMappingInfo
} from '@common/types'

/**
 * 模型域桥：渠道（对外名 ↔ 上游模型的一行）用 `create/update/archive/restore`，
 * 组级动作（同一对外名的全部渠道）用 `groupXxx`。
 */
export const modelApi = {
  list(): Promise<ModelMappingInfo[]> {
    return ipcRenderer.invoke('model:list')
  },
  /** 新增渠道：对外名首次出现即「新建对外模型」，同名再建即「在该名下加渠道」 */
  create(input: ModelChannelInput): Promise<string> {
    return ipcRenderer.invoke('model:create', input)
  },
  /** 编辑渠道：对外名不属于渠道，改名走 groupRename */
  update(input: ModelChannelPatch): Promise<void> {
    return ipcRenderer.invoke('model:update', input)
  },
  /** 归档渠道（假删除）：该 (对外名, 提供商) 组合的所有权保留 */
  archive(id: string): Promise<void> {
    return ipcRenderer.invoke('model:archive', id)
  },
  /** 恢复渠道：所属提供商仍归档时该渠道依旧不可用，需先恢复提供商 */
  restore(id: string): Promise<void> {
    return ipcRenderer.invoke('model:restore', id)
  },
  /** 组级重命名：一次改该名下全部渠道，并改写历史统计与日志 */
  groupRename(input: ModelGroupRenameInput): Promise<void> {
    return ipcRenderer.invoke('model:groupRename', input)
  },
  /** 组级启停：一次改该名下全部未归档渠道 */
  groupEnabled(input: ModelGroupEnabledInput): Promise<void> {
    return ipcRenderer.invoke('model:groupEnabled', input)
  },
  /** 组级归档：对外名整体下线（请求返回 404 model_archived） */
  groupArchive(publicName: string): Promise<void> {
    return ipcRenderer.invoke('model:groupArchive', publicName)
  },
  /** 组级恢复：一次恢复该名下全部渠道 */
  groupRestore(publicName: string): Promise<void> {
    return ipcRenderer.invoke('model:groupRestore', publicName)
  }
}
