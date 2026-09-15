<template>
  <div class="home h-full flex flex-col items-center justify-center bg-td-container">
    <h1 class="text-24px font-600 text-td-primary m-0">AI Router</h1>
    <p class="text-14px text-td-secondary m-t-8px">
      工程骨架就绪：TDesign + UnoCSS + Pinia + Vue Router + SQLite（drizzle）
    </p>

    <div class="flex items-center gap-12px m-t-24px">
      <t-button theme="primary" variant="outline" @click="appStore.toggleTheme()">
        切换深浅色
      </t-button>
      <t-button theme="primary" @click="checkDb">探活数据库</t-button>
      <t-tag v-if="dbStatus !== null" :theme="dbStatus ? 'success' : 'danger'">
        {{ dbStatus ? '连接正常（SELECT 1）' : '连接失败' }}
      </t-tag>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useAppStore } from '@/windows/main/store/app'

const appStore = useAppStore()

const dbStatus = ref<boolean | null>(null)

const checkDb = async (): Promise<void> => {
  try {
    dbStatus.value = await window.preload.db.ping()
  } catch {
    dbStatus.value = false
  }
}
</script>
