import { ipcRenderer } from 'electron'
import type { UsageDailyItem } from '@common/types'

export const usageApi = {
  /** 查询日期区间（含边界）内按日 × 模型的用量明细 */
  listByRange(startDate: string, endDate: string): Promise<UsageDailyItem[]> {
    return ipcRenderer.invoke('usage:listByRange', { startDate, endDate })
  }
}
