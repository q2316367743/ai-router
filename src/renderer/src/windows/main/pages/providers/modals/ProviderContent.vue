<template>
  <t-form label-align="top">
    <t-form-item label="名称">
      <t-input v-model="form.name" placeholder="如：DeepSeek" :maxlength="30" />
    </t-form-item>
    <t-form-item label="接口类型">
      <t-radio-group v-model="form.protocol" variant="default-filled">
        <t-radio-button value="openai">OpenAI Chat</t-radio-button>
        <t-radio-button value="openai-responses">OpenAI Responses</t-radio-button>
        <t-radio-button value="anthropic">Anthropic Messages</t-radio-button>
      </t-radio-group>
    </t-form-item>
    <t-form-item label="Base URL">
      <t-input v-model="form.baseUrl" :placeholder="PROTOCOL_HINTS[form.protocol].placeholder" />
      <template #help>
        <span class="text-12px text-td-secondary">{{ PROTOCOL_HINTS[form.protocol].help }}</span>
      </template>
    </t-form-item>
    <t-form-item label="API Key">
      <t-input v-model="form.apiKey" :type="showKey ? 'text' : 'password'" placeholder="sk-...">
        <template #suffix-icon>
          <t-icon
            :name="showKey ? 'browse' : 'browse-off'"
            class="cursor-pointer"
            @click="showKey = !showKey"
          />
        </template>
      </t-input>
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
import { reactive, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { ProviderInfo, ProviderProtocol } from '@common/types'

const props = defineProps<{
  provider: ProviderInfo | null
}>()

const emit = defineEmits<{
  close: []
  success: []
}>()

const PROTOCOL_HINTS: Record<ProviderProtocol, { placeholder: string; help: string }> = {
  openai: {
    placeholder: 'https://api.deepseek.com',
    help: '填到域名即可：客户端请求路径会原样拼接到该地址后'
  },
  'openai-responses': {
    placeholder: 'https://api.openai.com',
    help: '填到域名即可：代理自动补 /v1，请求上游 /responses 接口'
  },
  anthropic: {
    placeholder: 'https://api.anthropic.com',
    help: '填到域名即可：代理自动补 /v1，请求上游 /messages 接口'
  }
}

const saving = ref(false)
const showKey = ref(false)

const form = reactive({
  name: props.provider?.name ?? '',
  protocol: (props.provider?.protocol ?? 'openai') as ProviderProtocol,
  baseUrl: props.provider?.baseUrl ?? '',
  apiKey: props.provider?.apiKey ?? '',
  enabled: props.provider?.enabled ?? true
})

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    MessagePlugin.warning('请输入名称')
    return
  }
  if (!form.baseUrl.trim()) {
    MessagePlugin.warning('请输入 Base URL')
    return
  }
  if (!form.apiKey.trim()) {
    MessagePlugin.warning('请输入 API Key')
    return
  }
  saving.value = true
  try {
    const payload = {
      id: props.provider?.id,
      name: form.name.trim(),
      protocol: form.protocol,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      enabled: form.enabled
    }
    if (props.provider) {
      await window.preload.provider.update(payload)
    } else {
      await window.preload.provider.create(payload)
    }
    MessagePlugin.success(props.provider ? '已保存' : '已创建')
    emit('success')
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>
