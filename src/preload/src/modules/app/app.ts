import { ipcRenderer } from 'electron'
import type { AutoLaunchState } from '@common/types'

export const appApi = {
  getAutoLaunch(): Promise<AutoLaunchState> {
    return ipcRenderer.invoke('app:getAutoLaunch')
  },
  /** 写入系统登录项并返回回读后的真实状态 */
  setAutoLaunch(enabled: boolean): Promise<AutoLaunchState> {
    return ipcRenderer.invoke('app:setAutoLaunch', enabled)
  }
}
