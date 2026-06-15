/**
 * [INPUT]: 依赖 src/main/shortcuts 的状态机副作用绑定，Electron/window/store 全部 mock
 * [OUTPUT]: 验证 HIDE/SHOW 副作用委托给窗口可见性层，而非直接操作 BaseWindow
 * [POS]: tests 的快捷键运行时守卫，防止全屏隐藏再次绕开 window 生命周期
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const uioHandlers = {} as Record<string, Array<(e: unknown) => void>>
  return {
    appOn: vi.fn(),
    appQuit: vi.fn(),
    register: vi.fn(() => true),
    unregisterAll: vi.fn(),
    isTrustedAccessibilityClient: vi.fn(() => true),
    uioHandlers,
    uioOn: vi.fn((event: string, cb: (e: unknown) => void) => {
      uioHandlers[event] ??= []
      uioHandlers[event].push(cb)
    }),
    uioStart: vi.fn(),
    uioStop: vi.fn()
  }
})

const win = vi.hoisted(() => ({
  rawHide: vi.fn(),
  rawShow: vi.fn(),
  hideFloatWindow: vi.fn(),
  showFloatWindow: vi.fn(),
  toggleCinema: vi.fn(),
  togglePlaybackFullscreen: vi.fn(),
  adjustPassthroughOpacity: vi.fn(),
  passthrough: true
}))

const media = vi.hoisted(() => ({
  pageMuted: false as boolean | null,
  audioMuted: false,
  setAudioMuted: vi.fn(),
  send: vi.fn(),
  executeJavaScript: vi.fn()
}))

vi.mock('electron', () => ({
  app: { on: electron.appOn, quit: electron.appQuit },
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
  uIOhook: { on: electron.uioOn, start: electron.uioStart, stop: electron.uioStop },
  UiohookKey: { X: 7, ArrowUp: 57416, ArrowDown: 57424, ArrowLeft: 57419, ArrowRight: 57421 }
}))

vi.mock('../src/main/store', () => ({
  store: {
    data: {
      shortcuts: {
        hide: 'Control+Z',
        peek: 'Control+X',
        boss: 'Control+C',
        quit: 'Control+Q',
        playpause: 'Control+P',
        mute: 'Control+M',
        volumeUp: 'Control+Up',
        volumeDown: 'Control+Down',
        mode: 'Control+B',
        passthrough: 'Control+T',
        fullscreen: 'Control+Enter',
        opacityUp: 'Control+Shift+Up',
        opacityDown: 'Control+Shift+Down',
        seekBack: 'Control+Left',
        seekForward: 'Control+Right'
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
  adjustPassthroughOpacity: win.adjustPassthroughOpacity,
  isPassthrough: () => win.passthrough,
  togglePassthrough: vi.fn(),
  hideFloatWindow: win.hideFloatWindow,
  showFloatWindow: win.showFloatWindow
}))

vi.mock('../src/main/modes', () => ({
  toggleCinema: win.toggleCinema,
  togglePlaybackFullscreen: win.togglePlaybackFullscreen
}))

describe('shortcuts effects', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(electron.uioHandlers)) delete electron.uioHandlers[key]
    media.pageMuted = false
    media.audioMuted = false
    win.passthrough = true
    media.executeJavaScript.mockImplementation(() => Promise.resolve(media.pageMuted))
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('Vanish 只隐藏、静音并暂停，不重绑快捷键或停止 uiohook', async () => {
    const { registerShortcuts, dispatchBoss } = await import('../src/main/shortcuts')

    registerShortcuts()
    electron.register.mockClear()
    electron.unregisterAll.mockClear()
    electron.uioStop.mockClear()
    media.executeJavaScript.mockClear()

    dispatchBoss()

    expect(win.hideFloatWindow).toHaveBeenCalledTimes(1)
    expect(media.setAudioMuted).toHaveBeenCalledWith(true)
    expect(media.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('querySelectorAll'),
      true
    )
    expect(electron.unregisterAll).not.toHaveBeenCalled()
    expect(electron.register).not.toHaveBeenCalled()
    expect(electron.uioStop).not.toHaveBeenCalled()
  })

  it('Control+Q 注册为全局退出快捷键', async () => {
    const { registerShortcuts } = await import('../src/main/shortcuts')

    registerShortcuts()

    const quitHandler = electron.register.mock.calls.find(([acc]) => acc === 'Control+Q')?.[1] as
      | (() => void)
      | undefined
    quitHandler?.()

    expect(electron.register).toHaveBeenCalledWith('Control+Q', expect.any(Function))
    expect(electron.appQuit).toHaveBeenCalledTimes(1)
  })

  it('Peek 注册 globalShortcut 吞掉 keydown，keyup 仍由 uiohook 释放', async () => {
    const { registerShortcuts, dispatchHideToggle } = await import('../src/main/shortcuts')

    registerShortcuts()
    dispatchHideToggle()
    win.hideFloatWindow.mockClear()
    win.showFloatWindow.mockClear()

    const peekHandler = electron.register.mock.calls.find(([acc]) => acc === 'Control+X')?.[1] as
      | (() => void)
      | undefined
    peekHandler?.()

    expect(electron.register).toHaveBeenCalledWith('Control+X', expect.any(Function))
    expect(win.showFloatWindow).toHaveBeenCalledTimes(1)

    const keyup = electron.uioHandlers.keyup[0] as (e: { keycode: number }) => void
    keyup({ keycode: 7 })

    expect(win.hideFloatWindow).toHaveBeenCalledTimes(1)
  })

  it('macOS 系统桌面快捷键会进入健康检查，而不是被当作安全键位', async () => {
    const { getShortcutHealth, probeShortcut, registerShortcuts } =
      await import('../src/main/shortcuts')

    registerShortcuts()
    const seekForward = getShortcutHealth().find((h) => h.action === 'seekForward')!
    const volumeUp = getShortcutHealth().find((h) => h.action === 'volumeUp')!

    expect(seekForward.ok).toBe(false)
    expect(seekForward.critical).toBe(false)
    expect(seekForward.reason).toContain('Mission Control')
    expect(volumeUp.ok).toBe(false)
    expect(probeShortcut('seekForward', 'Control+Right')).toEqual({
      ok: false,
      reason: 'This shortcut overlaps macOS Mission Control / Spaces'
    })
  })

  it('方向键动作走 uiohook：音量 5% 步进，透明度用 Ctrl+Shift，快进快退不变', async () => {
    const { registerShortcuts } = await import('../src/main/shortcuts')

    registerShortcuts()
    const keydown = electron.uioHandlers.keydown[0] as (e: {
      keycode: number
      altKey: boolean
      shiftKey: boolean
      ctrlKey: boolean
      metaKey: boolean
    }) => void

    media.audioMuted = true
    media.executeJavaScript.mockResolvedValue(true)
    keydown({ keycode: 57416, altKey: false, shiftKey: false, ctrlKey: true, metaKey: false })
    keydown({ keycode: 57424, altKey: false, shiftKey: false, ctrlKey: true, metaKey: false })
    await Promise.resolve()
    keydown({ keycode: 57416, altKey: false, shiftKey: true, ctrlKey: true, metaKey: false })
    keydown({ keycode: 57424, altKey: false, shiftKey: true, ctrlKey: true, metaKey: false })
    keydown({ keycode: 57419, altKey: false, shiftKey: false, ctrlKey: true, metaKey: false })
    keydown({ keycode: 57421, altKey: false, shiftKey: false, ctrlKey: true, metaKey: false })

    expect(electron.register).not.toHaveBeenCalledWith('Control+Up', expect.any(Function))
    expect(electron.register).not.toHaveBeenCalledWith('Control+Shift+Up', expect.any(Function))
    expect(electron.register).not.toHaveBeenCalledWith('Control+Right', expect.any(Function))
    expect(media.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('v.volume + 0.1'),
      true
    )
    expect(media.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('v.volume + -0.1'),
      true
    )
    expect(media.send).toHaveBeenCalledWith('ui:reveal-control', 'volume')
    expect(media.send).toHaveBeenCalledWith('ui:reveal-control', 'opacity')
    expect(media.setAudioMuted).toHaveBeenCalledWith(false)
    expect(media.send).toHaveBeenCalledWith('state:muted', false)
    expect(win.adjustPassthroughOpacity).toHaveBeenNthCalledWith(1, 0.05)
    expect(win.adjustPassthroughOpacity).toHaveBeenNthCalledWith(2, -0.05)
    expect(media.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('+ -10'), true)
    expect(media.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('+ 10'), true)
  })

  it('没有主视频时音量快捷键不解除 WebContents 静音', async () => {
    const { registerShortcuts } = await import('../src/main/shortcuts')

    registerShortcuts()
    const keydown = electron.uioHandlers.keydown[0] as (e: {
      keycode: number
      altKey: boolean
      shiftKey: boolean
      ctrlKey: boolean
      metaKey: boolean
    }) => void

    media.audioMuted = true
    media.executeJavaScript.mockResolvedValue(false)
    keydown({ keycode: 57416, altKey: false, shiftKey: false, ctrlKey: true, metaKey: false })
    await Promise.resolve()

    expect(media.setAudioMuted).not.toHaveBeenCalled()
    expect(media.send).not.toHaveBeenCalledWith('state:muted', false)
  })
})
