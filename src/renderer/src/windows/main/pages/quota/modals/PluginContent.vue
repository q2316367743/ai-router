<template>
  <t-form label-align="top">
    <t-form-item label="策略名称">
      <t-input v-model="form.name" placeholder="如：New API 余量" :maxlength="30" />
    </t-form-item>
    <t-form-item label="启用">
      <t-switch v-model="form.enabled" />
    </t-form-item>
    <t-form-item>
      <template #label>
        <div>脚本（defineProvider 契约）</div>
      </template>
      <t-textarea
        v-model="form.script"
        class="plugin-script"
        :autosize="{ minRows: 18, maxRows: 26 }"
        placeholder="defineProvider({ id: 'my-plugin', name: 'My Plugin', endpoints: ['https://example.com'], auth: { type: 'bearer', secret: 'MY_KEY' }, settings: [{ key: 'MY_KEY', title: 'API Key', type: 'secure' }], async fetchUsage(ctx) { const res = await ctx.http.getJSON('https://example.com/usage'); if (res.status !== 200) throw ctx.fail.apiFailure(`HTTP ${res.status}`); const usage = res.json.usage; return { primary: { usedPercent: usage.percent, windowMinutes: 300, resetsAt: Date.now() + usage.resetInSec * 1000, resetDescription: '5 小时' } } } })"
      />
      <template #help>
        <div class="text-12px text-td-secondary">
          顶层调用 defineProvider({...})，fetchUsage(ctx) 返回 { primary / secondary / extraWindows / cost / details }。
          ctx 提供 http（getJSON/get/post/postJSON，受 endpoints 白名单约束）、settings、fail、pct；
          认证头按 auth 声明由宿主附加（secret 取提供商 API Key）。契约详见 docs/app/11-余量查询.md。
        </div>
      </template>
    </t-form-item>
  </t-form>
</template>

<script lang="ts" setup>
import type { QuotaPluginInfo } from '@common/types'
import { MessageUtil } from '@/utils/modal'

const props = defineProps<{
  plugin: QuotaPluginInfo | null
}>()

const emit = defineEmits<{
  success: []
}>()

const saving = ref(false)

const form = reactive({
  name: props.plugin?.name ?? '',
  script: props.plugin?.script ?? '',
  enabled: props.plugin?.enabled ?? true
})

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    MessageUtil.warning('请输入策略名称')
    return
  }
  if (!form.script.trim()) {
    MessageUtil.warning('请输入脚本内容')
    return
  }
  saving.value = true
  try {
    const payload = {
      id: props.plugin?.id,
      name: form.name.trim(),
      script: form.script,
      enabled: form.enabled
    }
    if (props.plugin) {
      await window.preload.quotaPlugin.update(payload)
    } else {
      await window.preload.quotaPlugin.create(payload)
    }
    MessageUtil.success(props.plugin ? '已保存' : '已创建')
    emit('success')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

/** 保存/取消在外壳（PluginDrawer）footer 置底：footer 经此驱动提交与 loading 态 */
defineExpose({
  submit,
  saving
})
</script>

<style scoped lang="less">
.plugin-script :deep(textarea) {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}
</style>
