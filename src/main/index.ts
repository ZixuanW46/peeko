/**
 * [INPUT]: 依赖 electron 的 app 生命周期，依赖 ./runtime 的权限门闩
 * [OUTPUT]: 应用入口——单实例锁、自动播放开关、Dock 可见性、权限门闩、模块装配
 * [POS]: main 的装配根，唯一的 app 级副作用集中地
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app } from 'electron'
import { openOnboarding } from './window'
import { registerIpc } from './ipc'
import { hasCriticalShortcutIssues, registerShortcuts } from './shortcuts'
import { createTray } from './tray'
import { store } from './store'
import { ensureRuntimeVisible, hasRequiredPermissions, startRuntime } from './runtime'
import { applyDockVisibility } from './dock'
import { configureUpdater, scheduleAutomaticUpdateCheck } from './updater'

// 自动播放解禁必须在 app.ready 之前
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

export function restoreFromAppShell(): void {
  if (hasRequiredPermissions() && !hasCriticalShortcutIssues()) ensureRuntimeVisible()
  else openOnboarding()
}

app.whenReady().then(() => {
  // 默认作为普通 Dock 应用出现；设置里仍可切回纯菜单栏驻留。
  applyDockVisibility()
  registerIpc()
  registerShortcuts()
  createTray()
  configureUpdater()
  scheduleAutomaticUpdateCheck()
  const ready = hasRequiredPermissions() && !hasCriticalShortcutIssues()
  if (ready && store.data.onboarded) startRuntime()
  if (!store.data.onboarded || !ready) openOnboarding()
})

app.on('second-instance', () => {
  // 双击可能同时拉起两个实例：信号到达时本实例可能还没 ready
  void app.whenReady().then(restoreFromAppShell)
})

app.on('activate', () => {
  // Dock 点击 = 用户在找回窗口；走同一权限/快捷键门闩，缺条件时回到引导。
  void app.whenReady().then(restoreFromAppShell)
})

app.on('window-all-closed', () => {
  // 窗口关闭不退出；退出只走 Quit 快捷键、Command+Q 或菜单。
})
