/**
 * 看板图表 option 构造：纯函数，入参 palettes + 数据，出参 echarts option。
 * 与 Vue 组件分离（RL-05 行数约束），业务侧只负责取数与摆放。
 */
import type { EChartsOption } from './echarts'
import type { ChartPalette } from './tokens'
import type { UsageSeriesLine, UsageSpeedLine } from '@common/types'
import { formatTokens } from '@/utils/format'

const AXIS_LABEL_FONT_SIZE = 10

/** 统一的坐标轴 / tooltip 基线样式，避免各图表重复配置 */
function baseAxis(palette: ChartPalette) {
  return {
    axisLine: { lineStyle: { color: palette.border } },
    axisTick: { show: false },
    axisLabel: { color: palette.placeholder, fontSize: AXIS_LABEL_FONT_SIZE },
    splitLine: { lineStyle: { color: palette.border, type: 'dashed' as const } }
  }
}

function baseTooltip(palette: ChartPalette) {
  return {
    trigger: 'axis' as const,
    backgroundColor: palette.container,
    borderColor: palette.border,
    textStyle: { color: palette.text, fontSize: 12 },
    axisPointer: { type: 'shadow' as const }
  }
}

/** 柱状（请求数）+ 折线（总 token / 缓存 token）组合图 */
export function buildRequestTokenOption(
  palette: ChartPalette,
  labels: string[],
  requestCount: number[],
  totalTokens: number[],
  cacheTokens: number[]
): EChartsOption {
  const axis = baseAxis(palette)
  return {
    grid: { left: 8, right: 8, top: 36, bottom: 0, containLabel: true },
    tooltip: {
      ...baseTooltip(palette),
      valueFormatter: (value) => formatTokens(Number(value))
    },
    legend: {
      top: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.textSecondary, fontSize: 11 },
      data: ['请求数', '总 Tokens', '缓存 Tokens']
    },
    xAxis: { type: 'category', data: labels, boundaryGap: true, ...axis },
    yAxis: [
      {
        type: 'value',
        name: '请求数',
        nameTextStyle: { color: palette.placeholder, fontSize: 10 },
        ...axis
      },
      {
        type: 'value',
        name: 'Tokens',
        nameTextStyle: { color: palette.placeholder, fontSize: 10 },
        ...axis,
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '请求数',
        type: 'bar',
        yAxisIndex: 0,
        data: requestCount,
        barMaxWidth: 14,
        itemStyle: { color: palette.brand, borderRadius: [3, 3, 0, 0] }
      },
      {
        name: '总 Tokens',
        type: 'line',
        yAxisIndex: 1,
        data: totalTokens,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: palette.success },
        itemStyle: { color: palette.success }
      },
      {
        name: '缓存 Tokens',
        type: 'line',
        yAxisIndex: 1,
        data: cacheTokens,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: palette.warning, type: 'dashed' },
        itemStyle: { color: palette.warning }
      }
    ]
  }
}

/** 环形指标：两段占比（如 成功 / 失败、缓存 / 非缓存），中心显示主占比 */
export function buildRatioDonutOption(
  palette: ChartPalette,
  primaryLabel: string,
  primaryValue: number,
  secondaryLabel: string,
  secondaryValue: number,
  primaryColor: string
): EChartsOption {
  const total = primaryValue + secondaryValue
  const ratio = total > 0 ? (primaryValue / total) * 100 : 0
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: palette.container,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontSize: 12 },
      valueFormatter: (value) => formatTokens(Number(value))
    },
    legend: {
      bottom: 0,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: palette.textSecondary, fontSize: 11 }
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: false,
        label: {
          show: true,
          position: 'center',
          formatter: () => `${ratio.toFixed(1)}%`,
          fontSize: 16,
          fontWeight: 600,
          color: palette.text
        },
        emphasis: { label: { show: true } },
        labelLine: { show: false },
        data: [
          { name: primaryLabel, value: primaryValue, itemStyle: { color: primaryColor } },
          {
            name: secondaryLabel,
            value: secondaryValue,
            itemStyle: { color: palette.border }
          }
        ]
      }
    ]
  }
}

