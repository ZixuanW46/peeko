/**
 * [INPUT]: 依赖 electron 的 ipcRenderer（隔离世界，目标网页不可见）
 * [OUTPUT]: 注入目标网页：移窗（浏览⌥拖/观影裸拖/拖把手，拖后吞 click）、双击返回、
 *           ESC 锁、主视频探测器（主进程心跳驱动）、播放徽章、观影提示、
 *           悬停控制条（Feather/Lucide 线条图标、动态换态、resize 几何同步、收藏面板、竖向音量滑条、穿透透明度滑条、⚽主页）
 * [POS]: preload 的网页侧探针，与 main/ipc.ts 通道协议对偶。
 *        纪律：核心（拖动/探测/锁）在前，装饰（徽章/控制条）在后且 try/catch 隔离；
 *        全文件禁用 innerHTML——部分站点的 Trusted Types CSP 会让它当场抛异常；
 *        页内定时器不可信——小红书反调试会灭表，采样心跳必须来自主进程 IPC
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ipcRenderer } from 'electron'
import { tx, type LanguageSettings, type ResolvedLanguage } from '../shared/i18n'
import {
  DEFAULT_SHORTCUTS,
  prettyShortcut,
  type Action,
  type ShortcutMap
} from '../shared/shortcuts'
import {
  effectiveVolumeFor,
  formatShortAddress,
  shouldCapturePageShortcut,
  shouldForwardPageDoubleClick
} from './ui-logic'

// 开机心跳：preload 是否在此页面存活的铁证
ipcRenderer.send('debug:detector', { boot: true, href: location.href.slice(0, 80) })

let language: ResolvedLanguage = 'en'
const tr = (en: string, zh: string): string => tx(language, en, zh)

function applyLanguage(next: LanguageSettings): void {
  language = next.resolved
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  updateLocalizedChrome()
}

void ipcRenderer
  .invoke('i18n:get-language')
  .then(applyLanguage)
  .catch(() => {})
ipcRenderer.on('i18n:language', (_e, next: LanguageSettings) => applyLanguage(next))

// ============================================================
// 核心 1：移动窗口。
// 浏览模式：⌥ + 拖（裸拖会劫持页面内的选字/滚动/进度条拖拽）；
// 观影模式：裸拖（纯视频无页面交互），4px 阈值与单击/双击互斥
// ============================================================
let dragging = false
let pendingDrag: { x: number; y: number } | null = null
let didDrag = false // 拖完吞掉随后的合成 click，防止误触播放器的点击切换
let tapTimer: ReturnType<typeof setTimeout> | null = null // 观影单击播放的去抖定时器（与双击返回浏览区分）

function isOwnUi(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest('[data-peeko-badge]') !== null
}

function trusted(e: Event): boolean {
  return e.isTrusted
}

window.addEventListener(
  'mousedown',
  (e) => {
    if (!trusted(e) || e.button !== 0) return
    didDrag = false // 每次左键按下都重置——含点自身 UI（退出叉/工具条）：否则上一轮拖拽残留的 didDrag 会让全局 click 拦截器吞掉本次点击
    if (isOwnUi(e.target)) return
    if (e.altKey) {
      dragging = true
      didDrag = true
      ipcRenderer.send('win:drag-start', { x: e.screenX, y: e.screenY })
      e.preventDefault()
      e.stopPropagation()
    } else if (cinema) {
      pendingDrag = { x: e.screenX, y: e.screenY } // 越过阈值才升级为拖动
    }
  },
  true
)

window.addEventListener(
  'mousemove',
  (e) => {
    if (!trusted(e)) return
    if (dragging) {
      ipcRenderer.send('win:drag-move', { x: e.screenX, y: e.screenY })
      return
    }
    if (pendingDrag && Math.hypot(e.screenX - pendingDrag.x, e.screenY - pendingDrag.y) > 4) {
      dragging = true
      didDrag = true
      ipcRenderer.send('win:drag-start', pendingDrag)
      ipcRenderer.send('win:drag-move', { x: e.screenX, y: e.screenY })
    }
  },
  true
)

// window 级捕获跑在站点任何处理器之前——拖动后的合成 click 在此拦截
window.addEventListener(
  'click',
  (e) => {
    if (didDrag) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    // 观影模式：单击画面 = 播放/暂停，由 Peeko 接管（站点播放器在首启未激活时点击失灵）。
    // 拦截不让站点收到（避免双重切换）；250ms 去抖与"双击返回浏览"区分——双击时由 dblclick 取消。
    if (cinema && trusted(e) && !isOwnUi(e.target)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (tapTimer) clearTimeout(tapTimer)
      tapTimer = setTimeout(() => {
        tapTimer = null
        ipcRenderer.send('ctrl:playpause')
      }, 250)
    }
  },
  true
)

window.addEventListener(
  'mouseup',
  () => {
    dragging = false
    pendingDrag = null
  },
  true
)
window.addEventListener('blur', () => {
  dragging = false
  pendingDrag = null
})

// ============================================================
// 核心 2：双击返回浏览模式（是否生效由主进程按模式裁决；拖动后不算）
// ============================================================
window.addEventListener(
  'dblclick',
  (e) => {
    if (tapTimer) {
      clearTimeout(tapTimer) // 双击：撤销第一击挂起的单击播放，避免"切播放 + 返回浏览"双重动作
      tapTimer = null
    }
    if (
      shouldForwardPageDoubleClick({
        trusted: trusted(e),
        didDrag,
        ownUi: isOwnUi(e.target)
      })
    )
      ipcRenderer.send('page:dblclick')
  },
  true
)

// ============================================================
// 核心 3：模式状态 + ESC 锁
// ============================================================
let cinema = false
let floatFullscreen = false

ipcRenderer.on('mode:cinema', (_e, on: boolean) => {
  cinema = on
  try {
    refreshBadge()
    updateBar()
    if (on) showToast()
  } catch {
    /* 装饰层故障不影响核心 */
  }
})

window.addEventListener(
  'keydown',
  (e) => {
    if (document.fullscreenElement && e.key === 'Escape') return
    if (trusted(e) && shouldCapturePageShortcut(e, shortcutCache)) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    if (floatFullscreen && e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      ipcRenderer.send('ctrl:exit-fullscreen')
      return
    }
    if (cinema && e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  },
  true
)

// ============================================================
// 核心 3.1：网页输入法让位。
// screen-saver 窗口层级会压住 macOS 输入法候选窗；只要焦点落在网页可编辑区域，
// 就临时降到 floating。输入事件仍归网页，Peeko 只调整窗口层级。
// ============================================================
function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-peeko-badge]')) return false
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return ![
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit'
    ].includes(target.type)
  }
  const editable = target.closest('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}

function hasEditableFocus(): boolean {
  const active = document.activeElement
  return isEditableElement(active)
}

function hasEditableTarget(e: Event): boolean {
  return e.composedPath().some((target) => isEditableElement(target))
}

function syncPageEditing(target: EventTarget | null = null): void {
  ipcRenderer.send('bar:editing', isEditableElement(target) || hasEditableFocus())
}

window.addEventListener('focusin', (e) => syncPageEditing(e.target), true)
window.addEventListener(
  'focusout',
  () => {
    setTimeout(syncPageEditing, 0)
  },
  true
)
window.addEventListener(
  'compositionstart',
  (e) => {
    if (hasEditableTarget(e)) ipcRenderer.send('bar:editing', true)
  },
  true
)
window.addEventListener(
  'compositionend',
  () => {
    setTimeout(syncPageEditing, 0)
  },
  true
)

// ============================================================
// 核心 4：主视频探测器——500ms 采样，连续 6 次（3 秒）通过 → 通知主进程
// 判定 = 可见(>200×150) + 就绪 + 播放中 + currentTime 真实前进
// ============================================================
let lastVideo: HTMLVideoElement | null = null
let lastTime = -1
let streak = 0

// 穿透 open Shadow DOM 收集全部 video（部分站点把播放器藏在影子树里）
function allVideos(root: ParentNode = document, acc: HTMLVideoElement[] = []): HTMLVideoElement[] {
  acc.push(...root.querySelectorAll('video'))
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) allVideos(el.shadowRoot, acc)
  }
  return acc
}

