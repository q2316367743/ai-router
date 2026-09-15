import { ipcRenderer } from 'electron'

/** 数据库桥：渲染层经此调用 main 进程的领域仓储方法，不感知 SQLite 细节 */
export const dbApi = {
  /** 探活数据库连接（main 执行 SELECT 1） */
  ping(): Promise<boolean> {
    return ipcRenderer.invoke('db:ping')
  }
}
