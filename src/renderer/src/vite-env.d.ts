/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    /** @electron-toolkit/preload 的通用 electron API（ipcRenderer/webContents 等） */
    electron: ElectronAPI
    /** 业务桥：各域 API 在 src/preload/src/modules/<域>/ 实现后于 preload/index.ts 组装，并在此补充类型 */
    preload: {
      db: {
        /** 探活数据库连接（main 执行 SELECT 1） */
        ping(): Promise<boolean>
      }
    }
  }
}

export {}
