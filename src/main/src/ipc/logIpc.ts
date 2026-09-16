import { ipcMain } from 'electron'
import { cleanupExpiredLogs, clearTodayLogs, getTodayStats, listTodayLogs } from '../db/repo/logRepo'

/** 日志域 IPC：当日日志查询/清空 + 汇总统计 */
export function registerLogIpc(): void {
  ipcMain.handle('log:listToday', () => listTodayLogs())
  ipcMain.handle('log:clear', () => clearTodayLogs())
  ipcMain.handle('log:todayStats', () => getTodayStats())
}

/** 启动时清理上次运行残留的历史日志（main/index.ts 在 initDb 后调用） */
export function cleanupLogsOnStartup(): void {
  cleanupExpiredLogs()
}
