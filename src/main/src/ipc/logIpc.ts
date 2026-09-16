import { ipcMain } from 'electron'
import type { LogListQuery, LogStatusFilter } from '@common/types'
import { cleanupExpiredLogs, clearAllLogs, getLogDetail, getTodayStats, listFilterOptions, listLogs } from '../db/repo/logRepo'

const STATUS_FILTERS: ReadonlySet<string> = new Set(['all', 'success', 'fail'])

/** 日志域 IPC：条件分页查询 / 筛选项 / 单条详情 / 清空 / 汇总统计 */
export function registerLogIpc(): void {
  ipcMain.handle('log:list', (_event, query: LogListQuery) => listLogs(normalizeQuery(query)))
  ipcMain.handle('log:filterOptions', () => listFilterOptions())
  ipcMain.handle('log:getDetail', (_event, id: number) => getLogDetail(id))
  ipcMain.handle('log:clearAll', () => clearAllLogs())
  ipcMain.handle('log:todayStats', () => getTodayStats())
}

/** 入参归一化：非法值一律回退默认（全部 / 不筛选 / 第 1 页 / 每页 25 条） */
function normalizeQuery(query: LogListQuery): LogListQuery {
  const status: LogStatusFilter = STATUS_FILTERS.has(query?.status) ? query.status : 'all'
  return {
    status,
    provider: typeof query?.provider === 'string' && query.provider ? query.provider : null,
    model: typeof query?.model === 'string' && query.model ? query.model : null,
    page: Number.isFinite(query?.page) && query.page > 0 ? Math.floor(query.page) : 1,
    pageSize:
      Number.isFinite(query?.pageSize) && query.pageSize > 0 ? Math.min(100, Math.floor(query.pageSize)) : 25
  }
}

/** 启动时清理超出保留窗口的历史日志（main/index.ts 在 initDb 后调用） */
export function cleanupLogsOnStartup(): void {
  cleanupExpiredLogs()
}
