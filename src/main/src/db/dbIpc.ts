import { ipcMain } from 'electron'
import { sql } from 'drizzle-orm'
import { db } from './client'

/**
 * 数据库域 IPC：渲染层经 window.preload.db 调用（桥在 src/preload/src/modules/db）。
 * 后续各表的操作建议按域拆 repo（repo/<域>Repo.ts），IPC 层只做参数校验与转发。
 */
export function registerDbIpc(): void {
  /** 探活：SELECT 1 验证连接与迁移链路可用 */
  ipcMain.handle('db:ping', () => {
    db().run(sql`SELECT 1`)
    return true
  })
}
