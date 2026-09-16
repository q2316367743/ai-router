import { ipcMain } from 'electron'
import type { ModelMappingInput } from '@common/types'
import { createModelMapping, listModelMappings, removeModelMapping, updateModelMapping } from '../db/repo/modelRepo'

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

  ipcMain.handle('model:remove', (_e, id: string) => {
    if (!id) throw new Error('缺少 id')
    removeModelMapping(id)
  })
}

function assertModelInput(input: ModelMappingInput): void {
  if (!input?.providerId) throw new Error('请选择提供商')
  if (!input?.publicName?.trim()) throw new Error('对外模型名不能为空')
  if (!input?.upstreamName?.trim()) throw new Error('上游模型名不能为空')
}
