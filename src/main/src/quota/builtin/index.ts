/**
 * 内置策略装配入口：35 家 native TS 策略（Swift 原生移植 + CodexBar JS 插件全量迁移），
 * 启动时注册进内存注册表——内置策略不可卸载不可删除（UI 只读目录）。
 * 外置用户插件由 quota/service.ts 的 reloadExternalStrategies 单独装载。
 */
import { registerStrategy } from '../registry'
import { nativeStrategies } from './native'

export function registerBuiltinStrategies(): void {
  for (const strategy of nativeStrategies) {
    registerStrategy(strategy)
  }
}
