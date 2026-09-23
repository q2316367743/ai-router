<template>
  <div class="quota-panel">
    <!-- 顶部行：更新时间 + 手动全量刷新（与统计看板的维度行同一高度，视觉对齐） -->
    <div class="quota-panel__head">
      <span class="quota-panel__updated">{{ updatedText }}</span>
      <t-button
        variant="text"
        shape="square"
        size="small"
        title="刷新额度"
        :loading="refreshing"
        @click="refresh"
      >
        <template #icon><t-icon name="refresh" /></template>
      </t-button>
    </div>

    <t-loading :loading="loading" :show-overlay="false" :delay="200" size="small">
      <div v-if="items.length === 0" class="quota-panel__empty">{{ emptyHint }}</div>
      <!-- 每提供商整行一张卡：卡内逐行列出该提供商的全部限额窗口（opencode 3 行、zai 3 行…） -->
      <div v-else class="flex flex-col gap-10px">
        <TrayQuotaCard
          v-for="item in items"
          :key="item.providerId"
          :item="item"
          :threshold="threshold"
        />
      </div>
    </t-loading>
  </div>
</template>

<script lang="ts" setup>
/**
 * 托盘额度面板：按设置页「托盘额度」配置的顺序与开关渲染各提供商的余量快照。
 *
 * - 数据来自 quota.list()（读库不出站），首次挂载、面板每次弹出（tray:shown）以及**每分钟轮询**各读一次，
 *   从未查到结果的项由 useQuotaList 补查一轮；
 * - 顶部「更新于」取展示项里最旧的一条（最保守口径），逐卡的更新时间在卡片提示气泡里；
 * - 停用的提供商不参与余量查询（快照会变陈），一律不展示。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ProviderQuotaInfo } from '@common/types'
import {
  resolveTrayQuotaItems,
  trayQuotaThreshold,
  useQuotaList,
  useTrayQuotaConfig
} from '@/hooks/useTrayQuota'
import { relativeTime } from '@/utils/format'
import { MessageUtil } from '@/utils/modal'
import TrayQuotaCard from './TrayQuotaCard.vue'

/** 快照轮询周期：与后台的 10 分钟刷新错开，看板的跟读粒度按分钟足够 */
const QUOTA_POLL_MS = 60_000

useTrayQuotaConfig()

const { list, loading, refreshing, load, refreshAll } = useQuotaList()

/** 绑定了余量策略且处于启用态的提供商（quota:list 已过滤未绑定与已归档） */
const boundItems = computed(() => list.value.filter((item) => item.enabled))

/** 展示序列：配置顺序 × 当前提供商，隐藏项与停用项剔除 */
const items = computed<ProviderQuotaInfo[]>(() => {
  const byId = new Map(boundItems.value.map((item) => [item.providerId, item]))
  return resolveTrayQuotaItems(boundItems.value)
    .filter((entry) => entry.visible)
    .map((entry) => byId.get(entry.providerId))
    .filter((item): item is ProviderQuotaInfo => item !== undefined)
})

const threshold = computed(() => trayQuotaThreshold())

/** 每分钟走一次的时钟基准：驱动「更新于 X 分钟前」的文案重算（与下面的轮询同一个定时器） */
const now = ref(Date.now())

const updatedText = computed(() => {
  const times = items.value.map((item) => item.queriedAt).filter((at): at is number => at !== null)
  return times.length === 0
    ? '等待首次查询'
    : `更新于 ${relativeTime(Math.min(...times), now.value)}`
})

/**
 * 每分钟重读一次快照：余量由后台调度每 10 分钟刷一轮，而面板可能一直开着不动 ——
 * 轮询既跟上后台刷新（`quota:list` 是读库、不出站），也让顶部时间文案不会停住。
 * 面板每次弹出还会各重读一次（tray:shown），窗口隐藏时 Electron 会自行节流定时器。
 */
useIntervalFn(() => {
  now.value = Date.now()
  void load()
}, QUOTA_POLL_MS)

const emptyHint = computed(() =>
  list.value.length === 0
    ? '还没有绑定余量策略的提供商，可在主窗口「余量」页查看策略目录'
    : '暂无可展示的额度，可在主窗口设置页「托盘额度」中开启'
)

async function refresh(): Promise<void> {
  try {
    await refreshAll()
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '刷新失败')
  }
}

/** 主进程每次弹出面板时推送 tray:shown，据此重读（隐藏期间快照可能已更新） */
let unsubscribe: (() => void) | null = null

onMounted(() => {
  void load()
  unsubscribe = window.preload.tray.onShown(() => void load())
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<style scoped lang="less">
.quota-panel {
  color: var(--td-text-color-primary);
}

.quota-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.quota-panel__updated {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.quota-panel__empty {
  padding: 32px 0;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  color: var(--td-text-color-placeholder);
}
</style>
