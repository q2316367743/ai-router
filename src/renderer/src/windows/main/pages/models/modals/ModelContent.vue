<template>
  <t-form label-align="top">
    <t-form-item
      label="对外模型名"
      :help="
        nameLocked
          ? '对外模型名属于整组，改名请在列表用「重命名」'
          : '选已有名称 = 在该对外模型下新增渠道；输入新名称 =\n' +
            '          新建对外模型。同一名称下的多个渠道互为故障转移候选。'
      "
    >
      <t-auto-complete
        v-model="form.publicName"
        :options="publicNameOptions"
        :disabled="nameLocked"
        placeholder="如：deepseek-v4.1-flash"
        :input-props="{ maxlength: 64 }"
      />
    </t-form-item>
    <t-form-item label="提供商" help="已在该对外模型下的提供商不重复出现（一个提供商一个渠道）">
      <t-select
        v-model="form.providerId"
        :options="providerOptions"
        placeholder="请选择提供商"
        :empty="'暂无可选提供商'"
      />
    </t-form-item>
    <t-form-item label="上游模型名">
      <t-input
        v-model="form.upstreamName"
        placeholder="提供商侧的真实模型名，如：deepseek-v4.1-flash"
        :maxlength="64"
      />
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

/**
 * 渠道新增/编辑弹窗内容。
 *
 * 对外模型名是「组」的属性：编辑时不可改（改名走列表的组级重命名），新增时既是新组名
 * 也可以是已有组名（= 往该组里加一条渠道）。
 */
const props = defineProps<{
  /** 编辑时传入待编辑渠道；新增为 null */
  mapping: ModelMappingInfo | null
  /** 从某个对外模型的展开区新增渠道时预置的组名（预置即锁定，不可改成别的组） */
  presetName?: string | null
  /** 全部渠道（含已归档，用于算出该对外名下已占用的提供商） */
  channels: ModelMappingInfo[]
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const isEdit = computed(() => props.mapping !== null)
/** 名字锁定：编辑既有渠道、或往指定组里加渠道时都不允许改名 */
const nameLocked = computed(() => isEdit.value || !!props.presetName)
const saving = ref(false)
const providers = ref<ProviderInfo[]>([])

const form = reactive({
  publicName: props.mapping?.publicName ?? props.presetName ?? '',
  providerId: props.mapping?.providerId ?? '',
  upstreamName: props.mapping?.upstreamName ?? '',
  enabled: props.mapping?.enabled ?? true
})

/** 可选的外报名：未整体归档的组（已整体归档的组需先恢复才能再加渠道） */
const publicNameOptions = computed(() => activePublicNames())

/** 该对外名下已被占用的提供商：**归档行同样占用**（与后端 `ensureChannelAvailable` 守卫一致），
 *  所以下拉里不会出现一个「提交才被拒绝」的选项；被占用的归档渠道需先在列表恢复或改名 */
const takenProviderIds = computed(
  () =>
    new Set(
      props.channels
        .filter(
          (channel) =>
            channel.publicName === form.publicName.trim() && channel.id !== props.mapping?.id
        )
        .map((channel) => channel.providerId)
    )
)

/** 已归档提供商不可作为归宿；已禁用的剔除但保留当前项（否则编辑既有渠道会看不到原提供商） */
const providerOptions = computed(() =>
  providers.value
    .filter(
      (provider) =>
        provider.archivedAt === null &&
        !takenProviderIds.value.has(provider.id) &&
        (provider.enabled || provider.id === form.providerId)
    )
    .map((provider) => ({ label: provider.name, value: provider.id }))
)

function activePublicNames(): string[] {
  const archived = new Map<string, boolean>()
  for (const channel of props.channels) {
    archived.set(
      channel.publicName,
      (archived.get(channel.publicName) ?? false) || channel.archivedAt === null
    )
  }
  return [...archived].filter(([, hasActive]) => hasActive).map(([name]) => name)
}

onMounted(() => {
  void window.preload.provider.list().then((list) => {
    providers.value = list
  })
})

async function submit(): Promise<void> {
  const publicName = form.publicName.trim()
  if (!isEdit.value && !publicName) {
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
    if (props.mapping) {
      await window.preload.model.update({
        id: props.mapping.id,
        providerId: form.providerId,
        upstreamName: form.upstreamName.trim(),
        enabled: form.enabled
      })
    } else {
      await window.preload.model.create({
        publicName,
        providerId: form.providerId,
        upstreamName: form.upstreamName.trim(),
        enabled: form.enabled
      })
    }
    MessageUtil.success(isEdit.value ? '已保存' : '已创建')
    emit('success')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="less">
.hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--td-text-color-secondary);
}
</style>
