<template>
  <div class="code-viewer">
    <div v-if="hasContent" ref="host" class="code-viewer__host" :style="{ height }"></div>
    <div v-else class="code-viewer__empty text-13px text-td-placeholder">（空）</div>
  </div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useColorMode } from '@/hooks/colorMode'

const THEME_NAME = 'ai-router-log'

const props = withDefaults(
  defineProps<{
    /** 待展示文本；为空时展示占位符且不初始化编辑器 */
    value: string | null
    language?: 'json' | 'plaintext'
    height?: string
  }>(),
  { language: 'plaintext', height: '360px' }
)

const { isDark } = useColorMode()

const host = ref<HTMLDivElement | null>(null)
const hasContent = computed(() => !!props.value)

let monacoApi: typeof import('monaco-editor') | null = null
let editor: MonacoEditor.IStandaloneCodeEditor | null = null
let creating: Promise<void> | null = null
let unmounted = false

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Monaco 主题 `colors` 的取值经 `Color.fromHex` 解析，必须带 `#`；
 * 非法值会被静默回退成 `Color.red`（表现为整块红色背景），故非 #hex 时退回默认值。
 */
function hexColor(color: string, fallback: string): string {
  return color.startsWith('#') ? color : fallback
}

/** Monaco token 规则 `foreground` 需不带 `#` 的 hex（内部会自动补 `#`） */
function tokenColor(color: string, fallback: string): string {
  return color.startsWith('#') ? color.slice(1) : fallback
}

/** 用 tdesign 语义色构造 Monaco 主题，token 命名对齐 JSON 语法类别 */
function buildTheme(): MonacoEditor.IStandaloneThemeData {
  const light = !isDark.value
  const backgroundFallback = light ? '#ffffff' : '#242424'
  const foregroundFallback = light ? '#1f1f1f' : '#ffffff'
  const placeholderFallback = '#8f8f8f'
  const hoverFallback = light ? '#f3f2f1' : '#292827'
  return {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      {
        token: 'string.key.json',
        foreground: tokenColor(cssVar('--td-brand-color', '#0078d4'), '0078d4')
      },
      {
        token: 'string.value.json',
        foreground: tokenColor(cssVar('--td-success-color', '#107c10'), '107c10')
      },
      {
        token: 'number',
        foreground: tokenColor(cssVar('--td-warning-color', '#ffcc00'), 'ffcc00')
      },
      { token: 'keyword', foreground: tokenColor(cssVar('--td-error-color', '#e81123'), 'e81123') }
    ],
    colors: {
      'editor.background': hexColor(
        cssVar('--td-bg-color-container', backgroundFallback),
        backgroundFallback
      ),
      'editor.foreground': hexColor(
        cssVar('--td-text-color-primary', foregroundFallback),
        foregroundFallback
      ),
      'editorGutter.background': hexColor(
        cssVar('--td-bg-color-container', backgroundFallback),
        backgroundFallback
      ),
      'editorLineNumber.foreground': hexColor(
        cssVar('--td-text-color-placeholder', placeholderFallback),
        placeholderFallback
      ),
      'editor.lineHighlightBackground': hexColor(
        cssVar('--td-bg-color-container-hover', hoverFallback),
        hoverFallback
      )
    }
  }
}

async function createEditor(): Promise<void> {
  if (!host.value) return
  // 先备好 worker，再加载 Monaco：MonacoEnvironment 需在创建编辑器前就绪
  const [editorWorkerModule, jsonWorkerModule] = await Promise.all([
    import('monaco-editor/editor/editor.worker?worker'),
    import('monaco-editor/language/json/json.worker?worker')
  ])
  if (unmounted || !host.value) return
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      return label === 'json' ? new jsonWorkerModule.default() : new editorWorkerModule.default()
    }
  }
  // 必须用包含全部 contributions 的入口；`editor.api` 是纯 API，缺少 actionWidgetService 等注册会创建失败
  const monaco = await import('monaco-editor')
  if (unmounted || !host.value) return
  monacoApi = monaco
  monaco.editor.defineTheme(THEME_NAME, buildTheme())
  editor = monaco.editor.create(host.value, {
    value: props.value ?? '',
    language: props.language,
    theme: THEME_NAME,
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    folding: true,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 12,
    lineHeight: 18,
    padding: { top: 8, bottom: 8 },
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
  })
}

function destroyEditor(): void {
  editor?.dispose()
  editor = null
}

async function sync(): Promise<void> {
  if (!props.value) {
    destroyEditor()
    return
  }
  await nextTick()
  if (unmounted) return
  if (!editor && !creating) creating = createEditor()
  if (creating) await creating
  if (!editor || unmounted) return
  editor.setValue(props.value)
  const model = editor.getModel()
  if (model && monacoApi) monacoApi.editor.setModelLanguage(model, props.language)
}

watch(
  () => [props.value, props.language] as const,
  () => void sync()
)

watch(isDark, () => {
  if (!monacoApi) return
  monacoApi.editor.defineTheme(THEME_NAME, buildTheme())
  monacoApi.editor.setTheme(THEME_NAME)
})

onMounted(() => void sync())

onBeforeUnmount(() => {
  unmounted = true
  destroyEditor()
})
</script>

<style lang="less" scoped>
.code-viewer {
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.code-viewer__host {
  width: 100%;
}

.code-viewer__empty {
  padding: 12px;
}
</style>
