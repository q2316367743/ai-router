/**
 * 看板图表 option 构造（二）：日历热力图与桑基图。
 *
 * 与 `options.ts` 分离以满足 RL-05 的单文件行数约束；两者都是纯函数、入参 palettes + 数据。
 * 业务侧（卡片组件）只负责取数与摆放，不在此处判断业务好坏。
 */
import type { EChartsOption } from './echarts'
import type { ChartPalette } from './tokens'
import type { UsageActivity, UsageAgentFlowLink } from '@common/types'
import { formatTokens } from '@/utils/format'

/**
 * 活跃度日历热力图：按日的请求数映射到 brand 色阶（visualMap inRange），tooltip 补 token 明细。
 *
 * 排布交给 echarts calendar（列=周、行=星期、带月/日标签）；`cellSize: ['auto', h]` 让格子
 * 宽度自适应卡片宽度（首页整年 / 托盘 12 周切片都能铺满）。无请求的日期不落在 series 里，
 * 显示 calendar 的空白底（`palette.heatEmpty`），与原有「无请求 = 空色」语义一致。
 */
export function buildCalendarHeatmapOption(
  palette: ChartPalette,
  activity: UsageActivity,
  cellHeight = 12
): EChartsOption | null {
  const cells = activity.cells
  if (cells.length === 0) return null
  const endDate = cells[cells.length - 1]?.date ?? activity.startDate
  const tokenByDate = new Map(cells.map((cell) => [cell.date, cell.totalTokens]))
  const maxRequests = cells.reduce((acc, cell) => Math.max(acc, cell.requestCount), 0)
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: palette.container,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontSize: 12 },
      formatter: (params) => {
        const p = params as { value?: [string, number] }
        const date = p.value?.[0] ?? ''
        const count = p.value?.[1] ?? 0
        return `${date}<br/>${count} 次 · ${formatTokens(tokenByDate.get(date) ?? 0)}`
      }
    },
    visualMap: {
      type: 'piecewise',
      min: 0,
      max: Math.max(maxRequests, 1),
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 10,
      textStyle: { color: palette.placeholder, fontSize: 10 },
      inRange: { color: palette.heat }
    },
    calendar: {
      top: 24,
      left: 28,
      right: 8,
      bottom: 40,
      cellSize: ['auto', cellHeight],
      range: [activity.startDate, endDate],
      orient: 'horizontal',
      splitLine: { show: false },
      itemStyle: { color: palette.heatEmpty, borderWidth: 2, borderColor: palette.container },
      dayLabel: {
        color: palette.placeholder,
        fontSize: 10,
        nameMap: ['日', '一', '二', '三', '四', '五', '六']
      },
      monthLabel: { color: palette.placeholder, fontSize: 10 },
      yearLabel: { show: false }
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: cells.map((cell) => [cell.date, cell.requestCount]),
        itemStyle: { borderWidth: 2, borderColor: palette.container, borderRadius: 2 }
      }
    ]
  }
}

/** 桑基图中间节点展示名（本地路由服务） */
const SANKEY_ROUTER_LABEL = 'AI Router'
const SANKEY_ROUTER_KEY = 'router'
const SANKEY_AGENT_PREFIX = 'A::'
const SANKEY_PROVIDER_PREFIX = 'P::'
/** 超出 Top N 的来源 / 提供商归入该节点 */
const SANKEY_OTHER = '其他'

/** 对 links 按指定字段汇总，返回「名称 → 请求数」 */
function sumByField(
  links: UsageAgentFlowLink[],
  field: 'client' | 'providerName'
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const link of links) {
    totals.set(link[field], (totals.get(link[field]) ?? 0) + link.requestCount)
  }
  return totals
}

/** 取汇总值前 N 的名称集合（并列按字典序稳定） */
function topNames(totals: Map<string, number>, limit: number): Set<string> {
  return new Set(
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name]) => name)
  )
}

/** 节点标签字号 */
const SANKEY_LABEL_FONT_SIZE = 11

/**
 * Agent → AI Router → 提供商 三段式桑基图（首页专属）。
 *
 * 左侧来源取前 `agentLimit` 名 + 「其他」，右侧提供商取前 `providerLimit` 名 + 「其他」，
 * 其余流量合并，避免节点过多糊成一团。节点内部名加前缀，防止来源与提供商同名被 echarts
 * 合并；`label.formatter` 再把前缀去掉显示净名。中间节点即本地路由服务。
 *
 * 权重是请求数（含失败），与「来源 Agent 请求数」同口径。
 */
