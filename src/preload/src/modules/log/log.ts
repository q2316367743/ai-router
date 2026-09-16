import { ipcRenderer } from 'electron'
import type { LogFilterOptions, LogListQuery, LogListResult, RequestLogDetail, TodayStats } from '@common/types'

const CHANGED_CHANNEL = 'log:changed'

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
  },
  /** 订阅日志变更推送（写库 / 回填后触发），返回退订函数 */
  onChanged(cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on(CHANGED_CHANNEL, listener)
    return () => ipcRenderer.off(CHANGED_CHANNEL, listener)
  }
}
