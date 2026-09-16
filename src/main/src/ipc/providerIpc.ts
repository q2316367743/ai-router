import { ipcMain } from 'electron'
import type { ProviderInput, ProviderProtocol } from '@common/types'
import { createProvider, listProviders, removeProvider, updateProvider } from '../db/repo/providerRepo'

const PROTOCOLS: readonly ProviderProtocol[] = ['openai', 'openai-responses', 'anthropic']

/** 提供商域 IPC：只做参数校验与转发，数据操作在 providerRepo */
export function registerProviderIpc(): void {
  ipcMain.handle('provider:list', () => listProviders())

  ipcMain.handle('provider:create', (_e, input: ProviderInput) => {
    assertProviderInput(input)
    return createProvider(input)
  })

  ipcMain.handle('provider:update', (_e, input: ProviderInput) => {
    if (!input?.id) throw new Error('缺少 id')
    assertProviderInput(input)
    updateProvider(input)
  })

  ipcMain.handle('provider:remove', (_e, id: string) => {
    if (!id) throw new Error('缺少 id')
    removeProvider(id)
  })
}

function assertProviderInput(input: ProviderInput): void {
  if (!input?.name?.trim()) throw new Error('名称不能为空')
  if (!PROTOCOLS.includes(input?.protocol)) throw new Error('接口类型不合法')
  if (!input?.baseUrl?.trim()) throw new Error('Base URL 不能为空')
  if (!input?.apiKey?.trim()) throw new Error('API Key 不能为空')
}
