/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  ModelMappingInfo,
  ModelMappingInput,
  ProviderInfo,
  ProviderInput,
  RequestLogItem,
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
        listToday(): Promise<RequestLogItem[]>
        clear(): Promise<void>
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
