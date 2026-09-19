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
    <t-form-item label="余量策略">
      <t-select
        v-model="form.quotaStrategyId"
        clearable
        filterable
        placeholder="不查询余量"
        :loading="strategyLoading"
      >
        <t-option
          v-for="opt in strategyOptions"
          :key="opt.id"
          :value="opt.id"
          :label="opt.builtin ? `${opt.label}（内置）` : `${opt.label}（外置）`"
        />
      </t-select>
      <template #help>
        <span class="text-12px text-td-secondary">{{ strategyHelp }}</span>
      </template>
    </t-form-item>
    <t-form-item v-if="needStrategyConfig" label="附加配置（JSON）">
      <t-textarea
        v-model="form.strategyConfig"
        :autosize="{ minRows: 3, maxRows: 6 }"
        :placeholder="configPlaceholder"
      />
      <template #help>
        <span class="text-12px text-td-secondary">
          {{
            credential === 'cookie'
              ? '粘贴浏览器 Cookie 头，如 {"cookie":"session=..."}'
              : '如 {"token":"..."}（Codex 令牌、区域等附加配置）'
          }}
        </span>
      </template>
    </t-form-item>
    <t-form-item label="启用">
      <t-switch v-model="form.enabled" />
    </t-form-item>
  </t-form>
</template>

<script lang="ts" setup>
import type { ProviderInfo, ProviderKind, ProviderProtocol, QuotaStrategyInfo } from '@common/types'
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
  /** 空串 = 未绑定（t-select 不接受 null）；提交时转 null 落库 */
  quotaStrategyId: props.provider?.quotaStrategyId ?? '',
  strategyConfig: props.provider?.strategyConfig ?? '',
  enabled: props.provider?.enabled ?? true
})

/** 余量策略目录（内置 + 已启用外置）：编辑已有提供商与新增时都会加载 */
const strategyOptions = ref<QuotaStrategyInfo[]>([])
const strategyLoading = ref(false)

onMounted(async () => {
  strategyLoading.value = true
  try {
    strategyOptions.value = await window.preload.quota.strategies()
    // 编辑已有提供商时，若其绑定的外置策略已被禁用（不在目录），补一个占位项避免显示丢值
    const bound = form.quotaStrategyId
    if (bound && !strategyOptions.value.some((s) => s.id === bound)) {
      strategyOptions.value = [
        ...strategyOptions.value,
        {
          id: bound,
          label: '（已停用的外置策略）',
          builtin: false,
          credential: 'apiKey',
          enabled: false
        }
      ]
    }
  } catch {
    // 目录加载失败不阻塞表单（余量策略为可选功能）
  } finally {
    strategyLoading.value = false
  }
})

const selectedStrategy = computed(
  () => strategyOptions.value.find((s) => s.id === form.quotaStrategyId) ?? null
)

const credential = computed(() => selectedStrategy.value?.credential ?? 'apiKey')

/** 非 API Key 凭证策略需要附加配置（Cookie / 令牌） */
const needStrategyConfig = computed(
  () =>
    selectedStrategy.value !== null && credential.value !== 'apiKey' && credential.value !== 'none'
)

const configPlaceholder = computed(() =>
  credential.value === 'cookie' ? '{"cookie":"session=..."}' : '{"token":"..."}'
)

const strategyHelp = computed(() => {
  const strategy = selectedStrategy.value
  if (!strategy) return '绑定后在「余量」页展示该提供商的限额窗口；内置策略按预设自动推荐'
  return strategy.description ?? ''
})

/** 点选预设：同名内置策略存在时自动绑定（如 Z.ai → zai 策略） */
function autoBindStrategy(kind: ProviderKind | ''): void {
  if (!kind) return
  if (strategyOptions.value.some((s) => s.id === kind)) form.quotaStrategyId = kind
}

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
  autoBindStrategy(form.kind)
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
      quotaStrategyId: form.quotaStrategyId || null,
      strategyConfig:
        form.quotaStrategyId && needStrategyConfig.value && form.strategyConfig.trim()
          ? form.strategyConfig.trim()
          : null,
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
