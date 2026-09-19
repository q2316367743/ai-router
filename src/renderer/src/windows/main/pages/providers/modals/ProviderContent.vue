<template>
  <t-form label-align="top">
    <t-form-item label="预设供应商">
      <div class="flex flex-wrap gap-8px">
        <t-tag
          v-for="opt in KIND_CHIPS"
          :key="opt.value"
          size="large"
          class="cursor-pointer"
          :theme="form.kind === opt.value ? 'primary' : 'default'"
          :variant="form.kind === opt.value ? 'dark' : 'light'"
          @click="selectKind(opt.value)"
        >
          {{ opt.label }}
        </t-tag>
      </div>
      <template #help>
        <div v-if="currentPreset" class="flex items-center gap-4px text-12px text-td-secondary">
          <t-icon name="check-circle" />
          {{
            presetUrl
              ? `请求地址 ${presetUrl}，只需填写 API Key`
              : '当前接口类型无预设地址，请在下方填写'
          }}
        </div>
      </template>
    </t-form-item>
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
    <t-form-item>
      <template #label>
        <div class="flex w-full items-center justify-between">
          <span>API Key</span>
          <t-link
            v-if="currentPreset?.consoleUrl"
            :href="currentPreset.consoleUrl"
            target="_blank"
            theme="primary"
            size="small"
            class="mr-[-24px]"
          >
            <template #suffixIcon><t-icon name="jump" /></template>
            获取 API Key
          </t-link>
        </div>
      </template>
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
    <t-form-item v-if="!presetUrl" label="Base URL">
      <t-input v-model="form.baseUrl" :placeholder="PROTOCOL_HINTS[form.protocol].placeholder" />
      <template #help>
        <span class="text-12px text-td-secondary">{{ PROTOCOL_HINTS[form.protocol].help }}</span>
      </template>
    </t-form-item>
    <t-form-item label="启用">
      <t-switch v-model="form.enabled" />
    </t-form-item>
  </t-form>
</template>

<script lang="ts" setup>
import type { ProviderInfo, ProviderKind, ProviderProtocol } from '@common/types'
import { MessageUtil } from '@/utils/modal'
import { PROVIDER_PRESETS, getPreset } from '../presets'

const props = defineProps<{
  provider: ProviderInfo | null
}>()

const emit = defineEmits<{
  success: []
}>()

const PROTOCOL_HINTS: Record<ProviderProtocol, { placeholder: string; help: string }> = {
  openai: {
    placeholder: 'https://api.deepseek.com/v1',
    help: '填完整 API 根（含 /v1 等版本/路径前缀，火山云形如 /api/plan/v3）：代理在其后拼 /chat/completions'
  },
  'openai-responses': {
    placeholder: 'https://api.openai.com/v1',
    help: '填完整 API 根（含 /v1 等版本/路径前缀）：代理在其后拼 /responses'
  },
  anthropic: {
    placeholder: 'https://api.anthropic.com/v1',
    help: '填完整 API 根（含 /v1 等版本/路径前缀）：代理在其后拼 /messages'
  }
}

const saving = ref(false)
const showKey = ref(false)

/** 选中预设后回填协议时的候选顺序（内置厂商均无 openai-responses 端点） */
const PRESET_PROTOCOL_ORDER: ProviderProtocol[] = ['openai', 'anthropic', 'openai-responses']

const KIND_CHIPS: Array<{ label: string; value: ProviderKind | '' }> = [
  { label: '自定义', value: '' },
  ...PROVIDER_PRESETS.map((p) => ({ label: p.label, value: p.kind }))
]

const form = reactive({
  kind: (props.provider?.kind ?? '') as ProviderKind | '',
  name: props.provider?.name ?? '',
  protocol: (props.provider?.protocol ?? 'openai') as ProviderProtocol,
  baseUrl: props.provider?.baseUrl ?? '',
  apiKey: props.provider?.apiKey ?? '',
  enabled: props.provider?.enabled ?? true
})

const currentPreset = computed(() => getPreset(form.kind || null))

/** 当前类型 + 协议下的预设端点：非空时 Base URL 字段隐藏（地址已内置，以提示行展示） */
const presetUrl = computed(() => currentPreset.value?.urls[form.protocol] ?? null)

/** 最近一次由预设带出的名称：名称为空或仍是它（用户未手改）时，切换预设名称才跟随 */
let autoName: string | null = props.provider
  ? (getPreset(props.provider.kind)?.label ?? null)
  : null

/** 点选预设：回填协议与端点；切回自定义：只清类型，已填字段保留 */
function selectKind(value: ProviderKind | ''): void {
  const preset = getPreset(value || null)
  form.kind = preset ? preset.kind : ''
  if (!preset) return
  const protocol = PRESET_PROTOCOL_ORDER.find((p) => preset.urls[p])
  if (protocol) {
    form.protocol = protocol
    form.baseUrl = preset.urls[protocol] ?? ''
  }
  const name = form.name.trim()
  if (!name || name === autoName) {
    form.name = preset.label
    autoName = preset.label
  }
}

/** 已选预设时切换协议：该协议有官方端点则同步换 Base URL，没有则保留手填值 */
watch(
  () => form.protocol,
  (protocol) => {
    const url = getPreset(form.kind || null)?.urls[protocol]
    if (url) form.baseUrl = url
  }
)

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    MessageUtil.warning('请输入名称')
    return
  }
  if (!form.baseUrl.trim()) {
    MessageUtil.warning('请输入 Base URL')
    return
  }
  if (!form.apiKey.trim()) {
    MessageUtil.warning('请输入 API Key')
    return
  }
  saving.value = true
  try {
    const payload = {
      id: props.provider?.id,
      name: form.name.trim(),
      protocol: form.protocol,
      kind: form.kind || null,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      enabled: form.enabled
    }
    if (props.provider) {
      await window.preload.provider.update(payload)
    } else {
      await window.preload.provider.create(payload)
    }
    MessageUtil.success(props.provider ? '已保存' : '已创建')
    emit('success')
  } catch (err) {
    MessageUtil.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

/** 保存/取消在外壳（ProviderDrawer）footer 置底：footer 经此驱动提交与 loading 态 */
defineExpose({
  submit,
  saving
})
</script>
