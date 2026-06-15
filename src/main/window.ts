/**
 * [INPUT]: 依赖 electron 的 BaseWindow/WebContentsView/session，依赖 ./store 的几何与 lastUrl，依赖 ./liquid-glass 设置窗材质
 * [OUTPUT]: 对外提供 createFloatWindow()、float 单例、可见性门闩、原生全屏、穿透透明度、onboarding 层级与权限窗切换、Liquid Glass 设置窗
 * [POS]: main 的窗口核心——置顶浮窗 + 网页视图装配，全项目技术风险的承载点
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app, BaseWindow, BrowserWindow, WebContentsView, screen, session, shell } from 'electron'
import { existsSync, renameSync } from 'fs'
import { join } from 'path'
import { store, HOME_URL, type Bounds } from './store'
import { applyLiquidGlass } from './liquid-glass'

const DEFAULT_BOUNDS: Bounds = { x: 80, y: 80, width: 960, height: 600 }
const PAGE_PARTITION = 'persist:peeko'

export interface Float {
  win: BaseWindow
  pageView: WebContentsView
}

let float: Float | null = null
let passthrough = false
let fullscreen = false
let fullscreenRestoreBounds: Bounds | null = null
let hideAfterFullscreenExit = false
let suppressBoundsPersist = false
let clampWatchInstalled = false

export const getFloat = (): Float | null => float
export const PAGE_SESSION_PARTITION = PAGE_PARTITION

export function clampBounds(bounds: Bounds): Bounds {
  const displays = screen.getAllDisplays()
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  }
  const display =
    displays.find(({ workArea }) => {
      return (
        center.x >= workArea.x &&
        center.x <= workArea.x + workArea.width &&
        center.y >= workArea.y &&
        center.y <= workArea.y + workArea.height
      )
    }) ?? screen.getDisplayNearestPoint({ x: Math.round(center.x), y: Math.round(center.y) })
  const { workArea } = display
  const width = Math.min(Math.max(bounds.width, 280), workArea.width)
  const height = Math.min(Math.max(bounds.height, 158), workArea.height)
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
    width,
    height
  }
}

export function clampFloatToVisible(): void {
  if (!float || fullscreen) return
  setFloatBounds(float.win.getBounds(), false)
}

function installClampWatch(): void {
  if (clampWatchInstalled) return
  clampWatchInstalled = true
  const clamp = (): void => clampFloatToVisible()
  screen.on('display-added', clamp)
  screen.on('display-removed', clamp)
  screen.on('display-metrics-changed', clamp)
}

// 几何持久化经由可替换的 sink 路由——modes.ts 按浏览/观影分流，
// window 自身不知道模式的存在（依赖倒置，免循环引用）
let boundsSink: (b: Bounds) => void = (b) => store.patch({ browseBounds: b })

export const setBoundsSink = (fn: (b: Bounds) => void): void => {
  boundsSink = fn
}

export const persistBounds = (b: Bounds): void => boundsSink(b)

// 鼠标穿透：正交标志位，不入状态机；forward 保 hover 不死。
// 穿透时窗口半透明（透明度可在设置中调）——既看得见视频，也看得清下层。
// 控制条享有穿透豁免：悬停其上时临时恢复鼠标，离开即恢复穿透
let barHovering = false

function applyMouseIgnore(): void {
  float?.win.setIgnoreMouseEvents(passthrough && !barHovering, { forward: true })
}

function sendPassthroughState(): void {
  float?.pageView.webContents.send('state:passthrough', passthrough)
  float?.pageView.webContents.send('state:passthrough-opacity', store.data.passthroughOpacity)
}

export function togglePassthrough(): boolean {
  return setPassthrough(!passthrough)
}

export function setPassthrough(on: boolean): boolean {
  if (!on) barHovering = false
  if (on && fullscreen) exitWindowFullscreen()
  passthrough = on
  applyMouseIgnore()
  float?.win.setOpacity(passthrough ? store.data.passthroughOpacity : 1)
  sendPassthroughState()
  return passthrough
}

export function isPassthrough(): boolean {
  return passthrough
}

// 设置里调透明度：落盘 + 穿透进行中则实时预览
export function setPassthroughOpacity(value: number): void {
  const v = Math.min(0.9, Math.max(0.1, value))
  store.patch({ passthroughOpacity: v })
  if (passthrough) float?.win.setOpacity(v)
  sendPassthroughState()
}

export function adjustPassthroughOpacity(delta: number): number {
  setPassthroughOpacity(store.data.passthroughOpacity + delta)
  return store.data.passthroughOpacity
}

export function setBarHover(hovering: boolean): void {
  barHovering = hovering
  applyMouseIgnore()
}

// 输入网址期间降到 floating 层（仍盖普通窗口），让输入法候选窗浮上来；
// 网页输入框同走这条路；结束输入立刻回 screen-saver 层恢复盖全屏能力
export function setEditingLevel(editing: boolean): void {
  if (fullscreen) return
  float?.win.setAlwaysOnTop(true, editing ? 'floating' : 'screen-saver')
}

function setFloatBounds(bounds: Bounds, save = true): void {
  if (!float) return
  suppressBoundsPersist = !save
  float.win.setBounds(clampBounds(bounds))
  if (!save) setTimeout(() => (suppressBoundsPersist = false), 200)
}

function sendFullscreenState(): void {
  float?.pageView.webContents.send('state:fullscreen', fullscreen)
}

function restoreFloatAfterFullscreen(): void {
  if (!float) return
  const shouldHide = hideAfterFullscreenExit
  hideAfterFullscreenExit = false
  fullscreen = false
  float.win.setFullScreenable(false)
  float.win.setAlwaysOnTop(true, 'screen-saver')
  float.win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  if (fullscreenRestoreBounds) setFloatBounds(fullscreenRestoreBounds, false)
  fullscreenRestoreBounds = null
  if (shouldHide) float.win.hide()
  else float.win.showInactive()
  sendFullscreenState()
}

export function hideFloatWindow(): void {
  if (!float) return
  if (!fullscreen) {
    float.win.hide()
    return
  }

  hideAfterFullscreenExit = true
  if (!exitWindowFullscreen()) {
    hideAfterFullscreenExit = false
    float.win.hide()
  }
}

export function showFloatWindow(): void {
  hideAfterFullscreenExit = false
  if (!fullscreen) float?.win.showInactive()
}

export function isWindowFullscreen(): boolean {
  return fullscreen
}

export function exitWindowFullscreen(): boolean {
  if (!float || !fullscreen) return false
  float.pageView.webContents.send('page:exit-video-fullscreen')
  float.win.setFullScreen(false)
  return true
}

export function toggleWindowFullscreen(): boolean {
  if (!float) return false
  if (fullscreen) return exitWindowFullscreen()

  fullscreenRestoreBounds = float.win.getBounds()
  hideAfterFullscreenExit = false
  if (passthrough) setPassthrough(false)
  fullscreen = true
  float.win.setIgnoreMouseEvents(false)
  float.win.setAlwaysOnTop(false)
  float.win.setVisibleOnAllWorkspaces(false)
  float.win.setFullScreenable(true)
  float.win.show()
  float.win.focus()
  float.win.setFullScreen(true)
  sendFullscreenState()
  return true
}

// ============================================================
// UA 伪装：取真实内核版本拼标准 Chrome UA，避免 Electron 标记暴露
// ============================================================
function chromeUserAgent(): string {
  return (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
  )
}

function homeRuntimeUrl(): string {
  return process.env.PEEKO_URL || store.data.lastUrl || HOME_URL
}

function migrateLegacyPagePartition(): void {
  const root = join(app.getPath('userData'), 'Partitions')
  const next = join(root, 'peeko')
  const legacy = join(root, 'moyu')
  if (existsSync(next) || !existsSync(legacy)) return
  try {
    renameSync(legacy, next)
  } catch {
    // Cookie/cache 迁移失败不阻塞启动；新会话仍使用 peeko 命名。
  }
}

// ============================================================
// 置顶浮窗：覆盖全屏应用的参数组合（缺一不可）
//   screen-saver 层级 + visibleOnFullScreen + fullscreenable:false
// ============================================================
export function createFloatWindow(initialUrl?: string): Float {
  if (float) {
    if (initialUrl) float.pageView.webContents.loadURL(initialUrl)
    return float
  }

  const win = new BaseWindow({
    ...clampBounds(store.data.browseBounds ?? DEFAULT_BOUNDS),
    type: 'panel', // NSPanel：唯一能稳定浮于全屏 Space 之上的窗口类
    frame: false,
    fullscreenable: false,
    hiddenInMissionControl: true,
    minWidth: 280,
    minHeight: 158
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  installClampWatch()

  migrateLegacyPagePartition()
  const ses = session.fromPartition(PAGE_PARTITION)
  ses.setUserAgent(chromeUserAgent())
  // 远程视频页只负责播放内容，不拥有系统权限入口。
  // HTML fullscreen 是播放器基础能力；摄像头/麦克风/定位/通知等仍一律拒绝。
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'fullscreen')
  )
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen')

  const pageView = new WebContentsView({
    webPreferences: {
      partition: PAGE_PARTITION,
      preload: join(__dirname, '../preload/page.js'),
      backgroundThrottling: false,
      sandbox: true // 远程内容必须进沙箱；preload 仅用 ipcRenderer，沙箱兼容
    }
  })
  win.contentView.addChildView(pageView)

  const syncViewBounds = (): void => {
    const { width, height } = win.getContentBounds()
    pageView.setBounds({ x: 0, y: 0, width, height })
  }
  syncViewBounds()
  win.on('resize', syncViewBounds)

  const saveBounds = (): void => {
    if (!suppressBoundsPersist && !fullscreen) persistBounds(win.getBounds())
  }
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)

  // 新窗口请求（target=_blank）一律在浮窗内打开，绝不弹新窗
  pageView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) pageView.webContents.loadURL(url)
    else shell.openExternal(url)
    return { action: 'deny' }
  })

  pageView.webContents.on('did-navigate', (_e, url) => {
    if (url.startsWith('http')) store.patch({ lastUrl: url })
  })
  pageView.webContents.on('did-finish-load', () => {
    sendFullscreenState()
    sendPassthroughState()
  })

  // 页面侧故障显影：渲染进程崩溃与页面级错误必须留痕
  pageView.webContents.on('render-process-gone', (_e, details) => {
    console.error('[page] renderer gone:', details.reason, details.exitCode)
  })
  pageView.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code !== -3) console.error('[page] load failed:', code, desc, url)
  })
  pageView.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) console.error('[page:console]', message.slice(0, 300))
  })
  pageView.webContents.on('preload-error', (_e, path, error) => {
    console.error('[page] preload 崩溃:', path, error.message)
  })

  pageView.webContents.loadURL(initialUrl ?? homeRuntimeUrl())
  win.showInactive()

  // 探测器心跳源：主进程定时器免疫页面反调试灭表；debug 开关随心跳下发
  const debug = Boolean(process.env.PEEKO_DEBUG)
  const detectorPulse = setInterval(() => {
    if (!pageView.webContents.isDestroyed()) pageView.webContents.send('detector:tick', debug)
  }, 500)

  win.on('closed', () => {
    clearInterval(detectorPulse)
    float = null
    fullscreen = false
    fullscreenRestoreBounds = null
    hideAfterFullscreenExit = false
  })
  win.on('enter-full-screen', () => {
    fullscreen = true
    sendFullscreenState()
  })
  win.on('leave-full-screen', () => restoreFloatAfterFullscreen())

  float = { win, pageView }
  return float
}

// ============================================================
// 引导蒙版窗：全屏 vibrancy 磨砂透见桌面，压在浮窗之上，单例
// ============================================================
let onboarding: BrowserWindow | null = null
let forceIntro = false

export const getOnboarding = (): BrowserWindow | null => onboarding
export const isOnboarding = (): boolean => onboarding !== null
export const shouldRunOnboardingIntro = (): boolean => forceIntro || !store.data.onboarded

export function openOnboarding(replayIntro = false): void {
  forceIntro = forceIntro || replayIntro
  if (onboarding) {
    onboarding.show()
    onboarding.moveTop()
    return
  }
  const { bounds, workArea } = screen.getPrimaryDisplay()

  // 浮窗去右下角待命（让出中央教学区），引导结束恢复原位
  const f = getFloat()
  const parked = f?.win.getBounds() ?? null
  f?.win.setBounds({
    x: workArea.x + workArea.width - 480 - 24,
    y: workArea.y + workArea.height - 270 - 24,
    width: 480,
    height: 270
  })

  // transparent + panel：高透灰纱由 CSS 绘制（不糊桌面），panel 类可盖菜单栏
  onboarding = new BrowserWindow({
    ...bounds,
    type: 'panel',
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: { preload: join(__dirname, '../preload/ui.js') }
  })
  onboarding.setAlwaysOnTop(true, 'screen-saver')
  onboarding.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  onboarding.setBounds(bounds) // panel 创建后再钉一次，确保含菜单栏区域
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) onboarding.loadURL(`${dev}/onboarding/index.html`)
  else onboarding.loadFile(join(__dirname, '../renderer/onboarding/index.html'))
  onboarding.on('closed', () => {
    onboarding = null
    forceIntro = false
    if (parked) getFloat()?.win.setBounds(parked) // 浮窗归位
  })
}

export function closeOnboarding(): void {
  onboarding?.close()
}

export function compactOnboardingForPermission(): void {
  if (!onboarding) return
  const { workArea } = screen.getPrimaryDisplay()
  onboarding.setBounds({
    x: workArea.x + workArea.width - 560 - 24,
    y: workArea.y + 72,
    width: 560,
    height: 460
  })
  onboarding.setAlwaysOnTop(true, 'floating')
  onboarding.moveTop()
}

export function restoreOnboardingBounds(): void {
  if (!onboarding) return
  const { bounds } = screen.getPrimaryDisplay()
  onboarding.setAlwaysOnTop(true, 'screen-saver')
  onboarding.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  onboarding.setBounds(bounds)
  onboarding.moveTop()
}

export function raiseOnboarding(): void {
  if (!onboarding) return
  onboarding.setAlwaysOnTop(true, 'screen-saver')
  onboarding.moveTop()
}

// 工具栏"试一下"：蒙版鼠标穿透（forward 保留 mousemove，渲染层据此在按钮上夺回点击），
// 让用户能真去 hover 下面的浮窗唤起工具栏，而卡片仍视觉在最上
export function setOnboardingIgnoreMouse(on: boolean): void {
  onboarding?.setIgnoreMouseEvents(on, { forward: true })
}

// 浮窗相对蒙版窗口的矩形（CSS px=屏幕点，蒙版铺满 display）。
// 供蒙版"聚光灯挖洞"突显浮窗；浮窗不存在/已隐藏返回 null（蒙版全屏灰纱）
export function getFloatOverlayRect(): { x: number; y: number; w: number; h: number } | null {
  if (!onboarding || !float || !float.win.isVisible()) return null
  const o = onboarding.getBounds()
  const b = float.win.getBounds()
  return { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height }
}

// ============================================================
// 设置窗：原生 HUD 玻璃，单例
// ============================================================
let settings: BrowserWindow | null = null

export function openSettings(): void {
  if (settings) {
    settings.show()
    settings.moveTop()
    settings.focus()
    return
  }
  settings = new BrowserWindow({
    width: 420,
    height: 540,
    resizable: false,
    fullscreenable: false,
    transparent: true, // 原生 Liquid Glass 要求 webContents 透明
    vibrancy: 'sidebar', // 非 mac26 的回落材质
    backgroundColor: '#00000000',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/ui.js') }
  })
  settings.setAlwaysOnTop(true, 'screen-saver')
  settings.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) settings.loadURL(`${dev}/settings/index.html`)
  else settings.loadFile(join(__dirname, '../renderer/settings/index.html'))
  // mac26 注入真 Liquid Glass，与托盘同源（成功则撤掉 sidebar vibrancy 回落）
  applyLiquidGlass(settings, { cornerRadius: 12 })
  settings.once('ready-to-show', () => {
    settings?.show()
    settings?.moveTop()
    settings?.focus()
  })
  settings.on('closed', () => {
    settings = null
  })
}
