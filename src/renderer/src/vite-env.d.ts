/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  LogFilterOptions,
  LogListQuery,
  LogListResult,
  ModelMappingInfo,
  ModelMappingInput,
  ProviderInfo,
  ProviderInput,
  RequestLogDetail,
  ServiceConfig,
  ServiceStatus,
  TodayStats,
  UsageDailyItem
} from '@common/types'

declare global {
  interface Window {
    /** @electron-toolkit/preload 的通用 electron API（ipcRenderer/webContents 等） */
    electron: ElectronAPI
    /** 业务桥：各域 API 在 src/preload/src/modules/<域>/ 实现后于 preload/index.ts 组装 */
    preload: {
      db: {
        /** 探活数据库连接（main 执行 SELECT 1） */
        ping(): Promise<boolean>
      }
      provider: {
        list(): Promise<ProviderInfo[]>
        create(input: ProviderInput): Promise<string>
        update(input: ProviderInput): Promise<void>
        remove(id: string): Promise<void>
      }
      model: {
        list(): Promise<ModelMappingInfo[]>
        create(input: ModelMappingInput): Promise<string>
        update(input: ModelMappingInput): Promise<void>
        remove(id: string): Promise<void>
      }
      service: {
        getConfig(): Promise<ServiceConfig>
        /** 保存配置并重启代理服务，返回重启后的状态 */
        saveConfig(config: ServiceConfig): Promise<ServiceStatus>
        regenerateKey(): Promise<string>
        getStatus(): Promise<ServiceStatus>
        /** 订阅服务状态推送（server:status），返回退订函数 */
        onStatusChanged(cb: (status: ServiceStatus) => void): () => void
      }
      log: {
        /** 按条件（状态/供应商/模型）分页查询日志列表（轻量字段，不含正文与标头） */
        list(query: LogListQuery): Promise<LogListResult>
        /** 列表筛选项：日志中去重后的供应商 / 请求模型 */
        filterOptions(): Promise<LogFilterOptions>
        /** 按查询单条日志全量详情（含正文与标头） */
        getDetail(id: number): Promise<RequestLogDetail | null>
        /** 清空全部日志（保留窗口内） */
        clearAll(): Promise<void>
        todayStats(): Promise<TodayStats>
      }
      usage: {
        /** 查询日期区间（含边界）内按日 × 模型的用量明细 */
        listByRange(startDate: string, endDate: string): Promise<UsageDailyItem[]>
      }
    }
  }
}

export {}
