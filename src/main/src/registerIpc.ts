import { registerDbIpc } from '$/db/dbIpc'

/**
 * IPC 聚合注册点：各业务域的 ipcMain.handle/on 统一在此注册，
 * main/index.ts 启动时执行一次。新增业务域时在此追加对应 registerXxxIpc()。
 */
export function registerIpc(): void {
  registerDbIpc()
}
