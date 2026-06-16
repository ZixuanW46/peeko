/**
 * [INPUT]: 依赖 src/main/window 的浮窗全屏生命周期，Electron/store/liquid-glass 全部 mock
 * [OUTPUT]: 验证全屏隐藏先退出原生全屏，待 leave-full-screen 后再隐藏窗口
 * [POS]: tests 的 macOS 全屏生命周期守卫，防止隐藏全屏窗口留下黑屏 Space
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  class MockBaseWindow {
    static last: MockBaseWindow | null = null

    private handlers = new Map<string, Array<(...args: unknown[]) => void>>()

    contentView = { addChildView: vi.fn() }
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setFullScreenable = vi.fn()
    setFullScreen = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    setOpacity = vi.fn()
    setBounds = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    showInactive = vi.fn()
    hide = vi.fn()
    getBounds = vi.fn(() => ({ x: 80, y: 80, width: 960, height: 600 }))
    getContentBounds = vi.fn(() => ({ width: 960, height: 600 }))

    constructor() {
      MockBaseWindow.last = this
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }
  }

  class MockWebContentsView {
    static last: MockWebContentsView | null = null

    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      loadURL: vi.fn(),
      send: vi.fn()
    }

    setBounds = vi.fn()

    constructor() {
      MockWebContentsView.last = this
    }
  }

  class MockBrowserWindow {
    static last: MockBrowserWindow | null = null

    private handlers = new Map<string, Array<(...args: unknown[]) => void>>()

    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    loadURL = vi.fn()
    loadFile = vi.fn()
    show = vi.fn()
    moveTop = vi.fn()
    focus = vi.fn()
    once = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    })
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    })

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args)
    }

    constructor() {
      MockBrowserWindow.last = this
    }
  }

  return {
    MockBaseWindow,
    MockBrowserWindow,
    MockWebContentsView,
    appGetPath: vi.fn(() => '/tmp/peeko-test-user-data'),
    screenOn: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: electron.appGetPath },
  BaseWindow: electron.MockBaseWindow,
  BrowserWindow: electron.MockBrowserWindow,
  WebContentsView: electron.MockWebContentsView,
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }],
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
    on: electron.screenOn
  },
  session: {
    fromPartition: () => ({
      setUserAgent: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn()
    })
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../src/main/store', () => ({
  HOME_URL: 'https://example.com',
  store: {
    data: { browseBounds: null, lastUrl: '', passthroughOpacity: 0.55 },
    patch: vi.fn()
  }
}))

vi.mock('../src/main/liquid-glass', () => ({ applyLiquidGlass: vi.fn() }))

describe('window fullscreen visibility', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  it('全屏隐藏先退出全屏，leave-full-screen 后恢复几何并隐藏', async () => {
    const { createFloatWindow, toggleWindowFullscreen, hideFloatWindow } =
      await import('../src/main/window')

    createFloatWindow('https://example.com/watch')
    const win = electron.MockBaseWindow.last!

    toggleWindowFullscreen()
    hideFloatWindow()

    expect(win.setFullScreen).toHaveBeenLastCalledWith(false)
    expect(win.hide).not.toHaveBeenCalled()

    win.emit('leave-full-screen')

    expect(win.setBounds).toHaveBeenCalledWith({ x: 80, y: 80, width: 960, height: 600 })
    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(win.showInactive).toHaveBeenCalledTimes(1)
  })

  it('全屏退出过程中再次显示会取消待隐藏', async () => {
    const { createFloatWindow, toggleWindowFullscreen, hideFloatWindow, showFloatWindow } =
      await import('../src/main/window')

    createFloatWindow('https://example.com/watch')
    const win = electron.MockBaseWindow.last!

    toggleWindowFullscreen()
    hideFloatWindow()
    showFloatWindow()
    win.emit('leave-full-screen')

    expect(win.hide).not.toHaveBeenCalled()
    expect(win.showInactive).toHaveBeenCalledTimes(2)
  })

  it('输入编辑期间临时降到 floating 层，结束后恢复 screen-saver', async () => {
    const { createFloatWindow, setEditingLevel } = await import('../src/main/window')

    createFloatWindow('https://example.com/search')
    const win = electron.MockBaseWindow.last!
    win.setAlwaysOnTop.mockClear()

    setEditingLevel(true)
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'floating')

    setEditingLevel(false)
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'screen-saver')
  })

  it('原生全屏时输入编辑不抢回置顶层级', async () => {
    const { createFloatWindow, toggleWindowFullscreen, setEditingLevel } =
      await import('../src/main/window')

    createFloatWindow('https://example.com/editor')
    const win = electron.MockBaseWindow.last!

    toggleWindowFullscreen()
    win.setAlwaysOnTop.mockClear()

    setEditingLevel(true)

    expect(win.setAlwaysOnTop).not.toHaveBeenCalled()
  })

  it('设置窗打开时主浮窗降到 floating，避免盖住设置窗和输入法候选窗', async () => {
    const { createFloatWindow, openSettings } = await import('../src/main/window')

    createFloatWindow('https://example.com/watch')
    const win = electron.MockBaseWindow.last!
    win.setAlwaysOnTop.mockClear()
    openSettings()

    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'floating')
    expect(electron.MockBrowserWindow.last!.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
  })

  it('设置窗先打开时，后创建的主浮窗也直接降到 floating', async () => {
    const { createFloatWindow, openSettings } = await import('../src/main/window')

    openSettings()
    createFloatWindow('https://example.com/watch')
    const win = electron.MockBaseWindow.last!

    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'floating')
  })

  it('设置窗关闭后主浮窗恢复 screen-saver，编辑未结束时继续保持 floating', async () => {
    const { createFloatWindow, openSettings, setEditingLevel } = await import('../src/main/window')

    createFloatWindow('https://example.com/editor')
    const win = electron.MockBaseWindow.last!
    openSettings()
    const settings = electron.MockBrowserWindow.last!

    win.setAlwaysOnTop.mockClear()
    setEditingLevel(true)
    settings.emit('closed')

    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'floating')

    setEditingLevel(false)

    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'screen-saver')
  })

  it('设置窗打开时退出原生全屏，主浮窗仍保持 floating', async () => {
    const { createFloatWindow, toggleWindowFullscreen, openSettings } =
      await import('../src/main/window')

    createFloatWindow('https://example.com/watch')
    const win = electron.MockBaseWindow.last!

    toggleWindowFullscreen()
    openSettings()
    win.setAlwaysOnTop.mockClear()

    win.emit('leave-full-screen')

    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'floating')
  })

  it('全屏中开启穿透会先退出全屏，再应用穿透透明度', async () => {
    const { createFloatWindow, toggleWindowFullscreen, setPassthrough } =
      await import('../src/main/window')

    createFloatWindow('https://example.com/watch')
    const win = electron.MockBaseWindow.last!
    const view = electron.MockWebContentsView.last!

    toggleWindowFullscreen()
    win.setFullScreen.mockClear()

    setPassthrough(true)

    expect(win.setFullScreen).toHaveBeenCalledWith(false)
    expect(view.webContents.send).not.toHaveBeenCalledWith('page:exit-video-fullscreen')
    expect(win.setOpacity).toHaveBeenLastCalledWith(0.55)
    expect(view.webContents.send).toHaveBeenCalledWith('state:passthrough', true)
  })

  it('退出全屏恢复小窗时重放穿透 surface 不变量', async () => {
    const { createFloatWindow, toggleWindowFullscreen, setPassthrough } =
      await import('../src/main/window')

    createFloatWindow('https://example.com/watch')
    const win = electron.MockBaseWindow.last!

    setPassthrough(true)
    setPassthrough(false)
    toggleWindowFullscreen()
    win.setOpacity.mockClear()
    win.setIgnoreMouseEvents.mockClear()

    win.emit('leave-full-screen')

    expect(win.setOpacity).toHaveBeenLastCalledWith(1)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
  })
})
