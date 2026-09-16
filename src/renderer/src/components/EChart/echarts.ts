/**
 * echarts 按需注册入口：只引入看板用到的图表与组件，避免整包体积。
 *
 * 新增图表类型时在此追加 use()，业务侧统一从本文件（或 EChart.vue）引入，不直接引 'echarts'。
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer
])

export type { EChartsOption } from 'echarts'
export { echarts }
