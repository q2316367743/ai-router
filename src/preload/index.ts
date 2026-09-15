import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { dbApi } from '~/modules/db/db'

// 各域 API 在 src/preload/src/modules/<域>/ 实现，在此组装暴露给渲染层（window.preload）。
// 契约类型同步声明在 src/renderer/src/vite-env.d.ts 的 Window.preload。
const preload = {
  db: dbApi
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
