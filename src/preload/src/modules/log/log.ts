import { ipcRenderer } from 'electron'
import type { RequestLogItem, TodayStats } from '@common/types'

export const logApi = {
  listToday(): Promise<RequestLogItem[]> {
    return ipcRenderer.invoke('log:listToday')
  },
  clear(): Promise<void> {
    return ipcRenderer.invoke('log:clear')
  },
  todayStats(): Promise<TodayStats> {
    return ipcRenderer.invoke('log:todayStats')
  }
}