export function buildAgentProviderSankeyOption(
  palette: ChartPalette,
  links: UsageAgentFlowLink[],
  agentLimit = 6,
  providerLimit = 6
): EChartsOption | null {
  if (links.length === 0) return null

  const topAgents = topNames(sumByField(links, 'client'), agentLimit)
  const topProviders = topNames(sumByField(links, 'providerName'), providerLimit)
  const agentOf = (name: string): string => (topAgents.has(name) ? name : SANKEY_OTHER)
  const providerOf = (name: string): string => (topProviders.has(name) ? name : SANKEY_OTHER)

  // 归并到「桶」后再按 (agent, provider) 合并同一条边
  const edges = new Map<string, { agent: string; provider: string; value: number }>()
  for (const link of links) {
    const agent = agentOf(link.client)
    const provider = providerOf(link.providerName)
    const key = `${agent}\u0000${provider}`
    const edge = edges.get(key)
    if (edge) edge.value += link.requestCount
    else edges.set(key, { agent, provider, value: link.requestCount })
  }

  const agentNames = [...new Set([...edges.values()].map((edge) => edge.agent))]
  const providerNames = [...new Set([...edges.values()].map((edge) => edge.provider))]

  /** 内部名 → 展示净名（label / tooltip 用） */
  const display = new Map<string, string>()
  const agentColor = new Map<string, string>()
  agentNames.forEach((name, i) => {
    const key = `${SANKEY_AGENT_PREFIX}${name}`
    display.set(key, name)
    agentColor.set(key, palette.series[i % palette.series.length] as string)
  })
  display.set(SANKEY_ROUTER_KEY, SANKEY_ROUTER_LABEL)
  const providerColor = new Map<string, string>()
  providerNames.forEach((name, i) => {
    const key = `${SANKEY_PROVIDER_PREFIX}${name}`
    display.set(key, name)
    providerColor.set(key, palette.series[(i + 3) % palette.series.length] as string)
  })

  const nodes = [
    ...agentNames.map((name) => {
      const key = `${SANKEY_AGENT_PREFIX}${name}`
      return { name: key, itemStyle: { color: agentColor.get(key) } }
    }),
    { name: SANKEY_ROUTER_KEY, itemStyle: { color: palette.brand } },
    ...providerNames.map((name) => {
      const key = `${SANKEY_PROVIDER_PREFIX}${name}`
      return {
        name: key,
        itemStyle: { color: providerColor.get(key) },
        // 右列标签放到节点左侧（图表内部），避免超出卡片被裁断
        label: { position: 'left' as const }
      }
    })
  ]

  const agentTotals = new Map<string, number>()
  const providerTotals = new Map<string, number>()
  for (const edge of edges.values()) {
    agentTotals.set(edge.agent, (agentTotals.get(edge.agent) ?? 0) + edge.value)
    providerTotals.set(edge.provider, (providerTotals.get(edge.provider) ?? 0) + edge.value)
  }

  const seriesLinks = [
    ...[...agentTotals.entries()].map(([name, value]) => ({
      source: `${SANKEY_AGENT_PREFIX}${name}`,
      target: SANKEY_ROUTER_KEY,
      value
    })),
    ...[...providerTotals.entries()].map(([name, value]) => ({
      source: SANKEY_ROUTER_KEY,
      target: `${SANKEY_PROVIDER_PREFIX}${name}`,
      value
    }))
  ]

  const nameOf = (key: string | undefined): string => (key ? (display.get(key) ?? key) : '')

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: palette.container,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontSize: 12 },
      formatter: (params) => {
        const p = params as {
          dataType?: string
          data?: { name?: string; source?: string; target?: string; value?: number }
        }
        if (p.dataType === 'edge' && p.data) {
          return `${nameOf(p.data.source)} → ${nameOf(p.data.target)}<br/>${formatTokens(p.data.value ?? 0)} 次`
        }
        return nameOf(p.data?.name)
      }
    },
    series: [
      {
        type: 'sankey',
        left: 8,
        right: 8,
        top: 12,
        bottom: 12,
        nodeWidth: 14,
        nodeGap: 8,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
        label: {
          show: true,
          fontSize: SANKEY_LABEL_FONT_SIZE,
          color: palette.text,
          formatter: (params) => nameOf((params as { name?: string }).name)
        },
        data: nodes,
        links: seriesLinks
      }
    ]
  }
}