/** 令牌构成环形图（四维：输入 / 输出 / 缓存 / 无法统计），中心显示总量 */
export function buildCompositionDonutOption(
  palette: ChartPalette,
  items: Array<{ name: string; value: number; color: string }>
): EChartsOption {
  const total = items.reduce((acc, item) => acc + item.value, 0)
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: palette.container,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontSize: 12 },
      formatter: (params) => {
        const p = params as { name: string; value: number; percent?: number }
        return `${p.name}<br/>${formatTokens(p.value)} (${(p.percent ?? 0).toFixed(1)}%)`
      }
    },
    legend: {
      bottom: 0,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: palette.textSecondary, fontSize: 11 }
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: false,
        label: {
          show: true,
          position: 'center',
          formatter: () => formatTokens(total),
          fontSize: 14,
          fontWeight: 600,
          color: palette.text
        },
        labelLine: { show: false },
        data: items.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: { color: item.color }
        }))
      }
    ]
  }
}

/**
 * 按供应商分线的总 token 趋势折线（托盘面板用）。
 * 供应商数超出上限时只保留 token 最高的若干条，避免图例挤爆窄面板。
 */
export function buildProviderTrendOption(
  palette: ChartPalette,
  labels: string[],
  lines: UsageSeriesLine[],
  maxLines = 5
): EChartsOption {
  const axis = baseAxis(palette)
  const shown = lines.slice(0, maxLines)
  return {
    grid: { left: 8, right: 8, top: 32, bottom: 0, containLabel: true },
    tooltip: {
      ...baseTooltip(palette),
      valueFormatter: (value) => formatTokens(Number(value))
    },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.textSecondary, fontSize: 10 },
      data: shown.map((line) => line.name)
    },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axis },
    yAxis: { type: 'value', ...axis },
    series: shown.map((line, i) => ({
      name: line.name,
      type: 'line' as const,
      data: line.data,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: palette.series[i % palette.series.length] },
      itemStyle: { color: palette.series[i % palette.series.length] }
    }))
  }
}

/**
 * 模型速度折线（按「供应商 · 模型」分线，单位 token/s）。
 *
 * 只有 7 个数据点且缺失日为 null，故显式显示数据点并禁止跨空连线，
 * 避免把「当日无有效请求」误读成「速度为 0」。图例名较长，用滚动图例防止换行挤压绘图区。
 */
export function buildModelSpeedOption(
  palette: ChartPalette,
  labels: string[],
  lines: UsageSpeedLine[]
): EChartsOption {
  const axis = baseAxis(palette)
  return {
    grid: { left: 8, right: 8, top: 32, bottom: 0, containLabel: true },
    tooltip: {
      ...baseTooltip(palette),
      valueFormatter: (value) => (value == null ? '—' : `${Number(value).toFixed(1)} tok/s`)
    },
    legend: {
      type: 'scroll',
      top: 0,
      left: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.textSecondary, fontSize: 10 },
      data: lines.map((line) => line.name)
    },
    xAxis: { type: 'category', data: labels, boundaryGap: false, ...axis },
    yAxis: {
      type: 'value',
      name: 'tok/s',
      nameTextStyle: { color: palette.placeholder, fontSize: 10 },
      ...axis
    },
    series: lines.map((line, i) => ({
      name: line.name,
      type: 'line' as const,
      data: line.data,
      smooth: true,
      showSymbol: true,
      symbolSize: 6,
      connectNulls: false,
      lineStyle: { width: 2, color: palette.series[i % palette.series.length] },
      itemStyle: { color: palette.series[i % palette.series.length] }
    }))
  }
}

/** Top 维度横向条形图（供应商 Tokens / 来源 Agent 请求数共用；超出部分归入「其他」由调用方处理） */
export function buildTopBarOption(
  palette: ChartPalette,
  names: string[],
  values: number[]
): EChartsOption {
  const axis = baseAxis(palette)
  return {
    grid: { left: 8, right: 40, top: 8, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: palette.container,
      borderColor: palette.border,
      textStyle: { color: palette.text, fontSize: 12 },
      valueFormatter: (value) => formatTokens(Number(value))
    },
    xAxis: { type: 'value', ...axis },
    yAxis: {
      type: 'category',
      data: names,
      inverse: true,
      ...axis,
      splitLine: { show: false },
      axisLabel: { color: palette.textSecondary, fontSize: 11 }
    },
    series: [
      {
        type: 'bar',
        data: values,
        barMaxWidth: 16,
        itemStyle: { color: palette.brand, borderRadius: [0, 3, 3, 0] },
        label: {
          show: true,
          position: 'right',
          formatter: (params) => formatTokens(Number(params.value)),
          color: palette.textSecondary,
          fontSize: 10
        }
      }
    ]
  }
}
