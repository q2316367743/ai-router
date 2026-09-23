import { BrowserWindow, ipcMain } from 'electron'
import type { LogListQuery, LogStatusFilter } from '@common/types'
import {
  clearAllLogs,
  getLogDetail,
  getTodayStats,
  listFilterOptions,
  listLogs,
  onLogWritten
} from '$/db/repo/logRepo'

const STATUS_FILTERS: ReadonlySet<string> = new Set(['all', 'success', 'fail'])

/** 日志变更推送通道：写库 / 回填后通知渲染层刷新（前端据此实时显示进行中与完成态） */
const CHANGED_CHANNEL = 'log:changed'
/** 广播合并窗口（ms）：高并发下把多次写入合并为一次推送，避免渲染层刷新风暴 */
const BROADCAST_THROTTLE_MS = 300

let broadcastTimer: ReturnType<typeof setTimeout> | null = null

/** 日志域 IPC：条件分页查询 / 筛选项 / 单条详情 / 清空 / 汇总统计 */
export function registerLogIpc(): void {
  ipcMain.handle('log:list', (_event, query: LogListQuery) => listLogs(normalizeQuery(query)))
  ipcMain.handle('log:filterOptions', () => listFilterOptions())
  ipcMain.handle('log:getDetail', (_event, id: number) => getLogDetail(id))
  ipcMain.handle('log:clearAll', () => clearAllLogs())
  ipcMain.handle('log:todayStats', () => getTodayStats())
  onLogWritten(scheduleBroadcast)
}

/** 合并窗口内的多次写入只广播一次（尾部触发，保证最后一次写入后仍有推送） */
function scheduleBroadcast(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(CHANGED_CHANNEL)
    }
  }, BROADCAST_THROTTLE_MS)
}

/** 入参归一化：非法值一律回退默认（全部 / 不筛选 / 第 1 页 / 每页 25 条） */
function normalizeQuery(query: LogListQuery): LogListQuery {
  const status: LogStatusFilter = STATUS_FILTERS.has(query?.status) ? query.status : 'all'
  return {
    status,
    provider: typeof query?.provider === 'string' && query.provider ? query.provider : null,
    model: typeof query?.model === 'string' && query.model ? query.model : null,
    client: typeof query?.client === 'string' && query.client ? query.client : null,
    page: Number.isFinite(query?.page) && query.page > 0 ? Math.floor(query.page) : 1,
    pageSize:
      Number.isFinite(query?.pageSize) && query.pageSize > 0
        ? Math.min(100, Math.floor(query.pageSize))
        : 25
  }
}
