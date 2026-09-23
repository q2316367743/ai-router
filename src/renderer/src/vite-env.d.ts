/// <reference types="vite/client" />
import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AutoLaunchState,
  ChannelHealthInfo,
  LogFilterOptions,
  LogListQuery,
  LogListResult,
  ModelChannelInput,
  ModelChannelPatch,
  ModelGroupEnabledInput,
  ModelGroupRenameInput,
  ModelMappingInfo,
  ProviderInfo,
  ProviderInput,
  ProviderQuotaInfo,
  QuotaPluginInfo,
  QuotaPluginInput,
  QuotaStrategyInfo,
  RequestLogDetail,
  ServiceConfig,
  ServiceStatus,
  TodayStats,
  UsageAgentFlow,
  UsageClientStats,
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
        /** 新增渠道：对外名首次出现即「新建对外模型」，同名再建即「在该名下加渠道」 */
        create(input: ModelChannelInput): Promise<string>
        /** 编辑渠道：对外名不属于渠道，改名走 groupRename */
        update(input: ModelChannelPatch): Promise<void>
        /** 归档渠道（假删除）：该 (对外名, 提供商) 组合的所有权保留 */
        archive(id: string): Promise<void>
        /** 恢复渠道：所属提供商仍归档时该渠道依旧不可用，需先恢复提供商 */
        restore(id: string): Promise<void>
        /** 组级重命名：一次改该名下全部渠道，并改写历史统计与日志 */
        groupRename(input: ModelGroupRenameInput): Promise<void>
        /** 组级启停：一次改该名下全部未归档渠道 */
        groupEnabled(input: ModelGroupEnabledInput): Promise<void>
        /** 组级归档：对外名整体下线（请求返回 404 model_archived） */
        groupArchive(publicName: string): Promise<void>
        /** 组级恢复：一次恢复该名下全部渠道 */
        groupRestore(publicName: string): Promise<void>
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
      setting: {
        /** 读取键值设置（值经 JSON 解析；键不存在或脏数据返回 null） */
        get(key: string): Promise<unknown>
        /** 写入键值设置（JSON 序列化存 settings 表），并向所有窗口广播 setting:changed */
        set(key: string, value: unknown): Promise<void>
        /** 订阅设置变更广播（任意窗口保存触发，携带变更的键名），返回退订函数 */
        onSettingChanged(cb: (key: string) => void): () => void
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
        /** 来源客户端请求数：固定近七天窗口，按来源分组计数（数据源为请求日志） */
        clientStats(): Promise<UsageClientStats>
        /** Agent × 提供商交叉流量：固定近七天窗口，按来源 × 提供商分组计数（数据源为请求日志） */
        agentFlow(): Promise<UsageAgentFlow>
      }
      quota: {
        /** 余量页列表：绑定了余量策略的提供商 + 最新快照（读库，不出站） */
        list(): Promise<ProviderQuotaInfo[]>
        /** 手动刷新（不传 id 刷全部），返回刷新后的列表 */
        refresh(providerId?: string): Promise<ProviderQuotaInfo[]>
        /** 策略目录：内置（只读，不可卸载）+ 外置（含启停状态） */
        strategies(): Promise<QuotaStrategyInfo[]>
      }
      quotaPlugin: {
        /** 外置策略全量列表（含已归档，UI 自行过滤） */
        list(): Promise<QuotaPluginInfo[]>
        /** 安装脚本策略（main 侧先 eval 校验），返回新 id */
        create(input: QuotaPluginInput): Promise<string>
        /** 编辑脚本策略（归档行不可编辑），更新后自动重载注册表 */
        update(input: QuotaPluginInput): Promise<void>
        /** 归档（假删除）：连带解绑引用它的提供商 */
        archive(id: string): Promise<void>
      }
      balancer: {
        /** 全部未归档提供商的健康快照（可用度 / 状态 / 最近失败 / 额度阻断原因） */
        states(): Promise<ChannelHealthInfo[]>
        /** 手动重置：可用度拉回满值并解除额度阻断 */
        reset(providerId: string): Promise<void>
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
