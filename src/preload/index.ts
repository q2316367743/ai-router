import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { appApi } from '~/modules/app/app'
import { balancerApi } from '~/modules/balancer/balancer'
import { dbApi } from '~/modules/db/db'
import { providerApi } from '~/modules/provider/provider'
import { modelApi } from '~/modules/model/model'
import { serviceApi } from '~/modules/service/service'
import { settingApi } from '~/modules/setting/setting'
import { logApi } from '~/modules/log/log'
import { trayApi } from '~/modules/tray/tray'
import { usageApi } from '~/modules/usage/usage'
import { quotaApi } from '~/modules/quota/quota'
import { quotaPluginApi } from '~/modules/quotaPlugin/quotaPlugin'

// 各域 API 在 src/preload/src/modules/<域>/ 实现，在此组装暴露给渲染层（window.preload）。
// 契约类型同步声明在 src/renderer/src/vite-env.d.ts 的 Window.preload。
const preload = {
  app: appApi,
  db: dbApi,
  provider: providerApi,
  model: modelApi,
  service: serviceApi,
  setting: settingApi,
  log: logApi,
  usage: usageApi,
  quota: quotaApi,
  quotaPlugin: quotaPluginApi,
  balancer: balancerApi,
  tray: trayApi
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('preload', preload)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.preload = preload
}
