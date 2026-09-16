<template>
  <PageLayout title="设置">
    <div class="p-24px max-w-760px">
      <!-- 外观 -->
      <div class="card">
        <div class="font-500">外观</div>
        <div class="text-13px text-td-secondary mt-4px mb-12px">
          界面色彩模式，「跟随系统」将实时响应系统深浅色变化
        </div>
        <t-radio-group :value="mode" variant="default-filled" @change="onModeChange">
          <t-radio-button value="system">跟随系统</t-radio-button>
          <t-radio-button value="light">浅色</t-radio-button>
          <t-radio-button value="dark">深色</t-radio-button>
        </t-radio-group>
      </div>
    </div>
  </PageLayout>
</template>

<script lang="ts" setup>
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import { useColorMode } from '@/hooks/colorMode'

const { mode, setColorMode } = useColorMode()

function onModeChange(value: unknown): void {
  if (value === 'system' || value === 'light' || value === 'dark') {
    setColorMode(value)
  }
}
</script>

<style lang="less" scoped>
.card {
  padding: 16px;
  border-radius: var(--fluent-radius-card);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--fluent-border-subtle);
}
</style>
