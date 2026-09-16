import { ipcMain } from 'electron'
import { listUsageByRange } from '../db/repo/usageRepo'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 用量域 IPC：按日期区间（含边界）查询每日用量 */
export function registerUsageIpc(): void {
  ipcMain.handle('usage:listByRange', (_e, query: { startDate: string; endDate: string }) => {
    if (!query || !DATE_RE.test(query.startDate ?? '') || !DATE_RE.test(query.endDate ?? '')) {
      throw new Error('日期格式应为 YYYY-MM-DD')
    }
    if (query.startDate > query.endDate) throw new Error('开始日期不能晚于结束日期')
    return listUsageByRange(query.startDate, query.endDate)
  })
}
