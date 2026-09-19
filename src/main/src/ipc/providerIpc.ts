import { ipcMain } from 'electron'
import type { ProviderInput, ProviderKind, ProviderProtocol } from '@common/types'
import {
  archiveProvider,
  createProvider,
  listProviders,
  restoreProvider,
  updateProvider
} from '../db/repo/providerRepo'

const PROTOCOLS: readonly ProviderProtocol[] = ['openai', 'openai-responses', 'anthropic']

const KINDS: readonly ProviderKind[] = ['zai', 'opencode', 'deepseek', 'siliconflow']

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

  // 归档（假删除）/ 恢复：入参只有 id，状态翻转不经过 update 的编辑入参
  ipcMain.handle('provider:archive', (_e, id: string) => {
    if (!id) throw new Error('缺少 id')
    archiveProvider(id)
  })

  ipcMain.handle('provider:restore', (_e, id: string) => {
    if (!id) throw new Error('缺少 id')
    restoreProvider(id)
  })
}

function assertProviderInput(input: ProviderInput): void {
  if (!input?.name?.trim()) throw new Error('名称不能为空')
  if (!PROTOCOLS.includes(input?.protocol)) throw new Error('接口类型不合法')
  if (input?.kind != null && !KINDS.includes(input.kind)) throw new Error('提供商类型不合法')
  if (!input?.baseUrl?.trim()) throw new Error('Base URL 不能为空')
  if (!input?.apiKey?.trim()) throw new Error('API Key 不能为空')
}
