import { ipcRenderer } from 'electron'
import type { LogFilterOptions, LogListQuery, LogListResult, RequestLogDetail, TodayStats } from '@common/types'

export const logApi = {
  list(query: LogListQuery): Promise<LogListResult> {
    return ipcRenderer.invoke('log:list', query)
  },
  filterOptions(): Promise<LogFilterOptions> {
    return ipcRenderer.invoke('log:filterOptions')
  },
  getDetail(id: number): Promise<RequestLogDetail | null> {
    return ipcRenderer.invoke('log:getDetail', id)
  },
  clearAll(): Promise<void> {
    return ipcRenderer.invoke('log:clearAll')
  },
  todayStats(): Promise<TodayStats> {
    return ipcRenderer.invoke('log:todayStats')
  }
}
