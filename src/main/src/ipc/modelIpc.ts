import { ipcMain } from 'electron'
import type { ModelMappingInput } from '@common/types'
import {
  archiveModelMapping,
  createModelMapping,
  listModelMappings,
  restoreModelMapping,
  updateModelMapping
} from '../db/repo/modelRepo'

/** 模型映射域 IPC：只做参数校验与转发，数据操作在 modelRepo */
export function registerModelIpc(): void {
  ipcMain.handle('model:list', () => listModelMappings())

  ipcMain.handle('model:create', (_e, input: ModelMappingInput) => {
    assertModelInput(input)
    return createModelMapping(input)
  })

  ipcMain.handle('model:update', (_e, input: ModelMappingInput) => {
    if (!input?.id) throw new Error('缺少 id')
    assertModelInput(input)
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
}

function assertModelInput(input: ModelMappingInput): void {
  if (!input?.providerId) throw new Error('请选择提供商')
  if (!input?.publicName?.trim()) throw new Error('对外模型名不能为空')
  if (!input?.upstreamName?.trim()) throw new Error('上游模型名不能为空')
}
