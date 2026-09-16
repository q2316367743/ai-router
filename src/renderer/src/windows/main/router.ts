import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

export const routes: Array<RouteRecordRaw> = [
  {
    name: 'redirect',
    path: '/',
    redirect: '/home'
  },
  {
    name: '概览',
    path: '/home',
    component: () => import('@/windows/main/pages/home/index.vue')
  },
  {
    name: '提供商',
    path: '/providers',
    component: () => import('@/windows/main/pages/providers/index.vue')
  },
  {
    name: '模型映射',
    path: '/models',
    component: () => import('@/windows/main/pages/models/index.vue')
  },
  {
    name: '服务',
    path: '/service',
    component: () => import('@/windows/main/pages/service/index.vue')
  },
  {
    name: '日志',
    path: '/logs',
    component: () => import('@/windows/main/pages/logs/index.vue')
  },
  {
    name: '用量统计',
    path: '/usage',
    component: () => import('@/windows/main/pages/usage/index.vue')
  },
  {
    name: '设置',
    path: '/settings',
    component: () => import('@/windows/main/pages/settings/index.vue')
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
