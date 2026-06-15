/**
 * [INPUT]: 依赖 electron 的 Tray/BrowserWindow/Menu/clipboard，./runtime 门闩，./modes 模式切换，./store 收藏夹，./window 可见性门闩，./liquid-glass 原生材质
 * [OUTPUT]: 对外提供 createTray()、refreshTray()——菜单栏图标、macOS 26 Liquid Glass popover、手动更新反馈
 * [POS]: main 的托盘层，应用唯一的常驻可见入口（隐蔽性要求：glyph 伪装系统图标）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  Tray,
  Menu,
  BrowserWindow,
  app,
  clipboard,
  ipcMain,
  dialog,
  nativeImage,
  screen,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { getFloat, hideFloatWindow, openOnboarding, openSettings, showFloatWindow } from './window'
import { isCinema, toggleCinema } from './modes'
import { store, HOME_URL } from './store'
import { ensureRuntimeVisible, hasRequiredPermissions } from './runtime'
import { getLanguageSettings, t } from './i18n'
import { applyLiquidGlass } from './liquid-glass'
import type { LanguageSettings } from '../shared/i18n'
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from './updater'
import {
  updateTrayCommand,
  updateTrayEnabled,
  updateTrayLabel,
  updateManualCheckResult,
  type UpdateState
} from '../shared/updater'

interface TrayState {
  visible: boolean
  cinema: boolean
  currentTitle: string
  currentUrl: string
  favorites: typeof store.data.favorites
  canFavorite: boolean
  clipboardHasUrl: boolean
  update: UpdateState
  language: LanguageSettings
}

let tray: Tray | null = null
let panel: BrowserWindow | null = null

function ensureTrayRuntime(): ReturnType<typeof getFloat> {
  if (!hasRequiredPermissions()) {
    panel?.hide()
    openOnboarding()
    return null
  }
  ensureRuntimeVisible()
  return getFloat()
}

function toggleFloat(): void {
  if (!hasRequiredPermissions()) {
    panel?.hide()
    openOnboarding()
    return
  }
  const f = getFloat()
  if (!f) {
    ensureTrayRuntime()
    return
  }
  f.win.isVisible() ? hideFloatWindow() : showFloatWindow()
}

function loadUrl(url: string): void {
  const f = ensureTrayRuntime()
  if (!f) return
  f.pageView.webContents.loadURL(url)
  f.win.showInactive()
}

export function addCurrentToFavorites(): void {
  const wc = getFloat()?.pageView.webContents
  if (!wc) return
  const url = wc.getURL()
  if (!url.startsWith('http')) return
  const name = (wc.getTitle() || url).slice(0, 40)
  if (store.data.favorites.some((f) => f.url === url)) return
  store.patch({ favorites: [...store.data.favorites, { name, url }] })
  refreshTray()
}

function removeFavorite(url: string): void {
  store.patch({ favorites: store.data.favorites.filter((f) => f.url !== url) })
  refreshTray()
}

function trayState(): TrayState {
  const f = getFloat()
  const wc = f?.pageView.webContents
  const currentUrl = wc?.getURL() ?? ''
  const currentTitle = (wc?.getTitle() || '').slice(0, 70)
  const clipboardText = clipboard.readText().trim()
  return {
    visible: Boolean(f?.win.isVisible()),
    cinema: isCinema(),
    currentTitle,
    currentUrl,
    favorites: store.data.favorites,
    canFavorite:
      currentUrl.startsWith('http') && !store.data.favorites.some((fav) => fav.url === currentUrl),
    clipboardHasUrl: /^https?:\/\//.test(clipboardText),
    update: getUpdateState(),
    language: getLanguageSettings()
  }
}

function sendTrayState(): void {
  if (!panel || panel.webContents.isDestroyed()) return
  panel.webContents.send('tray:state', trayState())
}

// 高度记忆：上次量到的内容高，下次开面板直接用作初值，免去"先 374 再收紧"的跳动
let lastPanelHeight = 374

function panelBounds(height = lastPanelHeight): Electron.Rectangle {
  const width = 380
  const b = tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }
  const display = screen.getDisplayNearestPoint({
    x: Math.round(b.x + b.width / 2),
    y: Math.round(b.y + b.height / 2)
  })
  const { workArea } = display
  const x = Math.min(
    Math.max(Math.round(b.x + b.width / 2 - width / 2), workArea.x + 8),
    workArea.x + workArea.width - width - 8
  )
  const topY = Math.round(b.y + b.height + 8)
  const y =
    topY + height <= workArea.y + workArea.height - 8
      ? topY
      : Math.max(workArea.y + 8, Math.round(b.y - height - 8))
  return { x, y, width, height }
}

function ensurePanel(): BrowserWindow {
  if (panel) return panel
  panel = new BrowserWindow({
    ...panelBounds(),
    type: 'panel',
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: true, // 原生窗口投影：白底也能分清边界，且画在窗口外不造成双圈
    skipTaskbar: true,
    show: false,
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: { preload: join(__dirname, '../preload/tray.js') }
  })
  panel.setAlwaysOnTop(true, 'pop-up-menu')
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) panel.loadURL(`${dev}/tray/index.html`)
  else panel.loadFile(join(__dirname, '../renderer/tray/index.html'))
  // mac26 注入真 Liquid Glass（成功则撤掉上面的 popover vibrancy 回落）
  applyLiquidGlass(panel, { cornerRadius: 18 })
  panel.on('blur', () => panel?.hide())
  panel.on('closed', () => {
    panel = null
  })
  return panel
}

function showPanel(): void {
  const win = ensurePanel()
  win.setBounds(panelBounds())
  if (win.isVisible()) {
    win.hide()
    return
  }
  win.show()
  win.moveTop()
  sendTrayState()
}

async function runCommand(action: string, payload?: unknown): Promise<TrayState> {
  switch (action) {
    case 'toggle-visible':
      toggleFloat()
      break
    case 'cinema':
      if (!getFloat() && !ensureTrayRuntime()) break
      await toggleCinema()
      break
    case 'favorite':
      addCurrentToFavorites()
      break
    case 'open-favorite':
      if (typeof payload === 'string') {
        panel?.hide()
        loadUrl(payload)
      }
      break
    case 'clipboard': {
      const text = clipboard.readText().trim()
      if (/^https?:\/\//.test(text)) {
        panel?.hide()
        loadUrl(text)
      }
      break
    }
    case 'home':
      panel?.hide()
      loadUrl(HOME_URL)
      break
    case 'settings':
      panel?.hide()
      openSettings()
      break
    case 'update-check':
      await showManualUpdateResult(await checkForUpdates(true))
      break
    case 'update-download':
      await downloadUpdate()
      break
    case 'update-install':
      installUpdate()
      break
    case 'quit':
      app.quit()
      break
  }
  const next = trayState()
  sendTrayState()
  return next
}

async function showManualUpdateResult(update: UpdateState): Promise<void> {
  const language = getLanguageSettings().resolved
  const result = updateManualCheckResult(update, language)
  await dialog.showMessageBox({
    type: result.kind,
    buttons: [language === 'zh' ? '知道了' : 'OK'],
    defaultId: 0,
    message: result.message,
    detail: result.detail
  })
}

function buildMenu(): Menu {
  const favs = store.data.favorites
  const language = getLanguageSettings().resolved
  const update = getUpdateState()
  const updateCommand = updateTrayCommand(update)
  const favItems: MenuItemConstructorOptions[] = favs.map((f) => ({
    label: f.name,
    click: () => loadUrl(f.url)
  }))
  const removeItems: MenuItemConstructorOptions[] = favs.map((f) => ({
    label: f.name,
    click: () => removeFavorite(f.url)
  }))

  return Menu.buildFromTemplate([
    { label: t('Show / Hide Window', '显示 / 隐藏浮窗'), click: toggleFloat },
    {
      label: t('Toggle Cinema Mode', '观影模式 切换'),
      click: (): void => {
        if (!getFloat() && !ensureTrayRuntime()) return
        void toggleCinema()
      }
    },
    { type: 'separator' },
    ...favItems,
    { label: t('⭐ Favorite Current Page', '⭐ 收藏当前页面'), click: addCurrentToFavorites },
    ...(favs.length
      ? [
          {
            label: t('Remove Favorite', '删除收藏'),
            submenu: removeItems
          } as MenuItemConstructorOptions
        ]
      : []),
    { type: 'separator' },
    {
      label: t('Open URL from Clipboard', '打开剪贴板中的网址'),
      click: (): void => {
        const text = clipboard.readText().trim()
        if (/^https?:\/\//.test(text)) loadUrl(text)
      }
    },
    { label: t('World Cup Home', '回到世界杯主页'), click: (): void => loadUrl(HOME_URL) },
    { type: 'separator' },
    {
      label: updateTrayLabel(update, language),
      enabled: updateTrayEnabled(update),
      click: (): void => {
        void runCommand(updateCommand)
      }
    },
    { label: t('Settings…', '设置…'), click: openSettings },
    { label: t('Quit', '退出'), click: (): void => app.quit() }
  ])
}

export function refreshTray(): void {
  sendTrayState()
}

export function createTray(): void {
  const img = nativeImage.createFromPath(join(__dirname, '../../resources/trayTemplate.png'))
  img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('')
  tray.on('click', showPanel)
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()))
  ipcMain.handle('tray:get-state', () => trayState())
  ipcMain.handle('tray:command', (_e, action: string, payload?: unknown) =>
    runCommand(action, payload)
  )
  ipcMain.on('tray:close', () => panel?.hide())
  // 内容自适应高度：渲染层量好的 main 高度 clamp 后贴合菜单栏。
  // 抖动门闩（差 <2px 早退）切断 ResizeObserver→setBounds→ResizeObserver 回流环。
  ipcMain.on('tray:height', (_e, raw: number) => {
    if (!panel || panel.webContents.isDestroyed()) return
    const { workArea } = screen.getDisplayNearestPoint(panel.getBounds())
    const height = Math.max(80, Math.min(Math.round(raw), Math.min(640, workArea.height - 16)))
    lastPanelHeight = height
    if (Math.abs(panel.getBounds().height - height) < 2) return
    panel.setBounds(panelBounds(height), false)
  })
}
