/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AutoLaunchState,
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
  UsageDailyItem,
  UsageFilterOptions,
  UsageModelSpeed,
  UsageOverview,
  UsageQuery
} from '@common/types'

declare global {
  interface Window {
    /** @electron-toolkit/preload 的通用 electron API（ipcRenderer/webContents 等） */
    electron: ElectronAPI
    /** 业务桥：各域 API 在 src/preload/src/modules/<域>/ 实现后于 preload/index.ts 组装 */
    preload: {
      app: {
        /** 读取开机自启状态（以操作系统登录项为权威） */
        getAutoLaunch(): Promise<AutoLaunchState>
        /** 设置开机自启，返回回读后的真实状态 */
        setAutoLaunch(enabled: boolean): Promise<AutoLaunchState>
      }
      db: {
        /** 探活数据库连接（main 执行 SELECT 1） */
        ping(): Promise<boolean>
      }
      provider: {
        list(): Promise<ProviderInfo[]>
        create(input: ProviderInput): Promise<string>
        update(input: ProviderInput): Promise<void>
        /** 归档（假删除）：连带归档其下未归档的模型映射 */
        archive(id: string): Promise<void>
        /** 恢复：只恢复提供商自身，其下映射需在模型页逐个恢复 */
        restore(id: string): Promise<void>
      }
      model: {
        list(): Promise<ModelMappingInfo[]>
        create(input: ModelMappingInput): Promise<string>
        update(input: ModelMappingInput): Promise<void>
        /** 归档（假删除）：对外名所有权保留，对外列表与请求路由随即不可见 */
        archive(id: string): Promise<void>
        /** 恢复：所属提供商仍归档时该映射依旧不可用，需先恢复提供商 */
        restore(id: string): Promise<void>
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
        /** 订阅日志变更推送（写库 / 回填后触发），返回退订函数 */
        onChanged(cb: () => void): () => void
      }
      usage: {
        /** 看板全量统计数据（总计 / 供应商与模型拆分 / 时间序列 / 活跃度） */
        overview(query: UsageQuery): Promise<UsageOverview>
        /** 统计筛选项：聚合表中去重后的供应商与模型 */
        filterOptions(): Promise<UsageFilterOptions>
        /** 查询日期区间（含边界）内按日 × 供应商 × 模型的用量明细 */
        listByRange(startDate: string, endDate: string): Promise<UsageDailyItem[]>
        /** 模型速度折线：固定近七天窗口，按供应商 × 模型分线（数据源为请求日志） */
        modelSpeed(): Promise<UsageModelSpeed>
      }
      tray: {
        /** 收起托盘统计面板 */
        hide(): Promise<void>
        /** 打开（或前置）主窗口 */
        openMain(): Promise<void>
        /** 订阅面板显示事件（每次弹出触发，用于刷新过期数据），返回退订函数 */
        onShown(cb: () => void): () => void
      }
    }
  }
}

export {}
