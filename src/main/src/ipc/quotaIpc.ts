import { ipcMain } from 'electron'
import type { QuotaPluginInput } from '@common/types'
import {
  archiveQuotaPlugin,
  createQuotaPlugin,
  listQuotaPlugins,
  updateQuotaPlugin
} from '../db/repo/quotaRepo'
import {
  listQuotaOverview,
  listStrategyCatalog,
  refreshProviderQuota,
  reloadExternalStrategies,
  unregisterExternalStrategy,
  validatePluginScript
} from '../quota/service'

/** 余量域 IPC：查询/刷新/策略目录 + 外置策略（JS 脚本）管理 */
export function registerQuotaIpc(): void {
  ipcMain.handle('quota:list', () => listQuotaOverview())

  ipcMain.handle('quota:refresh', (_e, providerId?: string) =>
    refreshProviderQuota(providerId).then(() => listQuotaOverview())
  )

  ipcMain.handle('quota:strategies', () => listStrategyCatalog())

  ipcMain.handle('quotaPlugin:list', () => listQuotaPlugins())

  ipcMain.handle('quotaPlugin:create', (_e, input: QuotaPluginInput) => {
    assertPluginInput(input)
    validatePluginScript(input.script)
    const id = createQuotaPlugin(input)
    reloadExternalStrategies()
    return id
  })

  ipcMain.handle('quotaPlugin:update', (_e, input: QuotaPluginInput) => {
    if (!input?.id) throw new Error('缺少 id')
    assertPluginInput(input)
    validatePluginScript(input.script)
    updateQuotaPlugin(input)
    reloadExternalStrategies()
  })

  ipcMain.handle('quotaPlugin:archive', (_e, id: string) => {
    if (!id) throw new Error('缺少 id')
    archiveQuotaPlugin(id)
    unregisterExternalStrategy(id)
  })
}

function assertPluginInput(input: QuotaPluginInput): void {
  if (!input?.name?.trim()) throw new Error('策略名称不能为空')
  if (!input?.script?.trim()) throw new Error('脚本内容不能为空')
  if (typeof input.enabled !== 'boolean') throw new Error('缺少启用状态')
}
