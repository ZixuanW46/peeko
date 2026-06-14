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

app.whenReady().then(() => {
  // 附件型应用默认无 Dock 图标；设置里可切回普通 Dock 应用。
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
  void app.whenReady().then(() => {
    if (hasRequiredPermissions() && !hasCriticalShortcutIssues()) ensureRuntimeVisible()
    else openOnboarding()
  })
})

app.on('window-all-closed', () => {
  // 菜单栏应用：窗口关闭不退出，退出只走老板键双击或托盘菜单
})
