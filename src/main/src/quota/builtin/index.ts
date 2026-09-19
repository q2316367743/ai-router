/**
 * 内置策略装配入口：native TS 策略 + CodexBar 脚本策略，全部启动时注册进内存
 * 注册表——内置策略不可卸载不可删除（UI 只读目录）。
 */
import { registerStrategy } from '../registry'
import { nativeStrategies } from './native'
import { loadScriptedStrategies } from './scripted'

export function registerBuiltinStrategies(): void {
  for (const strategy of nativeStrategies) {
    registerStrategy(strategy)
  }
  const { strategies, failures } = loadScriptedStrategies()
  for (const strategy of strategies) {
    registerStrategy(strategy)
  }
  for (const message of failures) {
    // 单家脚本加载失败不阻断启动，只留诊断日志
    console.error(`[quota] 内置脚本策略加载失败：${message}`)
  }
}
