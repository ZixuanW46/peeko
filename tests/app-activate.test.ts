/**
 * [INPUT]: 依赖 src/main/index 的 app activate 装配，Electron 生命周期全 mock
 * [OUTPUT]: 验证 Dock 点击恢复浮窗；权限或快捷键不满足时回到 onboarding
 * [POS]: tests 的 macOS Dock 恢复守卫，防止 Vanish 后用户找不回窗口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  handlers: {} as Record<string, () => void>,
  appendSwitch: vi.fn(),
  requestSingleInstanceLock: vi.fn(() => true),
  quit: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn((event: string, cb: () => void) => {
    electron.handlers[event] = cb
  })
}))

const gates = vi.hoisted(() => ({
  hasPermissions: true,
  hasCriticalShortcuts: false,
  openOnboarding: vi.fn(),
  registerIpc: vi.fn(),
  registerShortcuts: vi.fn(),
  createTray: vi.fn(),
  startRuntime: vi.fn(),
  ensureRuntimeVisible: vi.fn(),
  applyDockVisibility: vi.fn(),
  configureUpdater: vi.fn(),
  scheduleAutomaticUpdateCheck: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    commandLine: { appendSwitch: electron.appendSwitch },
    requestSingleInstanceLock: electron.requestSingleInstanceLock,
    quit: electron.quit,
    whenReady: electron.whenReady,
    on: electron.on
  }
}))

vi.mock('../src/main/window', () => ({ openOnboarding: gates.openOnboarding }))
vi.mock('../src/main/ipc', () => ({ registerIpc: gates.registerIpc }))
vi.mock('../src/main/shortcuts', () => ({
  registerShortcuts: gates.registerShortcuts,
  hasCriticalShortcutIssues: () => gates.hasCriticalShortcuts
}))
vi.mock('../src/main/tray', () => ({ createTray: gates.createTray }))
vi.mock('../src/main/store', () => ({ store: { data: { onboarded: true } } }))
vi.mock('../src/main/runtime', () => ({
  ensureRuntimeVisible: gates.ensureRuntimeVisible,
  hasRequiredPermissions: () => gates.hasPermissions,
  startRuntime: gates.startRuntime
}))
vi.mock('../src/main/dock', () => ({ applyDockVisibility: gates.applyDockVisibility }))
vi.mock('../src/main/updater', () => ({
  configureUpdater: gates.configureUpdater,
  scheduleAutomaticUpdateCheck: gates.scheduleAutomaticUpdateCheck
}))

async function loadIndex(): Promise<void> {
  await import('../src/main/index')
  await Promise.resolve()
}

async function activateDock(): Promise<void> {
  electron.handlers.activate()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Dock activate restore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    electron.handlers = {}
    gates.hasPermissions = true
    gates.hasCriticalShortcuts = false
  })

  it('点击 Dock 图标时恢复/创建运行时窗口', async () => {
    await loadIndex()
    gates.ensureRuntimeVisible.mockClear()
    gates.openOnboarding.mockClear()

    await activateDock()

    expect(gates.ensureRuntimeVisible).toHaveBeenCalledTimes(1)
    expect(gates.openOnboarding).not.toHaveBeenCalled()
  })

  it('权限或快捷键健康不满足时点击 Dock 打开 onboarding', async () => {
    gates.hasPermissions = false
    await loadIndex()
    gates.ensureRuntimeVisible.mockClear()
    gates.openOnboarding.mockClear()

    await activateDock()

    expect(gates.openOnboarding).toHaveBeenCalledTimes(1)
    expect(gates.ensureRuntimeVisible).not.toHaveBeenCalled()
  })
})
