/**
 * [INPUT]: 依赖 src/main/shortcuts 的状态机副作用绑定，Electron/window/store 全部 mock
 * [OUTPUT]: 验证 HIDE/SHOW 副作用委托给窗口可见性层，而非直接操作 BaseWindow
 * [POS]: tests 的快捷键运行时守卫，防止全屏隐藏再次绕开 window 生命周期
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  appOn: vi.fn(),
  register: vi.fn(() => true),
  unregisterAll: vi.fn(),
  isTrustedAccessibilityClient: vi.fn(() => true),
  uioOn: vi.fn(),
  uioStart: vi.fn()
}))

const win = vi.hoisted(() => ({
  rawHide: vi.fn(),
  rawShow: vi.fn(),
  hideFloatWindow: vi.fn(),
  showFloatWindow: vi.fn(),
  toggleCinema: vi.fn()
}))

const media = vi.hoisted(() => ({
  pageMuted: false as boolean | null,
  audioMuted: false,
  setAudioMuted: vi.fn(),
  send: vi.fn(),
  executeJavaScript: vi.fn()
}))

vi.mock('electron', () => ({
  app: { on: electron.appOn, quit: vi.fn() },
  globalShortcut: {
    register: electron.register,
    unregisterAll: electron.unregisterAll,
    unregister: vi.fn(),
    isRegistered: vi.fn(() => false)
  },
  systemPreferences: {
    isTrustedAccessibilityClient: electron.isTrustedAccessibilityClient
  }
}))

vi.mock('uiohook-napi', () => ({
  uIOhook: { on: electron.uioOn, start: electron.uioStart, stop: vi.fn() },
  UiohookKey: { X: 7 }
}))

vi.mock('../src/main/store', () => ({
  store: {
    data: {
      shortcuts: {
        hide: 'Control+Z',
        peek: 'Control+X',
        boss: 'Control+C',
        playpause: 'Control+P',
        mute: 'Control+M',
        mode: 'Control+B',
        passthrough: 'Control+T',
        fullscreen: 'Control+Enter'
      }
    },
    patch: vi.fn()
  }
}))

vi.mock('../src/main/i18n', () => ({ t: (en: string) => en }))

vi.mock('../src/main/window', () => ({
  getFloat: () => ({
    win: { hide: win.rawHide, showInactive: win.rawShow },
    pageView: {
      webContents: {
        isAudioMuted: () => media.audioMuted,
        setAudioMuted: media.setAudioMuted,
        send: media.send,
        executeJavaScript: media.executeJavaScript
      }
    }
  }),
  getOnboarding: () => null,
  isOnboarding: () => false,
  raiseOnboarding: vi.fn(),
  togglePassthrough: vi.fn(),
  toggleWindowFullscreen: vi.fn(),
  hideFloatWindow: win.hideFloatWindow,
  showFloatWindow: win.showFloatWindow
}))

vi.mock('../src/main/modes', () => ({
  toggleCinema: win.toggleCinema
}))

describe('shortcuts effects', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    media.pageMuted = false
    media.audioMuted = false
    media.executeJavaScript.mockImplementation(() => Promise.resolve(media.pageMuted))
  })

  it('隐藏动作委托给 window 生命周期层，避免全屏态直接 hide 黑屏', async () => {
    const { registerShortcuts, dispatchHideToggle } = await import('../src/main/shortcuts')

    registerShortcuts()
    dispatchHideToggle()

    expect(win.hideFloatWindow).toHaveBeenCalledTimes(1)
    expect(win.rawHide).not.toHaveBeenCalled()
  })

  it('显示动作委托给 window 生命周期层，允许取消待隐藏全屏退出', async () => {
    const { registerShortcuts, dispatchHideToggle } = await import('../src/main/shortcuts')

    registerShortcuts()
    dispatchHideToggle()
    dispatchHideToggle()

    expect(win.showFloatWindow).toHaveBeenCalledTimes(1)
    expect(win.rawShow).not.toHaveBeenCalled()
  })

  it('没有主视频时静音按钮不翻转 WebContents 静音状态', async () => {
    media.pageMuted = null
    const { toggleMute } = await import('../src/main/shortcuts')

    await toggleMute()

    expect(media.setAudioMuted).not.toHaveBeenCalled()
    expect(media.send).toHaveBeenCalledWith('state:muted', false)
  })

  it('观影/浏览模式切换注册为默认 Control+B', async () => {
    const { registerShortcuts } = await import('../src/main/shortcuts')

    registerShortcuts()

    expect(electron.register).toHaveBeenCalledWith('Control+B', expect.any(Function))
  })
})
