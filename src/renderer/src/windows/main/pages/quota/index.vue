<template>
  <PageLayout title="余量">
    <template #extra>
      <div class="flex items-center gap-8px">
        <t-button @click="openCatalog">
          <template #icon><t-icon name="view-module" /></template>
          策略目录
        </t-button>
        <t-button :loading="refreshingAll" @click="refreshAll">
          <template #icon><t-icon name="refresh" /></template>
          刷新全部
        </t-button>
      </div>
    </template>

    <div class="p-24px">
      <div v-if="loading" class="flex justify-center py-80px">
        <t-loading text="加载中" loading />
      </div>

      <t-empty v-else-if="list.length === 0" title="还没有可查询的提供商" class="mt-15vh">
        <template #description>
          <div class="text-13px text-td-secondary">
            在提供商编辑抽屉中选择「余量策略」后，这里会展示各限流窗口的剩余额度。
          </div>
        </template>
        <template #action>
          <div class="flex gap-8px justify-center">
            <t-button variant="outline" @click="goProviders">去配置提供商</t-button>
            <t-button @click="openCatalog">查看策略目录</t-button>
          </div>
        </template>
      </t-empty>

      <div v-else class="flex flex-wrap gap-16px">
        <QuotaCard
          v-for="item in list"
          :key="item.providerId"
          :item="item"
          :refreshing="refreshingIds.includes(item.providerId)"
          @refresh="refreshOne"
        />
      </div>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import type { ProviderQuotaInfo } from '@common/types'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { MessageUtil } from '@/utils/modal'
import QuotaCard from './components/QuotaCard.vue'
import { openStrategyCatalogDialog } from './modals/StrategyCatalogDialog'
import { useRouter } from 'vue-router'

const router = useRouter()

const list = ref<ProviderQuotaInfo[]>([])
const loading = ref(false)
const refreshingAll = ref(false)
/** 正在单卡刷新的 providerId 集合（页面打开的自动补查会逐卡触发，不能用单值） */
const refreshingIds = ref<string[]>([])

async function refresh(): Promise<void> {
  loading.value = list.value.length === 0
  try {
    list.value = await window.preload.quota.list()
  } finally {
    loading.value = false
  }
  // 页面打开即补查：调度器 10 分钟一轮、启动首刷又可能早于本次查看，
  // 「从未查到结果」的项（停用的不参与查询）立刻逐卡补一轮，避免一直停在「等待首次查询」
  const pending = list.value.filter((item) => item.queriedAt === null && item.enabled)
  for (const item of pending) {
    await refreshOne(item.providerId)
  }
}

/** 全量出站刷新（定时任务兜底之外的手动触发），完成后用返回的列表整面替换 */
async function refreshAll(): Promise<void> {
  refreshingAll.value = true
  try {
    list.value = await window.preload.quota.refresh()
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '刷新失败')
  } finally {
    refreshingAll.value = false
  }
}

async function refreshOne(providerId: string): Promise<void> {
  if (refreshingIds.value.includes(providerId)) return
  refreshingIds.value = [...refreshingIds.value, providerId]
  try {
    list.value = await window.preload.quota.refresh(providerId)
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '刷新失败')
  } finally {
    refreshingIds.value = refreshingIds.value.filter((id) => id !== providerId)
  }
}

function openCatalog(): void {
  openStrategyCatalogDialog(refresh)
}

function goProviders(): void {
  void router.push('/providers')
}

onMounted(() => {
  void refresh()
})
</script>
