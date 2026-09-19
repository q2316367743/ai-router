import { registerDbIpc } from '$/db/dbIpc'
import { registerAppIpc } from '$/ipc/appIpc'
import { registerLogIpc } from '$/ipc/logIpc'
import { registerModelIpc } from '$/ipc/modelIpc'
import { registerProviderIpc } from '$/ipc/providerIpc'
import { registerQuotaIpc } from '$/ipc/quotaIpc'
import { registerServiceIpc } from '$/ipc/serviceIpc'
import { registerSettingIpc } from '$/ipc/settingIpc'
import { registerTrayIpc } from '$/ipc/trayIpc'
import { registerUsageIpc } from '$/ipc/usageIpc'

/**
 * IPC 聚合注册点：各业务域的 ipcMain.handle/on 统一在此注册，
 * main/index.ts 启动时执行一次。新增业务域时在此追加对应 registerXxxIpc()。
 */
export function registerIpc(): void {
  registerDbIpc()
  registerAppIpc()
  registerProviderIpc()
  registerModelIpc()
  registerServiceIpc()
  registerSettingIpc()
  registerLogIpc()
  registerUsageIpc()
  registerQuotaIpc()
  registerTrayIpc()
}