function biggestVideo(): HTMLVideoElement | null {
  return (
    allVideos().sort((a, b) => {
      const ra = a.getBoundingClientRect()
      const rb = b.getBoundingClientRect()
      return rb.width * rb.height - ra.width * ra.height
    })[0] ?? null
  )
}

function tick(debug = false): void {
  if (cinema) return
  const v = biggestVideo()
  const changed = v !== lastVideo
  const r = v?.getBoundingClientRect()
  if (debug)
    ipcRenderer.send('debug:detector', {
      n: allVideos().length,
      changed,
      w: r ? Math.round(r.width) : -1,
      h: r ? Math.round(r.height) : -1,
      ready: v?.readyState ?? -1,
      paused: v?.paused ?? null,
      dt: v ? +(v.currentTime - lastTime).toFixed(3) : null,
      streak
    })
  if (!v) {
    streak = 0
    return
  }
  if (changed) {
    lastVideo = v
    lastTime = v.currentTime
    streak = 0
    return
  }
  const playing =
    r!.width > 200 && r!.height > 150 && v.readyState >= 2 && !v.paused && v.currentTime > lastTime
  lastTime = v.currentTime
  streak = playing ? streak + 1 : 0
  if (streak >= 6) {
    streak = 0
    ipcRenderer.send('video:main-detected')
  }
}

// 采样心跳由主进程经 IPC 驱动——页面的"clearInterval 灭表"反调试
// 扫得到本帧所有 timer ID，但扫不到进程外（小红书实测会杀死本地 setInterval）
ipcRenderer.on('detector:tick', (_e, debug: boolean) => {
  try {
    tick(debug)
  } catch (err) {
    ipcRenderer.send('debug:detector', { error: String(err).slice(0, 200) })
  }
})

// ============================================================
// 装饰层：暂停徽章 + 观影提示。纯 createElement 构建（TT-safe），
// 任何故障被吞掉，绝不波及上面的核心
// ============================================================
function el(tag: string, css: string): HTMLElement {
  const node = document.createElement(tag)
  node.style.cssText = css
  return node
}

// 浮层的挂载根：站点元素全屏时只渲染全屏子树，浮层必须寄生其内
function uiRoot(): Element {
  return document.fullscreenElement ?? document.documentElement
}

document.addEventListener(
  'fullscreenchange',
  () => {
    const root = uiRoot()
    for (const n of [
      badge,
      toast,
      bar?.pill,
      bar?.favPanel,
      vol?.panel,
      opacity?.panel,
      handle,
      fullscreenBtn,
      vanishBtn
    ]) {
      if (n?.isConnected) root.appendChild(n)
    }
    updateBar()
  },
  true
)

// 注入元素统一玻璃：控制条 pill / 拖把手 / badge / 收藏面板共用。
// 与托盘 Liquid Glass 同源观感——但页内 DOM 用不了原生 NSGlassEffectView，
// 只能 CSS backdrop-filter 仿：更通透暗底（保白图标对比度）+ 强 blur+saturate 液态折射 + 软投影悬浮感 + 高光鑲边
const GLASS = `
  background: rgba(28,28,32,.45); backdrop-filter: blur(20px) saturate(1.7);
  -webkit-backdrop-filter: blur(20px) saturate(1.7);
  box-shadow: 0 4px 16px rgba(0,0,0,.34), inset 0 0 0 .5px rgba(255,255,255,.22);
`
const SIDE_BUTTON_BG = 'rgba(28,28,32,.45)'
const SIDE_BUTTON_HOVER_BG = 'rgba(255,255,255,.18)'
const SIDE_BUTTON_SIZE = 34
const SIDE_BUTTON_GAP = 12
const HANDLE_OFFSET = SIDE_BUTTON_SIZE + SIDE_BUTTON_GAP

function setSideButtonState(node: HTMLElement, hover: boolean, pressed = false): void {
  node.dataset.hover = hover ? '1' : ''
  node.dataset.pressed = pressed ? '1' : ''
  node.style.background = hover || pressed ? SIDE_BUTTON_HOVER_BG : SIDE_BUTTON_BG
}

function releaseSideButton(node: HTMLElement): void {
  setSideButtonState(node, node.dataset.hover === '1', false)
}

const badge = ((): HTMLElement | null => {
  try {
    const wrap = el(
      'div',
      `position: fixed; inset: 0; display: none; align-items: center;
       justify-content: center; pointer-events: none; z-index: 2147483647;`
    )
    wrap.setAttribute('data-peeko-badge', '')
    const disc = el(
      'div',
      `width: 64px; height: 64px; border-radius: 50%; display: flex;
       align-items: center; justify-content: center; ${GLASS}`
    )
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '28')
    svg.setAttribute('height', '28')
    svg.setAttribute('viewBox', '0 0 24 24')
    const play = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    play.setAttribute('points', '8 5 19 12 8 19 8 5')
    play.setAttribute('fill', 'rgba(255,255,255,.92)')
    svg.appendChild(play)
    disc.appendChild(svg)
    wrap.appendChild(disc)
    return wrap
  } catch {
    return null
  }
})()

function refreshBadge(): void {
  if (!badge) return
  const paused =
    (document.querySelector<HTMLVideoElement>('video[data-peeko-video]') ?? biggestVideo())
      ?.paused ?? false
  const show = cinema && paused
  if (show && !badge.isConnected) uiRoot().appendChild(badge)
  badge.style.display = show ? 'flex' : 'none'
}

// 媒体事件不冒泡但有捕获阶段——document 级一对监听覆盖所有 video
document.addEventListener('pause', () => refreshBadge(), true)
document.addEventListener('play', () => refreshBadge(), true)

const toast = ((): HTMLElement | null => {
  try {
    const pill = el(
      'div',
      `position: fixed; left: 14px; top: 14px;
       padding: 6px 14px; border-radius: 99px; ${GLASS}
       color: rgba(255,255,255,.85); font: 12px -apple-system, 'PingFang SC', sans-serif;
       white-space: nowrap;
       pointer-events: none; z-index: 2147483647;
       opacity: 0; transition: opacity .2s ease-out;`
    )
    pill.setAttribute('data-peeko-badge', '')
    pill.textContent = tr(
      'Entered Cinema Mode · Double-click to browse',
      '已进入观影模式 · 双击画面返回网页'
    )
    return pill
  } catch {
    return null
  }
})()

let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(
  text = tr('Entered Cinema Mode · Double-click to browse', '已进入观影模式 · 双击画面返回网页')
): void {
  if (!toast) return
  if (!toast.isConnected) uiRoot().appendChild(toast)
  toast.textContent = text
  toast.style.opacity = '1'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.style.opacity = '0'), 2000)
}

let hintUrl = ''

