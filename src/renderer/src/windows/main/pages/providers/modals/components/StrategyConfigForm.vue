<template>
  <t-form-item v-for="item in settings" :key="item.key" :label="item.title">
    <!-- select：options 存在即按枚举渲染（clearable，清空 = 不写该键） -->
    <t-select
      v-if="selectOptions(item).length"
      :value="config[item.key] ?? ''"
      clearable
      :placeholder="item.placeholder ?? '不设置'"
      @change="(value: unknown) => onSelectChange(item.key, value)"
    >
      <t-option v-for="opt in selectOptions(item)" :key="opt.value" :value="opt.value" :label="opt.label" />
    </t-select>
    <t-textarea
      v-else-if="item.widget === 'textarea'"
      v-model="config[item.key]"
      :autosize="{ minRows: 3, maxRows: 6 }"
      :placeholder="item.placeholder"
    />
    <t-input
      v-else
      v-model="config[item.key]"
      :type="isSecure(item) && !revealed[item.key] ? 'password' : 'text'"
      :placeholder="item.placeholder"
    >
      <template v-if="isSecure(item)" #suffix-icon>
        <t-icon
          :name="revealed[item.key] ? 'browse' : 'browse-off'"
          class="cursor-pointer"
          @click="revealed[item.key] = !revealed[item.key]"
        />
      </template>
    </t-input>
    <template #help>
      <span v-if="item.hint" class="text-12px text-td-secondary">{{ item.hint }}</span>
    </template>
  </t-form-item>
</template>

<script lang="ts" setup>
import type { QuotaStrategySetting } from '@common/types'

const props = defineProps<{
  /** 策略的附加配置声明（meta.settings） */
  settings: QuotaStrategySetting[]
  /** 附加配置对象（父级持有 reactive，组件直接写其属性；初始值由父级从已有 strategyConfig 解析） */
  config: Record<string, string>
}>()

/** secure 字段的明文显隐（按 key 记录） */
const revealed = reactive<Record<string, boolean>>({})

function isSecure(item: QuotaStrategySetting): boolean {
  return item.type === 'secure'
}

function selectOptions(item: QuotaStrategySetting): Array<{ label: string; value: string }> {
  return item.widget === 'select' ? (item.options ?? []) : []
}

/** select 清空时归一为空串（= 不设置该键），与 strategyConfig 的字符串键值约定一致 */
function onSelectChange(key: string, value: unknown): void {
  props.config[key] = typeof value === 'string' ? value : ''
}
</script>
