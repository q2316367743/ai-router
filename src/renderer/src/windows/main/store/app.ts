import { defineStore } from 'pinia'

/** 应用全局状态：外观三态的当前所选（light/dark，系统跟随后续需要时扩展） */
export const useAppStore = defineStore('app', {
  state: () => ({
    themeMode: 'light' as 'light' | 'dark'
  }),
  actions: {
    /** 切换深浅色：UnoCSS 走 html.dark class，TDesign 走 html[theme-mode] 属性 */
    toggleTheme(): void {
      this.themeMode = this.themeMode === 'light' ? 'dark' : 'light'
      const root = document.documentElement
      root.classList.toggle('dark', this.themeMode === 'dark')
      if (this.themeMode === 'dark') root.setAttribute('theme-mode', 'dark')
      else root.removeAttribute('theme-mode')
    }
  }
})
