import { ipcRenderer } from 'electron'
import type { ServiceConfig, ServiceStatus } from '@common/types'

const STATUS_CHANNEL = 'server:status'

export const serviceApi = {
  getConfig(): Promise<ServiceConfig> {
    return ipcRenderer.invoke('service:getConfig')
  },
  /** 保存配置并重启代理服务，返回重启后的状态 */
  saveConfig(config: ServiceConfig): Promise<ServiceStatus> {
    return ipcRenderer.invoke('service:saveConfig', config)
  },
  regenerateKey(): Promise<string> {
    return ipcRenderer.invoke('service:regenerateKey')
  },
  getStatus(): Promise<ServiceStatus> {
    return ipcRenderer.invoke('service:getStatus')
  },
  /** 订阅服务状态推送，返回退订函数 */
  onStatusChanged(cb: (status: ServiceStatus) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, status: ServiceStatus): void => cb(status)
    ipcRenderer.on(STATUS_CHANNEL, listener)
    return () => ipcRenderer.off(STATUS_CHANNEL, listener)
  }
}
