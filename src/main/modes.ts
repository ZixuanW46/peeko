/**
 * [INPUT]: 依赖 electron 的 screen，./window 浮窗单例，./store 几何持久化，./sites 注入执行器
 * [OUTPUT]: 对外提供 enterCinema/exitCinema/toggleCinema/isCinema 与浏览语义视频全屏编排
 * [POS]: main 的模式编排层——浏览⇄观影的唯一切换通道
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { screen } from 'electron'
import {
  clampBounds,
  exitWindowFullscreen,
  getFloat,
  isWindowFullscreen,
  setPassthrough,
  setBoundsSink,
  toggleWindowFullscreen
} from './window'
import { store, type Bounds } from './store'
import { injectRule, ejectRule } from './sites/index'

let cinema = false

// 接管几何路由：观影小窗与浏览大窗各记各的
setBoundsSink((b) => store.patch(cinema ? { cinemaBounds: b } : { browseBounds: b }))
// 用户双击主动退出后，本页不再自动进观影（Phase 5 探测器消费）
let manualExit = false

export const isCinema = (): boolean => cinema
export const getManualExit = (): boolean => manualExit
export const resetManualExit = (): void => {
  manualExit = false
}

// 默认观影窗：当前屏幕右下角 480x270，留 24px 呼吸
function defaultCinemaBounds(): Bounds {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - 480 - 24,
    y: workArea.y + workArea.height - 270 - 24,
    width: 480,
    height: 270
  }
}

export async function enterCinema(): Promise<void> {
  const f = getFloat()
  if (!f || cinema) return
  exitWindowFullscreen()
  setPassthrough(false)
  cinema = true
  store.patch({ browseBounds: f.win.getBounds() })
  f.win.setBounds(clampBounds(store.data.cinemaBounds ?? defaultCinemaBounds()))
  await injectRule(f.pageView.webContents, f.pageView.webContents.getURL())
  f.pageView.webContents.send('mode:cinema', true)
}

export async function exitCinema(byUser = false, refreshLayer = true): Promise<void> {
  const f = getFloat()
  if (!f || !cinema) return
  const wasFullscreen = isWindowFullscreen()
  const wasVisible = f.win.isVisible()
  const shouldRefreshLayer = refreshLayer && !wasFullscreen && wasVisible
  setPassthrough(false)
  if (shouldRefreshLayer) f.win.hide()
  exitWindowFullscreen()
  cinema = false
  manualExit = byUser
  store.patch({ cinemaBounds: f.win.getBounds() })
  await ejectRule(f.pageView.webContents)
  f.pageView.webContents.send('mode:cinema', false)
  const back = store.data.browseBounds
  if (back) f.win.setBounds(clampBounds(back))
  if (shouldRefreshLayer) setTimeout(() => f.win.showInactive(), 30)
}

export const toggleCinema = (): Promise<void> => (cinema ? exitCinema(true) : enterCinema())

const JS_REQUEST_VIDEO_FULLSCREEN = `(() => {
  const allVideos = (root, acc = []) => {
    root.querySelectorAll?.('video').forEach(v => acc.push(v))
    root.querySelectorAll?.('*').forEach(el => {
      if (el.shadowRoot) allVideos(el.shadowRoot, acc)
    })
    return acc
  }
  const area = (el) => {
    const r = el.getBoundingClientRect()
    return r.width * r.height
  }
  const v = allVideos(document).sort((a, b) => area(b) - area(a))[0]
  if (!v?.requestFullscreen) return false
  const vr = v.getBoundingClientRect()
  const videoArea = Math.max(1, vr.width * vr.height)
  let target = v
  for (let n = v.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const r = n.getBoundingClientRect()
    const parentArea = r.width * r.height
    if (r.width >= vr.width * .9 && r.height >= vr.height * .9 && parentArea <= videoArea * 6) target = n
  }
  const req = target.requestFullscreen ?? v.requestFullscreen
  return Promise.resolve(req.call(target, { navigationUI: 'hide' })).then(() => true).catch(() => false)
})()`

function requestVideoFullscreen(): void {
  getFloat()
    ?.pageView.webContents.executeJavaScript(JS_REQUEST_VIDEO_FULLSCREEN, true)
    .catch(() => {})
}

export function exitPlaybackFullscreen(): void {
  getFloat()?.pageView.webContents.send('page:exit-video-fullscreen')
  exitWindowFullscreen()
}

export async function togglePlaybackFullscreen(): Promise<void> {
  if (!getFloat()) return
  if (isWindowFullscreen()) {
    exitPlaybackFullscreen()
    return
  }
  if (cinema) await exitCinema(true, false)
  if (toggleWindowFullscreen()) requestVideoFullscreen()
}

// ============================================================
// intro 模式演示几何：浏览大窗(左上) vs 观影小窗(右下)，拉开位置尺寸对比。
// 仅演示，不持久化；intro 前快照真实窗位、结束还原，绝不污染用户几何。
// ============================================================
function demoBrowseBounds(): Bounds {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(860, Math.round(workArea.width * 0.52))
  const height = Math.min(560, Math.round(workArea.height * 0.62))
  return { x: workArea.x + 28, y: workArea.y + 28, width, height }
}

export function setIntroDemoGeometry(mode: string): void {
  const f = getFloat()
  if (!f) return
  f.win.setBounds(clampBounds(mode === 'cinema' ? defaultCinemaBounds() : demoBrowseBounds()))
}

let introBoundsSnapshot: { browse: Bounds | null; cinema: Bounds | null } | null = null

export function snapshotBoundsForIntro(): void {
  introBoundsSnapshot = { browse: store.data.browseBounds, cinema: store.data.cinemaBounds }
}

export function restoreBoundsAfterIntro(): void {
  if (!introBoundsSnapshot) return
  store.patch({
    browseBounds: introBoundsSnapshot.browse,
    cinemaBounds: introBoundsSnapshot.cinema
  })
  introBoundsSnapshot = null
  const f = getFloat()
  if (f && store.data.browseBounds) f.win.setBounds(clampBounds(store.data.browseBounds))
}

// 永不自动观影的页面：导航/门户页（内嵌花絮视频不代表用户要看它）
const NO_AUTO_PAGES = ['xiaohongshu.com/worldcup26']

// 探测器命中后的仲裁：总开关、门户页黑名单、用户本页主动退出，三关全过才自动进
export async function autoEnterCinema(): Promise<void> {
  const url = getFloat()?.pageView.webContents.getURL() ?? ''
  if (NO_AUTO_PAGES.some((p) => url.includes(p))) return
  if (isWindowFullscreen()) return
  if (store.data.autoCinema && !cinema && !manualExit) await enterCinema()
}

// 导航（含 SPA 路由）重置仲裁位——换了房间，自动观影资格恢复
export function watchNavigation(): void {
  const wc = getFloat()?.pageView.webContents
  if (!wc) return
  wc.on('did-navigate', () => resetManualExit())
  wc.on('did-navigate-in-page', () => resetManualExit())
}
