import { ref } from 'vue'

const STORAGE_KEY = 'ai-router-color-mode'

export type ColorModeName = 'system' | 'light' | 'dark'

function readStoredMode(): ColorModeName | null {
  const value = localStorage.getItem(STORAGE_KEY)
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return null
}

/**
 * 三态色彩模式（参考 mistrelle ColorMode）：light / dark / 跟随系统。
 * 模块级单例：import 时即读取持久化状态并渲染主题（首帧前生效），全组件共享同一状态。
 * system 模式监听 prefers-color-scheme 实时跟随；
 * 渲染层 TDesign 走 html[theme-mode]，UnoCSS 的 dark: 变体走 html.dark，两者同步维护。
 */
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const mode = ref<ColorModeName>(readStoredMode() ?? 'system')
const isDark = ref(mode.value === 'dark' || (mode.value !== 'light' && mediaQuery.matches))

function renderColorMode(): void {
  const root = document.documentElement
  root.setAttribute('theme-mode', isDark.value ? 'dark' : 'light')
  root.classList.toggle('dark', isDark.value)
}

function syncIsDark(nextMode: ColorModeName): void {
  isDark.value = nextMode === 'dark' || (nextMode === 'system' && mediaQuery.matches)
  renderColorMode()
}

function setColorMode(next: ColorModeName): void {
  mode.value = next
  localStorage.setItem(STORAGE_KEY, next)
  syncIsDark(next)
}

mediaQuery.addEventListener('change', (e: MediaQueryListEvent) => {
  if (mode.value === 'system') {
    isDark.value = e.matches
    renderColorMode()
  }
})

// 多窗口同步：主窗口与托盘面板共享 localStorage，任一窗口切换后另一窗口即时跟随
window.addEventListener('storage', (e: StorageEvent) => {
  if (e.key !== STORAGE_KEY) return
  const next = readStoredMode()
  if (!next || next === mode.value) return
  mode.value = next
  syncIsDark(next)
})

renderColorMode()

export const useColorMode = (): {
  isDark: typeof isDark
  mode: typeof mode
  setColorMode: typeof setColorMode
} => {
  return { isDark, mode, setColorMode }
}
