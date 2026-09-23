<template>
  <t-form label-align="top">
    <t-form-item
      label="对外模型名"
      help="改名会作用于该对外模型下的全部渠道，并同步改写历史统计与日志里的名称（历史请求的
        上游模型名不变）。"
    >
      <t-input v-model="name" placeholder="如：deepseek-v4.1-flash" :maxlength="64" />
    </t-form-item>

    <div class="flex justify-end gap-8px mt-8px">
      <t-button variant="outline" :disabled="saving" @click="emit('close')">取消</t-button>
      <t-button theme="primary" :loading="saving" @click="submit">保存</t-button>
    </div>
  </t-form>
</template>

<script lang="ts" setup>
import { MessageUtil } from '@/utils/modal'

/** 对外模型（组）重命名弹窗内容：名字属于整组，改名是一次批量动作 */
const props = defineProps<{
  from: string
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const name = ref(props.from)
const saving = ref(false)

async function submit(): Promise<void> {
  const next = name.value.trim()
  if (!next) {
    MessageUtil.warning('请输入对外模型名')
    return
  }
  if (next === props.from) {
    emit('close')
    return
  }
  saving.value = true
  try {
    await window.preload.model.groupRename({ from: props.from, to: next })
    MessageUtil.success('已重命名')
    emit('success')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '重命名失败')
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
