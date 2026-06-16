/**
 * [INPUT]: 依赖 src/main/modes 的观影⇄浏览编排，window/store/sites 全部 mock
 * [OUTPUT]: 验证浏览器窗口全屏与网页视频 fullscreen 互不耦合
 * [POS]: tests 的模式边界守卫，防止观影 CSS 与浏览全屏语义再次缠在一起
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const f = vi.hoisted(() => ({
  bounds: { x: 20, y: 20, width: 640, height: 360 },
  hide: vi.fn(),
  showInactive: vi.fn(),
  isVisible: vi.fn(() => true),
  setBounds: vi.fn(),
  getBounds: vi.fn(() => ({ x: 20, y: 20, width: 640, height: 360 })),
  getURL: vi.fn(() => 'https://example.com/watch'),
  send: vi.fn(),
  executeJavaScript: vi.fn(() => Promise.resolve(true))
}))

const win = vi.hoisted(() => ({
  fullscreen: false,
  setBoundsSink: vi.fn(),
  clampBounds: vi.fn((b) => b),
  exitWindowFullscreen: vi.fn(() => true),
  setPassthrough: vi.fn(),
  toggleWindowFullscreen: vi.fn(() => true)
}))

const site = vi.hoisted(() => ({
  injectRule: vi.fn(() => Promise.resolve()),
  ejectRule: vi.fn(() => Promise.resolve())
}))

const storeRef = vi.hoisted(() => {
  const data = {
    browseBounds: null as typeof f.bounds | null,
    cinemaBounds: null as typeof f.bounds | null,
    autoCinema: true
  }
  return {
    data,
    patch: vi.fn((partial: Partial<typeof data>) => Object.assign(data, partial))
  }
})

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })
  }
}))

vi.mock('../src/main/window', () => ({
  clampBounds: win.clampBounds,
  exitWindowFullscreen: win.exitWindowFullscreen,
  getFloat: () => ({
    win: {
      getBounds: f.getBounds,
      hide: f.hide,
      isVisible: f.isVisible,
      setBounds: f.setBounds,
      showInactive: f.showInactive
    },
    pageView: {
      webContents: {
        getURL: f.getURL,
        send: f.send,
        executeJavaScript: f.executeJavaScript
      }
    }
  }),
  isWindowFullscreen: () => win.fullscreen,
  setBoundsSink: win.setBoundsSink,
  setPassthrough: win.setPassthrough,
  toggleWindowFullscreen: win.toggleWindowFullscreen
}))

vi.mock('../src/main/store', () => ({
  store: storeRef
}))

vi.mock('../src/main/sites/index', () => ({
  injectRule: site.injectRule,
  ejectRule: site.ejectRule
}))

describe('mode fullscreen orchestration', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    win.fullscreen = false
    storeRef.data.browseBounds = null
    storeRef.data.cinemaBounds = null
    f.isVisible.mockReturnValue(true)
  })

  it('从观影模式进入浏览器全屏时退出观影但不请求网页视频 fullscreen', async () => {
    const { enterCinema, togglePlaybackFullscreen } = await import('../src/main/modes')

    await enterCinema()
    await togglePlaybackFullscreen()

    expect(site.ejectRule).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledWith('mode:cinema', false)
    expect(win.toggleWindowFullscreen).toHaveBeenCalledTimes(1)
    expect(f.executeJavaScript).not.toHaveBeenCalled()
  })

  it('普通进入浏览器全屏不请求网页视频 fullscreen', async () => {
    const { togglePlaybackFullscreen } = await import('../src/main/modes')

    await togglePlaybackFullscreen()

    expect(win.toggleWindowFullscreen).toHaveBeenCalledTimes(1)
    expect(f.executeJavaScript).not.toHaveBeenCalled()
  })

  it('进入观影模式时关闭穿透，避免半透明但不穿透的假状态', async () => {
    const { enterCinema } = await import('../src/main/modes')

    await enterCinema()

    expect(win.setPassthrough).toHaveBeenCalledWith(false)
    expect(f.send).toHaveBeenCalledWith('mode:cinema', true)
  })

  it('退出观影模式时关闭穿透并刷新旧小窗 surface', async () => {
    vi.useFakeTimers()
    const { enterCinema, exitCinema } = await import('../src/main/modes')

    await enterCinema()
    await exitCinema(true)

    expect(win.setPassthrough).toHaveBeenCalledWith(false)
    expect(f.hide).toHaveBeenCalledTimes(1)
    expect(site.ejectRule).toHaveBeenCalledTimes(1)
    expect(f.setBounds).toHaveBeenLastCalledWith({ x: 20, y: 20, width: 640, height: 360 })

    vi.advanceTimersByTime(30)
    expect(f.showInactive).toHaveBeenCalledTimes(1)
  })
})
