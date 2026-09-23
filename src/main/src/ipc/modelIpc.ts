import { ipcMain } from 'electron'
import type {
  ModelChannelInput,
  ModelChannelPatch,
  ModelGroupEnabledInput,
  ModelGroupRenameInput
} from '@common/types'
import {
  archiveModelGroup,
  archiveModelMapping,
  createModelMapping,
  listModelMappings,
  renameModelGroup,
  restoreModelGroup,
  restoreModelMapping,
  setModelGroupEnabled,
  updateModelMapping
} from '../db/repo/modelRepo'

/**
 * 模型域 IPC：渠道（对外名 ↔ 上游模型的一行）用 model:xxx，组级（同一对外名的全部渠道）
 * 用 model:groupXxx。只做参数校验与转发，数据操作在 modelRepo。
 */
export function registerModelIpc(): void {
  ipcMain.handle('model:list', () => listModelMappings())

  ipcMain.handle('model:create', (_e, input: ModelChannelInput) => {
    assertChannelInput(input)
    return createModelMapping(input)
  })

  ipcMain.handle('model:update', (_e, input: ModelChannelPatch) => {
    if (!input?.id) throw new Error('缺少 id')
    if (!input?.providerId) throw new Error('请选择提供商')
    if (!input?.upstreamName?.trim()) throw new Error('上游模型名不能为空')
    updateModelMapping(input)
  })

  // 归档（假删除）/ 恢复：入参只有 id，状态翻转不经过 update 的编辑入参
  ipcMain.handle('model:archive', (_e, id: string) => {
    if (!id) throw new Error('缺少 id')
    archiveModelMapping(id)
  })

  ipcMain.handle('model:restore', (_e, id: string) => {
    if (!id) throw new Error('缺少 id')
    restoreModelMapping(id)
  })

  // 组级动作：一次作用于该对外名下的全部渠道（重命名另外改写历史统计与日志）
  ipcMain.handle('model:groupRename', (_e, input: ModelGroupRenameInput) => {
    if (!input?.from) throw new Error('缺少原对外模型名')
    const to = input.to?.trim()
    if (!to) throw new Error('对外模型名不能为空')
    renameModelGroup(input.from, to)
  })

  ipcMain.handle('model:groupEnabled', (_e, input: ModelGroupEnabledInput) => {
    if (!input?.publicName) throw new Error('缺少对外模型名')
    setModelGroupEnabled(input.publicName, input.enabled === true)
  })

  ipcMain.handle('model:groupArchive', (_e, publicName: string) => {
    if (!publicName) throw new Error('缺少对外模型名')
    archiveModelGroup(publicName)
  })

  ipcMain.handle('model:groupRestore', (_e, publicName: string) => {
    if (!publicName) throw new Error('缺少对外模型名')
    restoreModelGroup(publicName)
  })
}

function assertChannelInput(input: ModelChannelInput): void {
  if (!input?.providerId) throw new Error('请选择提供商')
  if (!input?.publicName?.trim()) throw new Error('对外模型名不能为空')
  if (!input?.upstreamName?.trim()) throw new Error('上游模型名不能为空')
}
