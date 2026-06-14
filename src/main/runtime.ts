/**
 * [INPUT]: 依赖 electron 的 systemPreferences，依赖 ./window 浮窗创建，依赖 ./modes 导航 watcher
 * [OUTPUT]: 对外提供 startRuntime()/ensureRuntimeVisible()/hasRequiredPermissions()
 * [POS]: main 的运行时门闩——权限未满足前绝不创建视频浮窗
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { systemPreferences } from 'electron'
import { watchNavigation } from './modes'
import { clampFloatToVisible, createFloatWindow } from './window'

let started = false

export function hasRequiredPermissions(): boolean {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false)
}

export function startRuntime(): void {
  if (started) return
  createFloatWindow()
  watchNavigation()
  started = true
}

export function ensureRuntimeVisible(): void {
  startRuntime()
  const f = createFloatWindow()
  clampFloatToVisible()
  f.win.showInactive()
}
