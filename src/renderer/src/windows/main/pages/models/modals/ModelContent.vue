<template>
  <t-form label-align="top">
    <t-form-item label="对外模型名">
      <t-input v-model="form.publicName" placeholder="如：open-code-go-DSV1" :maxlength="64" />
    </t-form-item>
    <t-form-item label="提供商">
      <t-select
        v-model="form.providerId"
        :options="providerOptions"
        placeholder="请选择提供商"
        :empty="'暂无可用提供商'"
      />
    </t-form-item>
    <t-form-item label="上游模型名">
      <t-input v-model="form.upstreamName" placeholder="提供商侧的真实模型名，如：deepseek-chat" :maxlength="64" />
    </t-form-item>
    <t-form-item label="启用">
      <t-switch v-model="form.enabled" />
    </t-form-item>

    <div class="flex justify-end gap-8px mt-8px">
      <t-button variant="outline" :disabled="saving" @click="emit('close')">取消</t-button>
      <t-button theme="primary" :loading="saving" @click="submit">保存</t-button>
    </div>
  </t-form>
</template>

<script lang="ts" setup>
import type { ModelMappingInfo, ProviderInfo } from '@common/types'
import { MessageUtil } from '@/utils/modal'

const props = defineProps<{
  mapping: ModelMappingInfo | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const saving = ref(false)
const providers = ref<ProviderInfo[]>([])

const form = reactive({
  publicName: props.mapping?.publicName ?? '',
  providerId: props.mapping?.providerId ?? '',
  upstreamName: props.mapping?.upstreamName ?? '',
  enabled: props.mapping?.enabled ?? true
})

/** 已归档提供商不可作为归宿；已禁用的剔除但保留当前项（否则编辑既有映射会看不到原提供商） */
const providerOptions = computed(() =>
  providers.value
    .filter((p) => p.archivedAt === null && (p.enabled || p.id === form.providerId))
    .map((p) => ({ label: p.name, value: p.id }))
)

onMounted(() => {
  void window.preload.provider.list().then((list) => {
    providers.value = list
  })
})

async function submit(): Promise<void> {
  if (!form.publicName.trim()) {
    MessageUtil.warning('请输入对外模型名')
    return
  }
  if (!form.providerId) {
    MessageUtil.warning('请选择提供商')
    return
  }
  if (!form.upstreamName.trim()) {
    MessageUtil.warning('请输入上游模型名')
    return
  }
  saving.value = true
  try {
    const payload = {
      id: props.mapping?.id,
      providerId: form.providerId,
      publicName: form.publicName.trim(),
      upstreamName: form.upstreamName.trim(),
      enabled: form.enabled
    }
    if (props.mapping) {
      await window.preload.model.update(payload)
    } else {
      await window.preload.model.create(payload)
    }
    MessageUtil.success(props.mapping ? '已保存' : '已创建')
    emit('success')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>
