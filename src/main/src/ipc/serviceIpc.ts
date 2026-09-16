import { ipcMain } from 'electron'
import type { ServiceConfig } from '@common/types'
import { getServiceConfig, regenerateApiKey, saveServiceConfig } from '../db/repo/settingRepo'
import { getServerStatus, restartProxyServer } from '../server/proxyServer'

/** 服务配置域 IPC：保存后自动重启代理服务；Key 每请求实时读取，变更无需重启 */
export function registerServiceIpc(): void {
  ipcMain.handle('service:getConfig', () => getServiceConfig())

  ipcMain.handle('service:saveConfig', async (_e, config: ServiceConfig) => {
    if (!config) throw new Error('参数错误')
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new Error('端口必须是 1-65535 的整数')
    }
    saveServiceConfig(config)
    await restartProxyServer()
    return getServerStatus()
  })

  ipcMain.handle('service:regenerateKey', () => regenerateApiKey())

  ipcMain.handle('service:getStatus', () => getServerStatus())
}
