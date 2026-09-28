/**
 * 看板卡片注册表：看板全部卡片的唯一事实源，数组顺序即默认渲染顺序。
 *
 * 新增卡片 = 实现一个只收 `ctx`（+ 可选 extraProps）契约的卡片组件，在此追加一行定义；
 * 布局配置的合并、配置抽屉的清单、跨窗口同步随之自动生效，无需改动任何配置代码。
 *
 * surfaces 控制卡片出现在哪些界面（速度 / 来源 Agent 两卡数据仅首页取数，且窄面板放不下）；
 * id 是布局配置的持久化键，注册后不可改名（改名等于换卡，用户的配置会失效）。
 */
import {
  CalendarIcon,
  ChartBarIcon,
  ChartComboIcon,
  ChartLineIcon,
  ChartPieIcon,
  ChartRingIcon,
  CheckCircleIcon,
  FlowchartIcon,
  LayersIcon,
  TimeIcon
} from 'tdesign-icons-vue-next'
import type { DashboardCardDef } from './cardTypes'
import UsageStatCard from './UsageStatCard.vue'
import UsageTrendCard from './UsageTrendCard.vue'
import UsageProviderTrendCard from './UsageProviderTrendCard.vue'
import UsageActivityCard from './UsageActivityCard.vue'
import UsageCompositionCard from './UsageCompositionCard.vue'
import UsageSuccessRatioCard from './UsageSuccessRatioCard.vue'
import UsageCacheRatioCard from './UsageCacheRatioCard.vue'
import UsageProviderBarCard from './UsageProviderBarCard.vue'
import UsageClientCard from './UsageClientCard.vue'
import UsageSankeyCard from './UsageSankeyCard.vue'
import UsageSpeedCard from './UsageSpeedCard.vue'

const BOTH_SURFACES = ['home', 'tray'] as const

export const DASHBOARD_CARDS: DashboardCardDef[] = [
  {
    id: 'stat-requests',
    title: '请求数',
    icon: ChartBarIcon,
    component: UsageStatCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'cell',
    extraProps: { cardKey: 'requests' }
  },
  {
    id: 'stat-success',
    title: '成功率',
    icon: CheckCircleIcon,
    component: UsageStatCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'cell',
    extraProps: { cardKey: 'success' }
  },
  {
    id: 'stat-latency',
    title: '平均延迟',
    icon: TimeIcon,
    component: UsageStatCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'cell',
    extraProps: { cardKey: 'latency' }
  },
  {
    id: 'stat-tokens',
    title: '总 Tokens',
    icon: LayersIcon,
    component: UsageStatCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'cell',
    extraProps: { cardKey: 'tokens' }
  },
  {
    id: 'trend',
    title: '请求与用量趋势',
    icon: ChartComboIcon,
    component: UsageTrendCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'full'
  },
  {
    id: 'provider-trend',
    title: '供应商 Tokens 趋势',
    icon: ChartLineIcon,
    component: UsageProviderTrendCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'full'
  },
  {
    id: 'activity',
    title: '活跃度',
    icon: CalendarIcon,
    component: UsageActivityCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'full'
  },
  {
    id: 'composition',
    title: '令牌构成',
    icon: ChartPieIcon,
    component: UsageCompositionCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'full'
  },
  {
    id: 'ratio-success',
    title: '成功率环形',
    icon: ChartRingIcon,
    component: UsageSuccessRatioCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'half'
  },
  {
    id: 'ratio-cache',
    title: '缓存占比环形',
    icon: ChartRingIcon,
    component: UsageCacheRatioCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'half'
  },
  {
    id: 'provider-bar',
    title: '供应商 Tokens',
    icon: ChartBarIcon,
    component: UsageProviderBarCard,
    surfaces: [...BOTH_SURFACES],
    defaultVisible: true,
    span: 'full'
  },
  {
    id: 'clients',
    title: '来源 Agent 请求数（近七天）',
    icon: ChartBarIcon,
    component: UsageClientCard,
    surfaces: ['home'],
    defaultVisible: true,
    span: 'full'
  },
  {
    id: 'agent-provider-flow',
    title: 'Agent 与提供商流向（近七天）',
    icon: FlowchartIcon,
    component: UsageSankeyCard,
    surfaces: ['home'],
    defaultVisible: true,
    span: 'full'
  },
  {
    id: 'speed',
    title: '模型速度趋势（近七天）',
    icon: TimeIcon,
    component: UsageSpeedCard,
    surfaces: ['home'],
    defaultVisible: true,
    span: 'full'
  }
]