function scheduleAutoCinemaHint(): void {
  const url = location.href
  hintUrl = url
  setTimeout(() => {
    if (hintUrl !== url || cinema) return
    const v = biggestVideo()
    if (!v) showToast(tr('No main video found yet', '暂时没有找到主视频'))
    else if (v.paused)
      showToast(
        tr(
          'Press play first, then Peeko can enter Cinema Mode automatically',
          '先点播放，Peeko 会自动进入观影模式'
        )
      )
  }, 6000)
}

window.addEventListener('load', scheduleAutoCinemaHint)
window.addEventListener('popstate', scheduleAutoCinemaHint)

// ============================================================
// 悬停控制条：底部居中玻璃药丸，鼠标动则现、静 2 秒则隐。
// 按钮只是快捷键的回显（PRODUCT.md：快捷键是一等公民）。
// 图标：Feather Icons（MIT）内联 SVG，线条风格，按状态动态切换
// ============================================================
type Shape = [string, Record<string, string>]

const ICONS: Record<string, Shape[]> = {
  play: [['polygon', { points: '6 3 20 12 6 21 6 3' }]],
  pause: [
    ['rect', { x: '6', y: '4', width: '4', height: '16', rx: '1' }],
    ['rect', { x: '14', y: '4', width: '4', height: '16', rx: '1' }]
  ],
  vol: [
    ['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07' }]
  ],
  volx: [
    ['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['line', { x1: '23', y1: '9', x2: '17', y2: '15' }],
    ['line', { x1: '17', y1: '9', x2: '23', y2: '15' }]
  ],
  shrink: [
    ['polyline', { points: '4 14 10 14 10 20' }],
    ['polyline', { points: '20 10 14 10 14 4' }],
    ['line', { x1: '14', y1: '10', x2: '21', y2: '3' }],
    ['line', { x1: '3', y1: '21', x2: '10', y2: '14' }]
  ],
  expand: [
    ['polyline', { points: '15 3 21 3 21 9' }],
    ['polyline', { points: '9 21 3 21 3 15' }],
    ['line', { x1: '21', y1: '3', x2: '14', y2: '10' }],
    ['line', { x1: '3', y1: '21', x2: '10', y2: '14' }]
  ],
  cinema: [
    ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }],
    ['polygon', { points: '10 9 15 12 10 15 10 9' }]
  ],
  browser: [
    ['rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }],
    ['line', { x1: '3', y1: '8', x2: '21', y2: '8' }],
    ['line', { x1: '7', y1: '6', x2: '7.01', y2: '6' }],
    ['line', { x1: '10', y1: '6', x2: '10.01', y2: '6' }]
  ],
  pointer: [
    ['path', { d: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' }],
    ['path', { d: 'M13 13l6 6' }]
  ],
  back: [
    ['line', { x1: '19', y1: '12', x2: '5', y2: '12' }],
    ['polyline', { points: '12 19 5 12 12 5' }]
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
  ],
  eyeoff: [
    [
      'path',
      {
        d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24'
      }
    ],
    ['line', { x1: '1', y1: '1', x2: '23', y2: '23' }]
  ],
  star: [
    [
      'polygon',
      {
        points:
          '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'
      }
    ]
  ],
  x: [
    ['line', { x1: '18', y1: '6', x2: '6', y2: '18' }],
    ['line', { x1: '6', y1: '6', x2: '18', y2: '18' }]
  ],
  hand: [
    ['path', { d: 'M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2' }],
    ['path', { d: 'M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2' }],
    ['path', { d: 'M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8' }],
    [
      'path',
      {
        d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'
      }
    ]
  ],
  gear: [
    ['circle', { cx: '12', cy: '12', r: '3' }],
    [
      'path',
      {
        d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
      }
    ]
  ]
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function icon(name: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '15')
  svg.setAttribute('height', '15')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  for (const [tag, attrs] of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    svg.appendChild(node)
  }
  return svg
}

const BTN = `
  width: 30px; height: 30px; border: 0; border-radius: 50%;
  background: transparent; color: rgba(255,255,255,.85); cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 0;
`

const URL_CHIP = `
  height: 30px; min-width: 92px; max-width: min(168px, 32vw);
  border: 0; border-radius: 99px; box-sizing: border-box;
  background: rgba(255,255,255,.08); color: rgba(255,255,255,.78); cursor: text;
  display: flex; align-items: center; gap: 7px; padding: 0 10px;
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.18);
  font: 11px 'SF Mono', ui-monospace, monospace;
  overflow: hidden; flex: 0 1 168px;
  transition: background .12s ease-out, box-shadow .12s ease-out;
`

function capText(target: HTMLElement): string {
  const base = target.dataset.capBase ?? ''
  const action = target.dataset.shortcutAction as Action | undefined
  const shortcut = action ? shortcutCache[action] : ''
  const text = shortcut ? `${base} · ${prettyShortcut(shortcut)}` : base
  if (text) target.setAttribute('aria-label', text)
  return text
}

function setTip(target: HTMLElement, text: string, action?: Action): void {
  target.dataset.capBase = text
  if (action) target.dataset.shortcutAction = action
  else delete target.dataset.shortcutAction
  target.setAttribute('aria-label', capText(target))
  target.removeAttribute('title')
}

// 主进程推送的窗口级状态（页面事件感知不到的部分）
let wcMuted = false
let passthroughOn = false
let passOpacity = 0.55

let shortcutCache: ShortcutMap = { ...DEFAULT_SHORTCUTS }

async function refreshShortcuts(): Promise<void> {
  try {
    shortcutCache = (await ipcRenderer.invoke('settings:get-shortcuts')) as ShortcutMap
  } catch {
    shortcutCache = { ...DEFAULT_SHORTCUTS }
  }
}

void refreshShortcuts()
ipcRenderer.on('shortcuts:changed', (_e, next: ShortcutMap) => {
  shortcutCache = next
  updateLocalizedChrome()
})

ipcRenderer.on('state:muted', (_e, on: boolean) => {
  wcMuted = on
  updateBar()
})
ipcRenderer.on('state:passthrough', (_e, on: boolean) => {
  passthroughOn = on
  updateBar()
})
ipcRenderer.on('state:passthrough-opacity', (_e, value: number) => {
  passOpacity = Math.min(0.9, Math.max(0.1, value))
  renderOpacity(passOpacity)
})
ipcRenderer.on('state:fullscreen', (_e, on: boolean) => {
  floatFullscreen = on
  updateBar()
})
ipcRenderer.on('ui:reveal-control', (_e, control: 'volume' | 'opacity') => {
  revealControl(control)
})

interface Bar {
  pill: HTMLElement
  iconRow: HTMLElement
  urlInput: HTMLInputElement
  urlChip: HTMLElement
  urlText: HTMLElement
  favPanel: HTMLElement
  back: HTMLElement
  fav: HTMLElement
  ball: HTMLElement
  gear: HTMLElement
  hide: HTMLElement
  play: HTMLElement
  mute: HTMLElement
  mode: HTMLElement
  pass: HTMLElement
}

const bar = ((): Bar | null => {
  try {
    const pill = el(
      'div',
      `position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
       width: fit-content; box-sizing: border-box;
       padding: 4px 8px; border-radius: 99px; ${GLASS}
       z-index: 2147483647; opacity: 0;
       transition: opacity .2s ease-out, box-shadow .25s ease-out;
       pointer-events: none; overflow: hidden;`
    )
    pill.setAttribute('data-peeko-badge', '')

    const iconRow = el('div', `display: flex; justify-content: center; gap: 2px;`)
    pill.appendChild(iconRow)

    const mk = (handler: () => void, tip: string, action?: Action): HTMLElement => {
      const b = el('button', BTN)
      setTip(b, tip, action)
      b.addEventListener('mouseenter', () => {
        if (!b.dataset.active) b.style.background = 'rgba(255,255,255,.18)'
      })
      b.addEventListener('mouseleave', () => {
        if (!b.dataset.active) b.style.background = 'transparent'
      })
      b.addEventListener('click', (e) => {
        if (!trusted(e)) return
        e.stopPropagation()
        handler()
        setTimeout(updateBar, 80) // 播放/暂停经主进程注入，留一拍读回状态
      })
      // 控制条上双击不应触发"返回浏览模式"
      b.addEventListener('dblclick', (e) => e.stopPropagation())
      iconRow.appendChild(b)
      return b
    }

    const send = (channel: string) => (): void => ipcRenderer.send(channel)
    const back = mk(send('ctrl:back'), tr('Back', '返回上一页'))
    const urlChip = el('button', URL_CHIP)
    const urlGlyph = icon('link')
    urlGlyph.style.width = '12px'
    urlGlyph.style.height = '12px'
    urlGlyph.style.flex = 'none'
    urlGlyph.style.opacity = '.72'
    const urlText = el(
      'span',
      `display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
    )
    urlText.textContent = formatShortAddress(location.href)
    urlChip.append(urlGlyph, urlText)
    setTip(urlChip, tr('Short address bar: click to edit URL', '短地址栏：点击修改网址'))
    urlChip.addEventListener('mouseenter', () => {
      urlChip.style.background = 'rgba(255,255,255,.14)'
      urlChip.style.boxShadow = 'inset 0 0 0 .5px rgba(255,255,255,.3)'
    })
    urlChip.addEventListener('mouseleave', () => {
      urlChip.style.background = 'rgba(255,255,255,.08)'
      urlChip.style.boxShadow = 'inset 0 0 0 .5px rgba(255,255,255,.18)'
    })
    urlChip.addEventListener('click', (e) => {
      if (!trusted(e)) return
      e.stopPropagation()
      openUrlInput()
    })
    urlChip.addEventListener('dblclick', (e) => e.stopPropagation())
    iconRow.appendChild(urlChip)
    const fav = mk(() => void toggleFavPanel(), tr('Favorites', '收藏夹'))
    const ball = mk(send('ctrl:home'), tr('World Cup home', '世界杯直播主页'))
    ball.textContent = '⚽' // 黑白 emoji，天然灰阶
    ball.style.fontSize = '14px'
    const play = mk(send('ctrl:playpause'), tr('Play / pause', '播放 / 暂停'), 'playpause')
    const mute = mk(
      () => {
        if (!biggestVideo()) {
          wcMuted = false
          updateBar()
          return
        }
        ipcRenderer.send('ctrl:mute')
      },
      tr('Mute', '静音')
    )
    const mode = mk(send('ctrl:mode'), tr('Enter Cinema Mode', '进入观影模式'), 'mode')
    const pass = mk(send('ctrl:passthrough'), tr('Click-through', '鼠标穿透'), 'passthrough')
    const gear = mk(send('ctrl:settings'), tr('Settings', '设置'))
    const hide = mk(
      send('ctrl:hide'),
      tr('Hide window, keep audio playing', '隐藏窗口，声音继续'),
      'hide'
    )
    setIcon(hide, 'eyeoff')

    // 收藏面板：控制条上方的玻璃卡片
    const favPanel = el(
      'div',
      `position: fixed; left: 50%; bottom: 58px; transform: translateX(-50%);
       width: 250px; max-height: 250px; overflow-y: auto; display: none;
       flex-direction: column; padding: 5px; border-radius: 12px; ${GLASS}
       z-index: 2147483647;`
    )
    favPanel.setAttribute('data-peeko-badge', '')
    favPanel.addEventListener('dblclick', (e) => e.stopPropagation())
    pill.parentElement?.appendChild(favPanel) // 与 pill 同根挂载（mousemove 时统一处理）

    // 网址输入态：预填当前地址并全选——⌘C 即复制，⌘V+回车即加载，打字即手输
    const urlInput = document.createElement('input')
    urlInput.style.cssText = `
      display: none; position: absolute; left: 8px; right: 8px; top: 4px; height: 30px;
      box-sizing: border-box; border: 0; outline: 0; border-radius: 99px;
      background: rgba(255,255,255,.12); color: rgba(255,255,255,.9);
      box-shadow: inset 0 0 0 .5px rgba(255,255,255,.24);
      font: 12px 'SF Mono', ui-monospace, monospace; padding: 0 13px;
      opacity: 0; transform: scaleX(.48); transform-origin: center;
      transition: opacity .12s ease-out, transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease-out;
    `
    urlInput.addEventListener('keydown', (e) => {
      if (!trusted(e)) return
      e.stopPropagation()
      if (e.key === 'Escape') closeUrlInput()
      if (e.key === 'Enter') {
        const raw = urlInput.value.trim()
        if (raw) ipcRenderer.send('ctrl:navigate', raw)
        closeUrlInput()
      }
    })
    urlInput.addEventListener('blur', () => closeUrlInput())
    urlInput.addEventListener('dblclick', (e) => e.stopPropagation())
    pill.appendChild(urlInput)

    // 穿透豁免：悬停控制条/收藏面板时主进程临时恢复鼠标
    for (const node of [pill, favPanel]) {
      node.addEventListener('mouseenter', (e) => {
        if (trusted(e)) ipcRenderer.send('bar:hover', true)
      })
      node.addEventListener('mouseleave', (e) => {
        if (trusted(e)) ipcRenderer.send('bar:hover', false)
      })
    }

    // 悬停音量键弹出滑条
    mute.addEventListener('mouseenter', () => showVolPanel())
    mute.addEventListener('mouseleave', () => hideVolPanel())

    return {
      pill,
      iconRow,
      urlInput,
      urlChip,
      urlText,
      favPanel,
      back,
      fav,
      ball,
      gear,
      hide,
      play,
      mute,
      mode,
      pass
    }
  } catch {
    return null
  }
})()

updateShortAddress()
installAddressWatch()

// ============================================================
// 收藏面板：收藏当前页 + 已收藏列表（点击即开），删除/重命名在设置里
// ============================================================
const FAV_ROW = `
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-radius: 8px; cursor: pointer; color: rgba(255,255,255,.85);
  font: 12px -apple-system, 'PingFang SC', sans-serif;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`

function favRow(label: string, onClick: () => void): HTMLElement {
  const row = el('div', FAV_ROW)
  row.textContent = label
  row.addEventListener('mouseenter', () => (row.style.background = 'rgba(255,255,255,.14)'))
  row.addEventListener('mouseleave', () => (row.style.background = 'transparent'))
  row.addEventListener('click', (e) => {
    if (!trusted(e)) return
    e.stopPropagation()
    onClick()
  })
  return row
}

async function renderFavPanel(): Promise<void> {
  if (!bar) return
  const favs: Array<{ name: string; url: string }> = await ipcRenderer.invoke('fav:list')
  bar.favPanel.replaceChildren()
  bar.favPanel.appendChild(
    favRow(tr('⭐ Favorite Current Page', '⭐ 收藏当前页面'), async () => {
      await ipcRenderer.invoke('fav:add')
      void renderFavPanel()
    })
  )
  if (favs.length) {
    const sep = el('div', `height: 0.5px; background: rgba(255,255,255,.15); margin: 4px 8px;`)
    bar.favPanel.appendChild(sep)
  }
  for (const f of favs) {
    const row = favRow(f.name, () => {
      ipcRenderer.send('ctrl:navigate', f.url)
      closeFavPanel()
    })
    row.title = f.url
    bar.favPanel.appendChild(row)
  }
}

async function toggleFavPanel(): Promise<void> {
  if (!bar) return
  const open = bar.favPanel.style.display !== 'none' && bar.favPanel.style.display !== ''
  if (open) {
    closeFavPanel()
    return
  }
  await renderFavPanel()
  if (bar.favPanel.parentElement !== uiRoot()) uiRoot().appendChild(bar.favPanel)
  bar.favPanel.style.display = 'flex'
}

function closeFavPanel(): void {
  if (bar) bar.favPanel.style.display = 'none'
}

// 点击面板外任意处收起
window.addEventListener(
  'mousedown',
  (e) => {
    if (!bar) return
    const t = e.target as Node
    if (!bar.favPanel.contains(t) && !bar.fav.contains(t)) closeFavPanel()
  },
  true
)

// ============================================================
// 音量滑条：悬停音量键弹出竖向滑条（手搓 div——原生 range 的竖向
// 自定义样式要打样式表，会撞页面 CSP；div 全内联零依赖）
// ============================================================
interface VolSlider {
  panel: HTMLElement
  fill: HTMLElement
  thumb: HTMLElement
  track: HTMLElement
}

const vol = ((): VolSlider | null => {
  try {
    const panel = el(
      'div',
      `position: fixed; display: none; padding: 12px 14px; border-radius: 12px;
       ${GLASS} z-index: 2147483647; cursor: pointer;`
    )
    panel.setAttribute('data-peeko-badge', '')
    panel.addEventListener('dblclick', (e) => e.stopPropagation())

    const track = el(
      'div',
      `position: relative; width: 4px; height: 110px; margin: 0 auto;
       background: rgba(255,255,255,.28); border-radius: 2px;`
    )
    const fill = el(
      'div',
      `position: absolute; bottom: 0; left: 0; width: 100%; height: 100%;
       background: rgba(255,255,255,.92); border-radius: 2px;`
    )
    const thumb = el(
      'div',
      `position: absolute; left: 50%; bottom: 100%;
       transform: translate(-50%, 50%); width: 13px; height: 13px;
       border-radius: 50%; background: #fff;
       box-shadow: 0 1px 3px rgba(0,0,0,.35); pointer-events: none;`
    )
    track.appendChild(fill)
    track.appendChild(thumb)
    panel.appendChild(track)

    panel.addEventListener('mouseenter', (e) => {
      if (!trusted(e)) return
      volHover = true
      ipcRenderer.send('bar:hover', true)
    })
    panel.addEventListener('mouseleave', (e) => {
      if (!trusted(e)) return
      volHover = false
      hideVolPanel()
      ipcRenderer.send('bar:hover', false)
    })
    return { panel, fill, thumb, track }
  } catch {
    return null
  }
})()

let volHover = false
let volDragging = false
let volHideTimer: ReturnType<typeof setTimeout> | null = null

// 滑条显示的是有效音量：任何一层静音都算 0，从 0 拖起即解除静音
function effectiveVolume(): number {
  const v = biggestVideo()
  return effectiveVolumeFor(v ? { muted: v.muted, volume: v.volume } : null, wcMuted)
}

function renderVol(ratio: number): void {
  if (!vol) return
  const pct = Math.round(ratio * 100)
  vol.fill.style.height = `${pct}%`
  vol.thumb.style.bottom = `${pct}%`
}

function applyVolFromY(clientY: number): void {
  if (!vol) return
  const v = biggestVideo()
  if (!v) {
    renderVol(effectiveVolume())
    return
  }
  const r = vol.track.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (r.bottom - clientY) / r.height))
  renderVol(ratio)
  v.volume = ratio
  if (ratio > 0) {
    v.muted = false
    ipcRenderer.send('ctrl:audible') // 同步解除 Chromium 级静音
  }
}

if (vol) {
  vol.panel.addEventListener('mousedown', (e) => {
    if (!trusted(e)) return
    e.stopPropagation()
    volDragging = true
    applyVolFromY(e.clientY)
  })
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!trusted(e)) return
      if (volDragging) applyVolFromY(e.clientY)
    },
    true
  )
  window.addEventListener('mouseup', () => (volDragging = false), true)
}

function showVolPanel(): void {
  if (!vol || !bar) return
  renderVol(effectiveVolume())
  if (vol.panel.parentElement !== uiRoot()) uiRoot().appendChild(vol.panel)
  const r = bar.mute.getBoundingClientRect()
  vol.panel.style.left = `${r.left + r.width / 2}px`
  vol.panel.style.transform = 'translateX(-50%)'
  vol.panel.style.bottom = `${window.innerHeight - r.top + 8}px`
  vol.panel.style.display = 'block'
}

function hideVolPanel(): void {
  if (volHideTimer) clearTimeout(volHideTimer)
  volHideTimer = setTimeout(() => {
    if (!volHover && !volDragging && vol) vol.panel.style.display = 'none'
  }, 250)
}

// ============================================================
// 穿透透明度滑条：只在 click-through 现场出现，右侧竖向控制。
// 与设置窗同一份 store 值，拖动时按 5% 网格吸附，避免细碎状态。
// ============================================================
interface OpacitySlider {
  panel: HTMLElement
  fill: HTMLElement
  thumb: HTMLElement
  track: HTMLElement
  label: HTMLElement
}

const opacity = ((): OpacitySlider | null => {
  try {
    const panel = el(
      'div',
      `position: fixed; right: 14px; top: 50%; transform: translateY(-50%);
       display: none; padding: 11px 10px 9px; border-radius: 12px;
       ${GLASS} z-index: 2147483647; cursor: pointer;`
    )
    panel.setAttribute('data-peeko-badge', '')
    panel.addEventListener('dblclick', (e) => e.stopPropagation())

    const track = el(
      'div',
      `position: relative; width: 4px; height: 128px; margin: 0 auto;
       background: rgba(255,255,255,.28); border-radius: 2px;`
    )
    const fill = el(
      'div',
      `position: absolute; bottom: 0; left: 0; width: 100%; height: 55%;
       background: rgba(255,255,255,.92); border-radius: 2px;`
    )
    const thumb = el(
      'div',
      `position: absolute; left: 50%; bottom: 55%;
       transform: translate(-50%, 50%); width: 13px; height: 13px;
       border-radius: 50%; background: #fff;
       box-shadow: 0 1px 3px rgba(0,0,0,.35); pointer-events: none;`
    )
    const label = el(
      'div',
      `margin-top: 7px; min-width: 28px; text-align: center;
       font: 10px 'SF Mono', ui-monospace, monospace; color: rgba(255,255,255,.78);
       pointer-events: none;`
    )
    track.appendChild(fill)
    track.appendChild(thumb)
    panel.append(track, label)

    panel.addEventListener('mouseenter', (e) => {
      if (!trusted(e)) return
      opacityHover = true
      ipcRenderer.send('bar:hover', true)
      setOpacityShown(true)
    })
    panel.addEventListener('mouseleave', (e) => {
      if (!trusted(e)) return
      opacityHover = false
      ipcRenderer.send('bar:hover', false)
      if (!opacityDragging) setOpacityShown(barVisible && passthroughOn)
    })
    return { panel, fill, thumb, track, label }
  } catch {
    return null
  }
})()

let opacityHover = false
let opacityDragging = false

function opacityStep(value: number): number {
  return Math.min(0.9, Math.max(0.1, Math.round(value * 20) / 20))
}

function renderOpacity(ratio: number): void {
  if (!opacity) return
  const pct = Math.round(ratio * 100)
  opacity.fill.style.height = `${pct}%`
  opacity.thumb.style.bottom = `${pct}%`
  opacity.label.textContent = `${pct}%`
}

function setOpacityShown(shown: boolean): void {
  if (!opacity) return
  if (shown && opacity.panel.parentElement !== uiRoot()) uiRoot().appendChild(opacity.panel)
  renderOpacity(passOpacity)
  opacity.panel.style.display = shown ? 'block' : 'none'
}

function applyOpacityFromY(clientY: number): void {
  if (!opacity) return
  const r = opacity.track.getBoundingClientRect()
  const ratio = opacityStep((r.bottom - clientY) / r.height)
  passOpacity = ratio
  renderOpacity(ratio)
  void ipcRenderer.invoke('settings:set-passthrough-opacity', ratio)
}

if (opacity) {
  opacity.panel.addEventListener('mousedown', (e) => {
    if (!trusted(e)) return
    e.stopPropagation()
    opacityDragging = true
    ipcRenderer.send('bar:hover', true)
    applyOpacityFromY(e.clientY)
  })
  window.addEventListener(
    'mousemove',
    (e) => {
      if (!trusted(e)) return
      if (opacityDragging) applyOpacityFromY(e.clientY)
    },
    true
  )
  window.addEventListener(
    'mouseup',
    () => {
      if (!opacityDragging) return
      opacityDragging = false
      ipcRenderer.send('bar:hover', opacityHover)
      setOpacityShown((barVisible || opacityHover) && passthroughOn)
    },
    true
  )
}

let urlInputMotionTimer: ReturnType<typeof setTimeout> | null = null

function openUrlInput(): void {
  if (!bar) return
  updateShortAddress()
  if (urlInputMotionTimer) {
    clearTimeout(urlInputMotionTimer)
    urlInputMotionTimer = null
  }
  bar.iconRow.style.visibility = 'hidden'
  bar.iconRow.style.pointerEvents = 'none'
  bar.urlInput.style.display = 'block'
  bar.urlInput.style.opacity = '0'
  bar.urlInput.style.transform = 'scaleX(.48)'
  bar.urlInput.value = location.href
  bar.urlInput.focus()
  bar.urlInput.select()
  requestAnimationFrame(() => {
    if (!bar || bar.urlInput.style.display !== 'block') return
    bar.urlInput.style.opacity = '1'
    bar.urlInput.style.transform = 'scaleX(1)'
  })
  scheduleSideChromeLayout()
  ipcRenderer.send('bar:editing', true) // 降层让位输入法候选窗
}

function closeUrlInput(): void {
  if (!bar) return
  updateShortAddress()
  if (urlInputMotionTimer) clearTimeout(urlInputMotionTimer)
  bar.urlInput.style.opacity = '0'
  bar.urlInput.style.transform = 'scaleX(.48)'
  urlInputMotionTimer = setTimeout(() => {
    if (!bar) return
    bar.urlInput.style.display = 'none'
    bar.iconRow.style.visibility = 'visible'
    bar.iconRow.style.pointerEvents = 'auto'
    scheduleSideChromeLayout()
  }, 180)
  scheduleSideChromeLayout()
  ipcRenderer.send('bar:editing', false)
}

function updateShortAddress(): void {
  if (!bar) return
  bar.urlText.textContent = formatShortAddress(location.href)
  bar.urlChip.dataset.href = location.href
}

function queueShortAddressUpdate(): void {
  window.setTimeout(updateShortAddress, 0)
}

function installAddressWatch(): void {
  window.addEventListener('popstate', queueShortAddressUpdate, true)
  window.addEventListener('hashchange', queueShortAddressUpdate, true)
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name]
    history[name] = function (
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void {
      original.call(this, data, unused, url)
      queueShortAddressUpdate()
    } as (typeof history)[typeof name]
  }
}

function setIcon(btn: HTMLElement, name: string): void {
  if (btn.dataset.icon === name) return
  btn.dataset.icon = name
  btn.replaceChildren(icon(name))
}

// ============================================================
// 按钮提示：条顶共享小玻璃标签。hover ~0.8s 才浮出该按钮名字（替掉丑的原生 title）。
// 文案复用现有 title——首次 hover 迁移到 data-cap 并清掉 title，避免再弹系统小黄框
// ============================================================
const cap = el(
  'div',
  `position: fixed; padding: 3px 10px; border-radius: 8px;
   font: 12px -apple-system, 'PingFang SC', sans-serif; color: rgba(255,255,255,.92);
   background: rgba(28,28,32,.62); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
   box-shadow: inset 0 0 0 .5px rgba(255,255,255,.22), 0 4px 14px rgba(0,0,0,.42);
   white-space: nowrap; opacity: 0; transition: opacity .15s ease-out;
   pointer-events: none; z-index: 2147483647;`
)
cap.setAttribute('data-peeko-badge', '')

let capTimer: ReturnType<typeof setTimeout> | null = null
let capHideTimer: ReturnType<typeof setTimeout> | null = null
let capHoverTarget: HTMLElement | null = null

function placeCap(target: HTMLElement): void {
  const r = target.getBoundingClientRect()
  cap.style.left = `${Math.round(r.left + r.width / 2)}px`
  cap.style.bottom = `${Math.round(window.innerHeight - r.top + 9)}px`
  cap.style.transform = 'translateX(-50%)'
}

function scheduleCap(text: string, target: HTMLElement): void {
  if (capHideTimer) {
    clearTimeout(capHideTimer)
    capHideTimer = null
  }
  if (capTimer) clearTimeout(capTimer)
  // 每个按钮单独计时：移到新按钮先收掉旧提示，重新等 0.8s（横向滑过不再瞬现）
  cap.style.opacity = '0'
  capTimer = setTimeout(() => {
    cap.textContent = text
    placeCap(target)
    cap.style.opacity = '1'
  }, 800)
}

function hideCap(): void {
  if (capTimer) {
    clearTimeout(capTimer)
    capTimer = null
  }
  cap.style.opacity = '0'
}

function hideCapSoon(): void {
  if (capHideTimer) clearTimeout(capHideTimer)
  capHideTimer = setTimeout(hideCap, 60) // 在按钮间移动的宽限，避免闪烁
}

function wireCap(target: HTMLElement): void {
  if (target.dataset.capWired) return
  target.dataset.capWired = '1'
  target.addEventListener('mouseenter', () => {
    capHoverTarget = target
    if (target.dataset.shortcutAction) {
      void refreshShortcuts().finally(() => {
        if (capHoverTarget !== target) return
        const text = capText(target)
        if (text) scheduleCap(text, target)
      })
      return
    }
    const text = capText(target)
    if (text) scheduleCap(text, target)
  })
  target.addEventListener('mouseleave', () => {
    if (capHoverTarget === target) capHoverTarget = null
    hideCapSoon()
  })
}

let chromeLayoutFrame: number | null = null

function scheduleSideChromeLayout(): void {
  if (chromeLayoutFrame !== null) return
  chromeLayoutFrame = requestAnimationFrame(() => {
    chromeLayoutFrame = null
    syncSideChromeLayout()
  })
}

function syncSideChromeLayout(): void {
  if (!bar) return
  const shown = barVisible
  const r = bar.pill.getBoundingClientRect()

  if (handle) {
    const visible = shown && !cinema
    if (visible) handle.style.left = `${Math.round(r.left - HANDLE_OFFSET)}px`
    handle.style.opacity = visible ? '1' : '0'
    handle.style.pointerEvents = visible ? 'auto' : 'none'
  }

  if (fullscreenBtn) {
    if (shown) {
      fullscreenBtn.style.left = `${Math.round(r.right + SIDE_BUTTON_GAP)}px`
      updateFullscreenButton()
    }
    fullscreenBtn.style.opacity = shown ? '1' : '0'
    fullscreenBtn.style.pointerEvents = shown ? 'auto' : 'none'
  }

  if (vanishBtn) {
    vanishBtn.style.opacity = shown ? '1' : '0'
    vanishBtn.style.pointerEvents = shown ? 'auto' : 'none'
  }

  if (capHoverTarget && cap.style.opacity !== '0') placeCap(capHoverTarget)
  if (vol && vol.panel.style.display === 'block') showVolPanel()
}

// 状态 → 图标：按钮显示的是"按下后会发生什么"
function updateBar(): void {
  if (!bar) return
  const v = biggestVideo()
  updateShortAddress()
  // 返回/网址/收藏/世界杯/设置是浏览动作，观影模式下收起，控制条保持极简
  for (const b of [bar.back, bar.urlChip, bar.fav, bar.ball, bar.gear]) {
    b.style.display = cinema ? 'none' : 'flex'
  }
  if (cinema) closeFavPanel()
  // 模式识别柔光（纯灰阶）：浏览强柔光（乱页面好定位），观影只一点点。
  // 同一套作用到悬浮条 + 两侧独立按钮（拖把手 / 全屏钮 / Vanish 钮）
  const glow = cinema
    ? '0 4px 16px rgba(0,0,0,.34), 0 0 20px 2px rgba(255,255,255,.3), inset 0 0 0 .5px rgba(255,255,255,.34)'
    : '0 8px 28px rgba(0,0,0,.5), 0 0 16px rgba(255,255,255,.55), 0 0 42px 8px rgba(255,255,255,.32), inset 0 0 0 .5px rgba(255,255,255,.45)'
  bar.pill.style.boxShadow = glow
  if (handle) handle.style.boxShadow = glow
  if (fullscreenBtn) fullscreenBtn.style.boxShadow = glow
  if (vanishBtn) vanishBtn.style.boxShadow = glow
  // 按钮提示接线（幂等，每个只接一次）
  for (const b of [
    bar.back,
    bar.urlChip,
    bar.fav,
    bar.ball,
    bar.gear,
    bar.hide,
    bar.play,
    bar.mode,
    bar.pass
  ])
    wireCap(b)
  if (handle) wireCap(handle)
  if (fullscreenBtn) wireCap(fullscreenBtn)
  if (vanishBtn) wireCap(vanishBtn)
  setIcon(bar.back, 'back')
  setIcon(bar.fav, 'star')
  setIcon(bar.gear, 'gear')
  // 音量滑条开着时实时同步有效音量（静音 = 0，恢复 = 真实音量）
  if (vol && vol.panel.style.display === 'block') renderVol(effectiveVolume())
  setIcon(bar.play, (v?.paused ?? true) ? 'play' : 'pause')
  const muted = v ? wcMuted || v.muted || v.volume === 0 : true
  bar.mute.style.opacity = v ? '1' : '.42'
  setIcon(bar.mute, muted ? 'volx' : 'vol')
  setIcon(bar.mode, cinema ? 'browser' : 'cinema')
  setTip(
    bar.mode,
    cinema ? tr('Return to Browse Mode', '返回网页浏览') : tr('Enter Cinema Mode', '进入观影模式'),
    'mode'
  )
  setIcon(bar.pass, 'pointer')
  updateFullscreenButton()
  scheduleSideChromeLayout()
  // 只在状态翻转时碰背景——否则每次 mousemove 都会抹掉 hover 高亮
  const wasActive = bar.pass.dataset.active === '1'
  if (passthroughOn !== wasActive) {
    if (passthroughOn) {
      bar.pass.dataset.active = '1'
      bar.pass.style.background = 'rgba(255,255,255,.28)'
    } else {
      delete bar.pass.dataset.active
      bar.pass.style.background = 'transparent'
    }
  }
  setOpacityShown(passthroughOn && (barVisible || opacityHover || opacityDragging))
}

// 页面级状态变化实时反映到图标
document.addEventListener('play', () => updateBar(), true)
document.addEventListener('pause', () => updateBar(), true)
document.addEventListener('volumechange', () => updateBar(), true)

// ============================================================
// 拖把手：浏览模式的专用移窗钮——控制条左侧独立玻璃圆钮，抓住即拖
// ============================================================
const handle = ((): HTMLElement | null => {
  try {
    const h = el(
      'div',
      `position: fixed; bottom: 14px; width: ${SIDE_BUTTON_SIZE}px; height: ${SIDE_BUTTON_SIZE}px;
       border-radius: 50%; display: flex; align-items: center; justify-content: center;
       color: rgba(255,255,255,.85); cursor: grab; ${GLASS}
       z-index: 2147483647; opacity: 0;
       transition: opacity .2s ease-out, background .12s ease-out;
       pointer-events: none;`
    )
    h.setAttribute('data-peeko-badge', '')
    h.appendChild(icon('hand'))
    setTip(h, tr('Hold and drag window', '按住拖动窗口'))
    h.addEventListener('mouseenter', (e) => {
      if (!trusted(e)) return
      setSideButtonState(h, true, h.dataset.pressed === '1')
      ipcRenderer.send('bar:hover', true)
    })
    h.addEventListener('mouseleave', (e) => {
      if (!trusted(e)) return
      setSideButtonState(h, false, h.dataset.pressed === '1')
      ipcRenderer.send('bar:hover', false)
    })
    h.addEventListener('mousedown', (e) => {
      if (!trusted(e)) return
      e.preventDefault()
      e.stopPropagation()
      dragging = true
      setSideButtonState(h, true, true)
      h.style.cursor = 'grabbing'
      ipcRenderer.send('win:drag-start', { x: e.screenX, y: e.screenY })
    })
    window.addEventListener(
      'mouseup',
      () => {
        h.style.cursor = 'grab'
        releaseSideButton(h)
      },
      true
    )
    return h
  } catch {
    return null
  }
})()

// ============================================================
// Vanish 钮：左上角悬停浮现的玻璃圆钮——隐藏、静音并暂停，不退出进程。
// ============================================================
const vanishBtn = ((): HTMLElement | null => {
  try {
    const q = el(
      'div',
      `position: fixed; top: 14px; left: 14px; width: 30px; height: 30px;
       border-radius: 50%; display: flex; align-items: center; justify-content: center;
       color: rgba(255,255,255,.85); cursor: pointer; ${GLASS}
       z-index: 2147483647; opacity: 0;
       transition: opacity .2s ease-out, background .12s ease-out;
       pointer-events: none;`
    )
    q.setAttribute('data-peeko-badge', '')
    q.appendChild(icon('x'))
    setTip(q, tr('Vanish: hide + mute + pause', 'Vanish：隐藏画面 + 静音 + 暂停'))
    q.addEventListener('mouseenter', (e) => {
      if (!trusted(e)) return
      setSideButtonState(q, true, q.dataset.pressed === '1')
      ipcRenderer.send('bar:hover', true)
    })
    q.addEventListener('mouseleave', (e) => {
      if (!trusted(e)) return
      setSideButtonState(q, false, q.dataset.pressed === '1')
      ipcRenderer.send('bar:hover', false)
    })
    q.addEventListener('mousedown', (e) => {
      if (trusted(e)) setSideButtonState(q, true, true)
    })
    window.addEventListener('mouseup', () => releaseSideButton(q), true)
    q.addEventListener('click', (e) => {
      if (!trusted(e)) return
      e.stopPropagation()
      ipcRenderer.send('ctrl:boss')
    })
    q.addEventListener('dblclick', (e) => e.stopPropagation())
    return q
  } catch {
    return null
  }
})()

// ============================================================
// 全屏钮：工具条右侧独立圆钮；进入后变成退出全屏，Esc 同路退出
// ============================================================
const fullscreenBtn = ((): HTMLElement | null => {
  try {
    const b = el(
      'button',
      `position: fixed; bottom: 14px; width: ${SIDE_BUTTON_SIZE}px; height: ${SIDE_BUTTON_SIZE}px; border: 0;
       border-radius: 50%; display: flex; align-items: center; justify-content: center;
       color: rgba(255,255,255,.85); cursor: pointer; ${GLASS}
       z-index: 2147483647; opacity: 0;
       transition: opacity .2s ease-out, background .12s ease-out;
       pointer-events: none; padding: 0;`
    )
    b.setAttribute('data-peeko-badge', '')
    b.addEventListener('mouseenter', (e) => {
      if (!trusted(e)) return
      setSideButtonState(b, true, b.dataset.pressed === '1')
      ipcRenderer.send('bar:hover', true)
    })
    b.addEventListener('mouseleave', (e) => {
      if (!trusted(e)) return
      setSideButtonState(b, false, b.dataset.pressed === '1')
      ipcRenderer.send('bar:hover', false)
    })
    b.addEventListener('mousedown', (e) => {
      if (trusted(e)) setSideButtonState(b, true, true)
    })
    window.addEventListener('mouseup', () => releaseSideButton(b), true)
    b.addEventListener('click', (e) => {
      if (!trusted(e)) return
      e.stopPropagation()
      ipcRenderer.send('ctrl:fullscreen')
    })
    b.addEventListener('dblclick', (e) => e.stopPropagation())
    return b
  } catch {
    return null
  }
})()

function updateFullscreenButton(): void {
  if (!fullscreenBtn) return
  setIcon(fullscreenBtn, floatFullscreen ? 'shrink' : 'expand')
  setTip(
    fullscreenBtn,
    floatFullscreen
      ? tr('Exit browser fullscreen (Esc)', '退出浏览器全屏（Esc）')
      : tr('Browser fullscreen', '浏览器全屏'),
    'fullscreen'
  )
}

function updateLocalizedChrome(): void {
  if (bar) {
    setTip(bar.back, tr('Back', '返回上一页'))
    setTip(bar.urlChip, tr('Short address bar: click to edit URL', '短地址栏：点击修改网址'))
    setTip(bar.fav, tr('Favorites', '收藏夹'))
    setTip(bar.ball, tr('World Cup home', '世界杯直播主页'))
    setTip(bar.play, tr('Play / pause', '播放 / 暂停'), 'playpause')
    setTip(bar.mute, tr('Mute', '静音'))
    setTip(bar.pass, tr('Click-through', '鼠标穿透'), 'passthrough')
    setTip(bar.gear, tr('Settings', '设置'))
    setTip(bar.hide, tr('Hide window, keep audio playing', '隐藏窗口，声音继续'), 'hide')
    if (bar.favPanel.style.display === 'flex') void renderFavPanel()
  }
  if (handle) setTip(handle, tr('Hold and drag window', '按住拖动窗口'))
  if (vanishBtn)
    setTip(vanishBtn, tr('Vanish: hide + mute + pause', 'Vanish：隐藏画面 + 静音 + 暂停'))
  updateBar()
}

let barTimer: ReturnType<typeof setTimeout> | null = null
let controlRevealTimer: ReturnType<typeof setTimeout> | null = null
let barVisible = false

function attachChromeRoot(): void {
  if (!bar) return
  const root = uiRoot()
  if (bar.pill.parentElement !== root) root.appendChild(bar.pill)
  if (handle && handle.parentElement !== root) root.appendChild(handle)
  if (fullscreenBtn && fullscreenBtn.parentElement !== root) root.appendChild(fullscreenBtn)
  if (vanishBtn && vanishBtn.parentElement !== root) root.appendChild(vanishBtn)
  if (cap.parentElement !== root) root.appendChild(cap)
}

function setBarShown(shown: boolean): void {
  if (!bar) return
  if (shown && !barVisible) ipcRenderer.send('bar:shown') // 工具栏由隐转显（引导第五关的感知信号）
  if (!shown) hideCap() // 控制条隐没→提示标签一并收掉
  barVisible = shown
  bar.pill.style.opacity = shown ? '1' : '0'
  bar.pill.style.pointerEvents = shown ? 'auto' : 'none'
  syncSideChromeLayout()
  setOpacityShown(passthroughOn && (shown || opacityHover || opacityDragging))
}

function revealControl(control: 'volume' | 'opacity'): void {
  if (!bar) return
  attachChromeRoot()
  updateBar()
  setBarShown(true)
  ipcRenderer.send('bar:hover', true)

  if (control === 'volume') {
    if (volHideTimer) clearTimeout(volHideTimer)
    showVolPanel()
  } else {
    setOpacityShown(true)
  }

  if (barTimer) clearTimeout(barTimer)
  if (controlRevealTimer) clearTimeout(controlRevealTimer)
  controlRevealTimer = setTimeout(() => {
    controlRevealTimer = null
    const busy =
      bar.urlInput.style.display === 'block' ||
      bar.favPanel.style.display === 'flex' ||
      volHover ||
      volDragging ||
      opacityHover ||
      opacityDragging

    if (control === 'volume' && !volHover && !volDragging && vol) vol.panel.style.display = 'none'
    if (control === 'opacity' && !opacityHover && !opacityDragging) setOpacityShown(false)
    if (!busy) {
      setBarShown(false)
      ipcRenderer.send('bar:hover', false)
    }
  }, 1800)
}

let pillResizeObserver: ResizeObserver | null = null
if (bar && typeof ResizeObserver !== 'undefined') {
  pillResizeObserver = new ResizeObserver(() => scheduleSideChromeLayout())
  pillResizeObserver.observe(bar.pill)
}

window.addEventListener(
  'mousemove',
  (e) => {
    if (!trusted(e)) return
    if (!bar || dragging) return
    attachChromeRoot()
    updateBar()
    setBarShown(true)
    if (barTimer) clearTimeout(barTimer)
    barTimer = setTimeout(() => {
      if (bar.urlInput.style.display === 'block') return // 输入网址中不隐没
      if (bar.favPanel.style.display === 'flex') return // 收藏面板打开时不隐没
      if (vol && vol.panel.style.display === 'block') return // 调音量中不隐没
      if (opacityHover || opacityDragging) return // 调透明度中不隐没
      setBarShown(false)
      ipcRenderer.send('bar:hover', false) // 隐没即解除穿透豁免，防状态卡死
    }, 2000)
  },
  true
)

window.addEventListener('resize', () => scheduleSideChromeLayout(), true)
