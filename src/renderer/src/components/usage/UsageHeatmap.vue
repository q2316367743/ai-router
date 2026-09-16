<template>
  <div class="heat-wrap">
    <!-- 热力矩阵：列为周，行为星期（GitHub 提交图排布）；列宽自适应铺满卡片 -->
    <div class="heat-grid">
      <div class="weekday-column">
        <span v-for="(label, i) in weekdayLabels" :key="i" class="weekday-label">{{ label }}</span>
      </div>
      <t-tooltip v-for="(week, wi) in weeks" :key="wi" :disabled="week.lines.length === 0">
        <div class="week-column">
          <span
            v-for="(cell, ci) in week.cells"
            :key="cell?.date ?? `pad-${ci}`"
            class="heat-cell"
            :style="{ background: cell?.color ?? 'transparent' }"
          ></span>
        </div>
        <template #content>
          <div v-for="line in week.lines" :key="line" class="text-11px">{{ line }}</div>
        </template>
      </t-tooltip>
    </div>

    <div class="flex items-center justify-end gap-4px mt-10px">
      <span class="text-11px text-td-placeholder">少</span>
      <span
        v-for="(color, i) in legendColors"
        :key="i"
        class="legend-cell"
        :style="{ background: color }"
      ></span>
      <span class="text-11px text-td-placeholder">多</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 活跃度热力矩阵（GitHub 提交图式排布），从 UsageActivityCard 拆出以控制单文件行数。
 *
 * 排布：7 行（周日→周六）× N 列（周），首列与末列可能不满，用占位空格补齐。
 * 配色：按请求数分五档，全部取自 tdesign token（无裸色值），深浅色自动跟随。
 *
 * 这里的档位是「热度」分档（把请求数映射到 5 级色阶），与 useUsageStats 的好坏/量级档
 * 是两回事，故阈值留在本组件内。
 */
import { computed } from 'vue'
import type { UsageActivity } from '@common/types'
import { formatTokens } from '@/utils/format'

const props = defineProps<{ activity: UsageActivity }>()

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
/** 日历首日：与 GitHub 一致从周日起排 */
const WEEK_START = 0
const DAYS_PER_WEEK = 7
/** 热度分档阈值（按请求数）：1-2 / 3-5 / 6-10 / 11+ */
const LEVEL_THRESHOLDS = [3, 6, 11]

interface HeatCell {
  date: string
  color: string
  level: number
}

interface HeatWeek {
  cells: Array<HeatCell | null>
  /** 该周逐日明细（tooltip 逐行展示），空数组表示该周无数据 */
  lines: string[]
}

const weekdayLabels = computed(() => {
  const ordered: string[] = []
  for (let i = 0; i < DAYS_PER_WEEK; i += 1) {
    ordered.push(WEEKDAY_LABELS[(WEEK_START + i) % DAYS_PER_WEEK] as string)
  }
  return ordered
})

/** 请求数 → 热度档位（0 档为无请求的空色） */
function levelOf(requestCount: number): number {
  if (requestCount <= 0) return 0
  let level = 1
  for (const threshold of LEVEL_THRESHOLDS) {
    if (requestCount >= threshold) level += 1
  }
  return level
}

const levelColors = computed(() => [
  'var(--td-bg-color-component)',
  'var(--td-brand-color-2)',
  'var(--td-brand-color-4)',
  'var(--td-brand-color-6)',
  'var(--td-brand-color-8)'
])

const legendColors = computed(() => levelColors.value.slice(1))

const weeks = computed<HeatWeek[]>(() => {
  const cells = props.activity.cells
  if (cells.length === 0) return []

  const result: HeatWeek[] = []
  let current: Array<HeatCell | null> = []
  const firstWeekday = new Date(`${cells[0]?.date}T00:00:00`).getDay()
  const leadingPad = (firstWeekday - WEEK_START + DAYS_PER_WEEK) % DAYS_PER_WEEK
  for (let i = 0; i < leadingPad; i += 1) current.push(null)

  for (const cell of cells) {
    const level = levelOf(cell.requestCount)
    current.push({
      date: cell.date,
      level,
      color: levelColors.value[level] as string
    })
    if (current.length === DAYS_PER_WEEK) {
      result.push({ cells: current, lines: weekLines(current) })
      current = []
    }
  }
  if (current.length > 0) {
    while (current.length < DAYS_PER_WEEK) current.push(null)
    result.push({ cells: current, lines: weekLines(current) })
  }
  return result
})

/** 每周 tooltip 明细：该周有数据的日子逐行列出 */
function weekLines(cells: Array<HeatCell | null>): string[] {
  return cells
    .filter((cell): cell is HeatCell => cell !== null)
    .map((cell) => {
      const item = props.activity.cells.find((c) => c.date === cell.date)
      const count = item?.requestCount ?? 0
      const tokens = formatTokens(item?.totalTokens ?? 0)
      return `${cell.date.slice(5)} · ${count} 次 · ${tokens}`
    })
}
</script>

<style scoped lang="less">
/**
 * 矩阵横向铺满卡片：week-column 用 flex:1 分摊宽度并限高 40px
 * （宽卡片下格子变大更好点，窄托盘面板下自动收窄不溢出）。
 */
.heat-grid {
  display: flex;
  gap: 3px;
}

.weekday-column {
  display: grid;
  grid-template-rows: repeat(7, 1fr);
  gap: 3px;
  flex-shrink: 0;
  margin-right: 3px;
}

.weekday-label {
  font-size: 9px;
  line-height: 12px;
  color: var(--td-text-color-placeholder);
}

.week-column {
  display: grid;
  grid-template-rows: repeat(7, 1fr);
  gap: 3px;
  flex: 1;
  max-width: 40px;
  min-width: 0;
}

.heat-cell {
  width: 100%;
  height: 12px;
  border-radius: 2px;
}

.legend-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
</style>
