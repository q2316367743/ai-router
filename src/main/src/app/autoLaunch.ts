/**
 * 开机自启（macOS / Windows，均基于 Electron 原生登录项）。
 *
 * - 状态以操作系统登录项为唯一权威，不做本地持久化（用户在系统设置里手动改动也能如实反映）。
 * - 未打包时（app.isPackaged === false）一律视为不支持：dev 下调用 setLoginItemSettings 会把
 *   Electron 可执行文件写进真实登录项，污染系统。
 * - macOS 的 `setLoginItemSettings` 不接受 args（args 为 Windows 专属），因此自启后「静默到托盘」
 *   只能在 macOS 上用 `getLoginItemSettings().wasOpenedAtLogin` 判断，Windows 上则靠写入的 --hidden 参数。
 * - macOS 未签名 / 未公证时 openAtLogin 可能静默失效，属系统限制。
 */
import { app } from 'electron'
import type { AutoLaunchState } from '@common/types'

/** 登录启动时传入的隐藏参数（Windows 专属能力，macOS 无法透传） */
const HIDDEN_FLAG = '--hidden'

/** 当前运行形态与平台是否支持开机自启 */
export function isAutoLaunchSupported(): boolean {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')
}

/**
 * Windows 读写登录项必须传入相同的 path / args，否则 openAtLogin 判定不准；
 * macOS 不接受这两个参数，返回空对象。
 */
function loginItemQuery(): { path?: string; args?: string[] } {
  return process.platform === 'win32' ? { path: process.execPath, args: [HIDDEN_FLAG] } : {}
}

export function getAutoLaunchEnabled(): boolean {
  if (!isAutoLaunchSupported()) return false
  return app.getLoginItemSettings(loginItemQuery()).openAtLogin
}

/** 写入系统登录项（enabled=false 时移除） */
export function setAutoLaunchEnabled(enabled: boolean): void {
  if (!isAutoLaunchSupported()) throw new Error('当前环境不支持开机自启')
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemQuery() })
}

/** 本次进程是否由登录项自启拉起（用于决定是否静默驻留托盘） */
export function isOpenedAtLogin(): boolean {
  if (!isAutoLaunchSupported()) return false
  if (process.platform === 'darwin') return app.getLoginItemSettings().wasOpenedAtLogin
  return process.argv.includes(HIDDEN_FLAG)
}

/** 组装给渲染层的状态快照 */
export function getAutoLaunchState(): AutoLaunchState {
  return { supported: isAutoLaunchSupported(), enabled: getAutoLaunchEnabled() }
}
