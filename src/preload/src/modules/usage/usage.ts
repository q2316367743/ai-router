import { ipcRenderer } from 'electron'
import type { UsageDailyItem, UsageFilterOptions, UsageOverview, UsageQuery } from '@common/types'

export const usageApi = {
  /** 看板全量统计数据（总计 / 供应商与模型拆分 / 时间序列 / 活跃度） */
  overview(query: UsageQuery): Promise<UsageOverview> {
    return ipcRenderer.invoke('usage:overview', query)
  },
  /** 统计筛选项：聚合表中去重后的供应商与模型 */
  filterOptions(): Promise<UsageFilterOptions> {
    return ipcRenderer.invoke('usage:filterOptions')
  },
  /** 查询日期区间（含边界）内按日 × 供应商 × 模型的用量明细 */
  listByRange(startDate: string, endDate: string): Promise<UsageDailyItem[]> {
    return ipcRenderer.invoke('usage:listByRange', { startDate, endDate })
  }
}
