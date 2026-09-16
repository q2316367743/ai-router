import { ipcMain } from 'electron'
import { getAutoLaunchState, setAutoLaunchEnabled } from '../app/autoLaunch'

/** 应用级设置 IPC：开机自启状态以操作系统登录项为权威，写入后回读真实值返回 */
export function registerAppIpc(): void {
  ipcMain.handle('app:getAutoLaunch', () => getAutoLaunchState())

  ipcMain.handle('app:setAutoLaunch', (_e, enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('参数错误')
    setAutoLaunchEnabled(enabled)
    return getAutoLaunchState()
  })
}
