<template>
  <div ref="host" class="echart-host" :style="{ height: `${height}px` }"></div>
</template>

<script lang="ts" setup>
/**
 * echarts 容器：负责 init / setOption / resize / dispose 与主题响应重绘。
 * 业务侧只传 option；palette 变化（深浅色切换）时自动重新 setOption 以应用新色值。
 */
import { onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { echarts, type EChartsOption } from './echarts'

const props = defineProps<{
  option: EChartsOption
  height?: number
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null

function render(): void {
  if (!chart) return
  // notMerge: 主题切换时旧 option 的色值必须整体替换，否则残留旧配色
  chart.setOption(props.option, true)
}

onMounted(() => {
  if (!host.value) return
  chart = echarts.init(host.value)
  render()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(host.value)
})

watch(() => props.option, render, { deep: true })

// keep-alive 页面切回来时容器刚重新插入 DOM，补一次测量（ResizeObserver 不保证此时回调）
onActivated(() => chart?.resize())

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped lang="less">
.echart-host {
  width: 100%;
}
</style>
