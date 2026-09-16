/**
 * 图表配色：echarts 绘制在 canvas 上，无法解析 CSS 变量，必须读取计算后的实际色值。
 *
 * 颜色全部取自 tdesign / fluent token（不在业务侧写裸色值）；主题切换时
 * 由 useChartPalette() 依赖 isDark 重新读取，配合 EChart.vue 重新 setOption 生效。
 */
import { computed, type ComputedRef } from 'vue'
import { useColorMode } from '@/hooks/colorMode'

/** 图表调色板：语义色 + 供应商分线序列色 */
export interface ChartPalette {
  text: string
  textSecondary: string
  placeholder: string
  border: string
  container: string
  brand: string
  success: string
  warning: string
  error: string
  /** 供应商 / 构成分线循环色（取自 tdesign brand 色阶，保证深浅色下都可辨） */
  series: string[]
}

function readVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function readPalette(): ChartPalette {
  return {
    text: readVar('--td-text-color-primary', '#000000'),
    textSecondary: readVar('--td-text-color-secondary', '#666666'),
    placeholder: readVar('--td-text-color-placeholder', '#999999'),
    border: readVar('--td-border-level-1-color', '#e0e0e0'),
    container: readVar('--td-bg-color-container', '#ffffff'),
    brand: readVar('--td-brand-color', '#0078d4'),
    success: readVar('--td-success-color', '#2ba471'),
    warning: readVar('--td-warning-color', '#e37318'),
    error: readVar('--td-error-color', '#d54941'),
    series: [
      readVar('--td-brand-color-7', '#0078d4'),
      readVar('--td-success-color-5', '#2ba471'),
      readVar('--td-warning-color-5', '#e37318'),
      readVar('--td-error-color-5', '#d54941'),
      readVar('--td-brand-color-4', '#4da3ea'),
      readVar('--td-success-color-3', '#7fd4a8'),
      readVar('--td-warning-color-3', '#f0b268'),
      readVar('--td-brand-color-9', '#005a9e')
    ]
  }
}

/** 响应主题变化的调色板（isDark 变化时重新读取 token） */
export function useChartPalette(): ComputedRef<ChartPalette> {
  const { isDark } = useColorMode()
  return computed(() => {
    void isDark.value
    return readPalette()
  })
}
