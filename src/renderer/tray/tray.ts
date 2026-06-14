/**
 * [INPUT]: 依赖 preload/tray.ts 暴露的 window.peekoTray
 * [OUTPUT]: 托盘 popover 渲染、命令派发与内容高度上报（动态高度）
 * [POS]: renderer/tray 的逻辑层，负责 macOS 26 Liquid Glass 菜单栏面板
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { tx, type LanguageSettings, type ResolvedLanguage } from '../../shared/i18n'
import {
  updateTrayCommand,
  updateTrayEnabled,
  updateTrayLabel,
  type UpdateState
} from '../../shared/updater'

interface Favorite {
  name: string
  url: string
}

interface TrayState {
  visible: boolean
  cinema: boolean
  currentTitle: string
  currentUrl: string
  favorites: Favorite[]
  canFavorite: boolean
  clipboardHasUrl: boolean
  update: UpdateState
  language: LanguageSettings
}

interface TrayBridge {
  getState(): Promise<TrayState>
  command(action: string, payload?: unknown): Promise<TrayState>
  getUpdateState(): Promise<UpdateState>
  close(): void
  reportHeight(h: number): void
  onState(cb: (state: TrayState) => void): void
  onUpdateState(cb: (state: UpdateState) => void): void
}

const tray = (window as unknown as { peekoTray: TrayBridge }).peekoTray
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

let language: ResolvedLanguage = 'en'
let currentState: TrayState | null = null
const t = (en: string, zh: string): string => tx(language, en, zh)

function setLanguage(next: LanguageSettings): void {
  language = next.resolved
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  document.title = 'Peeko'
}

// 行动作定位器：data-action 同名即对应行
const row = (action: string): HTMLElement =>
  document.querySelector(`[data-action="${action}"]`) as HTMLElement

function favoriteRow(f: Favorite): HTMLButtonElement {
  const el = document.createElement('button')
  el.className = 'row'
  const name = document.createElement('span')
  name.textContent = f.name
  el.append(name)
  el.addEventListener('click', () => void run('open-favorite', f.url))
  return el
}

function render(state: TrayState): void {
  currentState = state
  setLanguage(state.language)
  $('visible-toggle').setAttribute('aria-label', t('Show or hide window', '显示或隐藏浮窗'))
  $('cinema-label').textContent = t('Cinema Mode', '观影模式')
  $('favorite-label').textContent = t('Favorite Page', '收藏当前页')
  $('favorites-title').textContent = t('Favorites', '收藏')
  $('clipboard-label').textContent = t('Open Link from Clipboard', '打开剪贴板链接')
  $('home-label').textContent = t('World Cup Home', '世界杯主页')
  const updateRow = $('update-row') as HTMLButtonElement
  updateRow.dataset.action = updateTrayCommand(state.update)
  updateRow.toggleAttribute('disabled', !updateTrayEnabled(state.update))
  $('update-label').textContent = updateTrayLabel(state.update, language)
  $('settings-label').textContent = t('Settings…', '设置…')
  $('quit-label').textContent = t('Quit Peeko', '退出 Peeko')

  $('status').textContent =
    state.currentTitle ||
    (state.visible ? t('Window is visible', '浮窗可见') : t('Window is hidden', '浮窗已隐藏'))
  $('visible-toggle').classList.toggle('on', state.visible)

  // Cinema 是开关项：激活打勾；favorite/clipboard 无内容时置灰不可点
  row('cinema').classList.toggle('is-on', state.cinema)
  row('favorite').toggleAttribute('disabled', !state.canFavorite)
  row('clipboard').toggleAttribute('disabled', !state.clipboardHasUrl)

  // 收藏：有则显示整组（单行名称），空则整组隐藏，面板随之收矮
  const favs = $('favorites')
  favs.replaceChildren()
  for (const f of state.favorites) favs.appendChild(favoriteRow(f))
  $('fav-section').hidden = state.favorites.length === 0

  syncHeight()
}

// body 上下 padding 之和，与 tray.css 同步——加到 main 内容高上得到窗口目标高
const BODY_PADDING = 0

// 量 main 完整内容高（含 overflow）回报 main 进程，让窗口像原生菜单贴合内容
function syncHeight(): void {
  requestAnimationFrame(() => {
    const main = document.querySelector('main')
    if (main) tray.reportHeight(main.scrollHeight + BODY_PADDING)
  })
}

async function run(action: string, payload?: unknown): Promise<void> {
  render(await tray.command(action, payload))
}

document.querySelectorAll<HTMLElement>('[data-action]').forEach((node) => {
  node.addEventListener('click', () => void run(node.dataset.action!))
})

$('visible-toggle').addEventListener('click', () => void run('toggle-visible'))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') tray.close()
})

// 异步回流（字体就绪/收藏增删）后补量一次高度，兜住首帧测不准
const mainEl = document.querySelector('main')
if (mainEl) new ResizeObserver(() => syncHeight()).observe(mainEl)

tray.onState(render)
tray.onUpdateState((update) => {
  if (currentState) render({ ...currentState, update })
})
void tray.getState().then(render)

export {}
