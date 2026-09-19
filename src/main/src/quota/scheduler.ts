/**
 * 余量调度器：注册内置策略 → 装载外置策略 → 启动延迟首刷 + 周期刷新。
 * 定时模式照抄 tray.ts（setInterval + try/catch 静默，失败不影响应用其他功能）。
 * 启动期打一条策略目录汇总日志；启动失败只记错不抛，余量模块不能拖垮 whenReady 链。
 */
import { registerBuiltinStrategies } from './builtin'
import { listStrategies } from './registry'
import { makeNativeContext } from './runtime/context'
import { reloadExternalStrategies, refreshProviderQuota } from './service'

/** 刷新周期：限额窗口（5 小时/周/月）变化不快，10 分钟足够跟手 */
const REFRESH_INTERVAL = 10 * 60 * 1000
/** 启动首刷延迟：避开启动瞬间的代理服务/窗口创建 */
const FIRST_REFRESH_DELAY = 5_000

let started = false

export function startQuotaScheduler(): void {
  if (started) return
  started = true

  try {
    registerBuiltinStrategies()
    reloadExternalStrategies()
    // 预热脚本宿主：prelude 求值问题在启动期暴露，而不是第一次查询时才静默挂掉
    makeNativeContext({ apiKey: '', baseUrl: '', config: {} })
    const catalog = listStrategies()
    const builtinCount = catalog.filter((strategy) => strategy.meta.builtin).length
    console.log(
      `[quota] 调度器已启动：策略 ${catalog.length} 条（内置 ${builtinCount} / 外置 ${
        catalog.length - builtinCount
      }），每 ${REFRESH_INTERVAL / 60_000} 分钟刷新一轮，首刷 ${FIRST_REFRESH_DELAY / 1000}s 后`
    )
  } catch (err) {
    console.error('[quota] 启动失败（不影响应用其他功能）：', err instanceof Error ? err.message : err)
    return
  }

  setTimeout(() => {
    void refreshAllQuota()
  }, FIRST_REFRESH_DELAY)
  setInterval(() => {
    void refreshAllQuota()
  }, REFRESH_INTERVAL)
}

async function refreshAllQuota(): Promise<void> {
  try {
    await refreshProviderQuota()
  } catch (err) {
    // 调度失败静默：快照保留旧值，页面手动刷新可重试
    console.error('[quota] 定时刷新异常：', err instanceof Error ? err.message : err)
  }
}
