import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

export const routes: Array<RouteRecordRaw> = [
  {
    name: 'redirect',
    path: '/',
    redirect: '/home'
  },
  {
    name: '首页',
    path: '/home',
    component: () => import('@/windows/main/pages/home/index.vue')
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
