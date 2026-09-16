import { ref } from 'vue'

/** 侧边栏折叠状态：模块级单例，App.vue / PageLayout 等跨组件共享（不持久化，同 mistrelle） */
export const collapsed = ref(false)

export function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}
