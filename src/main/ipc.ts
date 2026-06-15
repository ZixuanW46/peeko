/**
 * [INPUT]: 依赖 electron 的 ipcMain，依赖 ./window 的 getFloat，依赖 ./store 的几何持久化
 * [OUTPUT]: 对外提供 registerIpc()——全部 ipcMain 通道的唯一注册点
 * [POS]: main 的 IPC 协议层，与 preload/page.ts、preload/ui.ts 通道对偶
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app, BrowserWindow, clipboard, ipcMain, session } from 'electron'
import { shell, systemPreferences } from 'electron'
import {
  getFloat,
  getOnboarding,
  persistBounds,
  togglePassthrough,
  setBarHover,
  setEditingLevel,
  openSettings,
  setPassthroughOpacity,
  openOnboarding,
  closeOnboarding,
  compactOnboardingForPermission,
  restoreOnboardingBounds,
  raiseOnboarding,
  setOnboardingIgnoreMouse,
  getFloatOverlayRect,
  shouldRunOnboardingIntro,
  toggleWindowFullscreen,
  exitWindowFullscreen,
  setPassthrough,
  PAGE_SESSION_PARTITION,
  isWindowFullscreen
} from './window'
import {
  isCinema,
  enterCinema,
  exitCinema,
  autoEnterCinema,
  toggleCinema,
  togglePlaybackFullscreen,
  exitPlaybackFullscreen,
  setIntroDemoGeometry,
  snapshotBoundsForIntro,
  restoreBoundsAfterIntro
} from './modes'
import {
  togglePlayPause,
  toggleMute,
  rebindShortcuts,
  dispatchHideToggle,
  dispatchBoss,
  prepareDemo,
  getShortcutFailures,
  getShortcutHealth,
  probeShortcut,
  setShortcut,
  beginShortcutRecording,
  endShortcutRecording,
  isRecordingShortcuts,
  applyRecommendedShortcuts
} from './shortcuts'
import { store, DEFAULT_SHORTCUTS, HOME_URL, type Action } from './store'
import { refreshTray, addCurrentToFavorites } from './tray'
import { startRuntime } from './runtime'
import { setDockVisibility } from './dock'
import { getLanguageSettings, setLanguagePreference } from './i18n'
import { isLanguagePreference } from '../shared/i18n'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  onUpdateState
} from './updater'

interface Point {
  x: number
  y: number
}

// 拖动抓点：光标与窗口左上角的固定偏移，move 时窗口贴着偏移走
let grab: Point | null = null

function broadcastLanguage(): void {
  const language = getLanguageSettings()
  getFloat()?.pageView.webContents.send('i18n:language', language)
  getOnboarding()?.webContents.send('i18n:language', language)
  refreshTray()
}

function broadcastShortcuts(): void {
  getFloat()?.pageView.webContents.send('shortcuts:changed', store.data.shortcuts)
}

export function registerIpc(): void {
  onUpdateState((next) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send('updates:state', next)
    }
    refreshTray()
  })

  ipcMain.on('win:drag-start', (_e, p: Point) => {
    const f = getFloat()
    if (!f) return
    const b = f.win.getBounds()
    grab = { x: p.x - b.x, y: p.y - b.y }
  })

  ipcMain.on('win:drag-move', (_e, p: Point) => {
    const f = getFloat()
    if (!f || !grab) return
    const { width, height } = f.win.getBounds()
    const next = { x: Math.round(p.x - grab.x), y: Math.round(p.y - grab.y), width, height }
    f.win.setBounds(next)
    persistBounds(next)
  })

  // 双击画面：仅在观影模式下生效——返回浏览模式（用户主动退出）
  ipcMain.on('page:dblclick', () => {
    if (isCinema()) void exitCinema(true)
  })

  // 探测器命中主视频（连续 3 秒真实播放）→ 自动进观影
  ipcMain.on('video:main-detected', () => void autoEnterCinema())

  // 悬停控制条四键——与全局快捷键共用同一批执行器
  ipcMain.on('ctrl:playpause', () => togglePlayPause())
  ipcMain.on('ctrl:mute', () => void toggleMute())
  ipcMain.on('ctrl:mode', () => void toggleCinema())
  ipcMain.on('ctrl:passthrough', () => togglePassthrough())
  ipcMain.on('ctrl:hide', () => dispatchHideToggle())
  ipcMain.on('ctrl:boss', () => dispatchBoss())
  ipcMain.on('ctrl:settings', () => openSettings())
  ipcMain.on('ctrl:quit', () => app.quit())
  ipcMain.on('ctrl:home', () => getFloat()?.pageView.webContents.loadURL(HOME_URL))
  ipcMain.on('ctrl:fullscreen', () => void togglePlaybackFullscreen())
  ipcMain.on('ctrl:exit-fullscreen', () => exitPlaybackFullscreen())

  // 音量滑条拖动时确保可听：解除 Chromium 级静音并回推状态
  ipcMain.on('ctrl:audible', () => {
    const wc = getFloat()?.pageView.webContents
    if (!wc) return
    wc.setAudioMuted(false)
    wc.send('state:muted', false)
  })

  // 控制条收藏面板：列表读取与收藏当前页
  ipcMain.handle('fav:list', () => store.data.favorites)
  ipcMain.handle('fav:add', () => {
    addCurrentToFavorites()
    return store.data.favorites
  })

  // 控制条悬停豁免：穿透模式下悬停其上临时恢复鼠标
  ipcMain.on('bar:hover', (_e, hovering: boolean) => setBarHover(hovering))

  // 工具栏由隐转显——引导第五关的推进信号
  ipcMain.on('bar:shown', () => {
    getOnboarding()?.webContents.send('demo:key', { action: 'bar-hover', mode: 'NORMAL' })
    raiseOnboarding()
  })

  // 网址输入期间临时降层，给输入法候选窗让位
  ipcMain.on('bar:editing', (_e, editing: boolean) => setEditingLevel(editing))

  // 浏览动作：返回上一页 / 地址导航（无协议自动补 https）
  ipcMain.on('ctrl:back', () => {
    const wc = getFloat()?.pageView.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  })
  ipcMain.on('ctrl:navigate', (_e, raw: string) => {
    const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`
    getFloat()?.pageView.webContents.loadURL(url)
  })

  // 探测器诊断流（仅 PEEKO_DEBUG 时落日志）
  ipcMain.on('debug:detector', (_e, s) => {
    if (process.env.PEEKO_DEBUG) console.log('[detector]', JSON.stringify(s))
  })

  // 设置窗通道
  ipcMain.handle('i18n:get-language', () => getLanguageSettings())

  ipcMain.handle('settings:get', () => ({
    shortcuts: store.data.shortcuts,
    favorites: store.data.favorites,
    autoCinema: store.data.autoCinema,
    passthroughOpacity: store.data.passthroughOpacity,
    showInDock: store.data.showInDock,
    shortcutFailures: getShortcutFailures(),
    shortcutHealth: getShortcutHealth(),
    language: getLanguageSettings()
  }))

  ipcMain.handle('settings:get-shortcuts', () => store.data.shortcuts)

  ipcMain.handle('updates:get-state', () => getUpdateState())
  ipcMain.handle('updates:check', () => checkForUpdates(true))
  ipcMain.handle('updates:download', () => downloadUpdate())
  ipcMain.handle('updates:install', () => installUpdate())

  ipcMain.handle('settings:set-language', (_e, preference: unknown) => {
    if (!isLanguagePreference(preference)) return getLanguageSettings()
    const language = setLanguagePreference(preference)
    broadcastLanguage()
    return language
  })

  ipcMain.handle('settings:set-auto-cinema', (_e, on: boolean) => {
    store.patch({ autoCinema: on })
    return on
  })

  ipcMain.handle('settings:set-passthrough-opacity', (_e, v: number) => {
    setPassthroughOpacity(v)
    return store.data.passthroughOpacity
  })

  ipcMain.handle('settings:set-show-in-dock', (_e, show: boolean) => setDockVisibility(show))

  ipcMain.handle('settings:reset-shortcuts', () => {
    store.patch({ shortcuts: { ...DEFAULT_SHORTCUTS } })
    rebindShortcuts()
    broadcastShortcuts()
    return { shortcuts: store.data.shortcuts, shortcutHealth: getShortcutHealth() }
  })

  ipcMain.handle('settings:copy-diagnostics', () => {
    const wc = getFloat()?.pageView.webContents
    const currentUrl = wc?.getURL() ?? ''
    const host = currentUrl
      ? (() => {
          try {
            return new URL(currentUrl).host
          } catch {
            return 'unavailable'
          }
        })()
      : 'none'
    const text = [
      `Peeko ${app.getVersion()}`,
      `Platform: ${process.platform} ${process.arch}`,
      `macOS Accessibility: ${
        process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true
      }`,
      `Mode: ${isCinema() ? 'cinema' : 'browse'}`,
      `Peeko fullscreen: ${isWindowFullscreen()}`,
      `Current host: ${host}`,
      `Dock visible: ${store.data.showInDock}`,
      `Auto cinema: ${store.data.autoCinema}`,
      `Shortcut health: ${JSON.stringify(getShortcutHealth())}`
    ].join('\n')
    clipboard.writeText(text)
    return text
  })

  ipcMain.handle('settings:clear-browser-session', async () => {
    const ses = session.fromPartition(PAGE_SESSION_PARTITION)
    await ses.clearStorageData()
    await ses.clearCache()
    store.patch({ lastUrl: '' })
    getFloat()?.pageView.webContents.loadURL(HOME_URL)
    return true
  })

  ipcMain.handle('settings:clear-favorites', () => {
    store.patch({ favorites: [] })
    refreshTray()
    return store.data.favorites
  })

  ipcMain.handle('settings:reset-preferences', () => {
    store.patch({
      lastUrl: '',
      browseBounds: null,
      cinemaBounds: null,
      shortcuts: { ...DEFAULT_SHORTCUTS },
      autoCinema: false,
      passthroughOpacity: 0.55,
      showInDock: false,
      language: 'system'
    })
    setDockVisibility(false)
    rebindShortcuts()
    broadcastLanguage()
    broadcastShortcuts()
    return {
      shortcuts: store.data.shortcuts,
      autoCinema: store.data.autoCinema,
      passthroughOpacity: store.data.passthroughOpacity,
      showInDock: store.data.showInDock,
      shortcutHealth: getShortcutHealth(),
      language: getLanguageSettings()
    }
  })

  // 引导通道：完成/跳过、辅助功能授权流、设置里重看
  ipcMain.on('onboarding:done', () => {
    void (async () => {
      if (isCinema()) await exitCinema()
      exitWindowFullscreen()
      setPassthrough(false)
      restoreBoundsAfterIntro()
      store.patch({ onboarded: true })
      closeOnboarding()
    })()
  })
  ipcMain.on('onboarding:close', () => {
    void (async () => {
      if (isCinema()) await exitCinema()
      exitWindowFullscreen()
      setPassthrough(false)
      restoreBoundsAfterIntro()
      closeOnboarding()
    })()
  })
  ipcMain.on('onboarding:quit', () => app.quit())
  ipcMain.handle('onboarding:ax-trusted', () =>
    process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true
  )
  ipcMain.handle('onboarding:restore', () => restoreOnboardingBounds())
  ipcMain.handle('onboarding:start-runtime', () => {
    startRuntime()
    snapshotBoundsForIntro() // 快照真实窗位，模式演示后还原
    restoreOnboardingBounds()
    raiseOnboarding()
  })
  ipcMain.handle('onboarding:set-mode', async (_e, mode: string, demoGeometry = false) => {
    if (mode === 'cinema') {
      setPassthrough(false)
      await enterCinema()
    } else {
      if (isCinema()) await exitCinema()
      setPassthrough(mode === 'passthrough')
    }
    // 仅模式说明环节摆演示位（浏览左上大窗 / 观影右下小窗）；闯关与终幕不动几何
    if (demoGeometry) setIntroDemoGeometry(mode)
  })
  ipcMain.handle('onboarding:should-run-intro', () => shouldRunOnboardingIntro())
  ipcMain.handle('onboarding:shortcut-health', () => getShortcutHealth())
  ipcMain.handle('onboarding:apply-recommended-shortcuts', () => {
    const result = applyRecommendedShortcuts()
    broadcastShortcuts()
    return result
  })
  ipcMain.on('onboarding:prep', (_e, target: 'NORMAL' | 'HIDDEN') => {
    prepareDemo(target)
    raiseOnboarding()
  })
  // 蒙版聚光灯：浮窗相对蒙版的矩形，渲染层据此挖洞突显浮窗
  ipcMain.handle('onboarding:float-rect', () => getFloatOverlayRect())
  // 工具栏"试一下"：蒙版鼠标穿透开关
  ipcMain.on('onboarding:ignore-mouse', (_e, on: boolean) => setOnboardingIgnoreMouse(on))
  // 全屏模式演示：真·进入/退出 Peeko 窗口全屏（守卫避免重复 toggle 误退出）
  ipcMain.on('onboarding:fullscreen-demo', (_e, on: boolean) => {
    if (on && !isWindowFullscreen()) toggleWindowFullscreen()
    else if (!on) exitWindowFullscreen()
  })
  ipcMain.on('onboarding:open-ax', () => {
    compactOnboardingForPermission()
    void shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    )
  })
  ipcMain.on('settings:replay-intro', () => openOnboarding(true))
  ipcMain.on('settings:open', () => openSettings())

  ipcMain.handle('settings:rename-favorite', (_e, url: string, name: string) => {
    store.patch({
      favorites: store.data.favorites.map((f) => (f.url === url ? { ...f, name } : f))
    })
    refreshTray()
    return store.data.favorites
  })

  ipcMain.handle('settings:begin-shortcut-recording', (e) => {
    beginShortcutRecording()
    // 安全网：录制中设置窗被销毁（关窗/崩溃/重载）→ 强制结束录制并重注册，
    // 否则 beginShortcutRecording 注销的全局键会一直卡在注销态直到重启。
    e.sender.once('destroyed', () => {
      if (isRecordingShortcuts()) endShortcutRecording()
    })
  })
  ipcMain.handle('settings:end-shortcut-recording', () => endShortcutRecording())
  ipcMain.handle('settings:probe-shortcut', (_e, action: Action, accelerator: string) =>
    probeShortcut(action, accelerator)
  )
  ipcMain.handle('settings:set-shortcut', (_e, action: Action, accelerator: string) => {
    const result = setShortcut(action, accelerator)
    if (result.ok) broadcastShortcuts()
    return result
  })

  ipcMain.handle('settings:remove-favorite', (_e, url: string) => {
    store.patch({ favorites: store.data.favorites.filter((f) => f.url !== url) })
    refreshTray()
    return store.data.favorites
  })
}
