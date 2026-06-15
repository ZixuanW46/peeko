/**
 * [INPUT]: 依赖 electron-updater、electron app/Notification、store 的自动检查节流时间
 * [OUTPUT]: 对外提供 updater 状态、手动检查/下载/安装、手动检查结果文案、启动后每日自动检查
 * [POS]: main 的更新层；renderer 只看状态和发命令，下载/安装只在主进程发生
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app, Notification } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { store } from './store'
import { getLanguageSettings } from './i18n'
import { tx } from '../shared/i18n'
import {
  createInitialUpdateState,
  reduceUpdateState,
  type UpdateEvent,
  type UpdateState
} from '../shared/updater'

const AUTO_CHECK_DELAY_MS = 10_000
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

let state = createInitialUpdateState(app.getVersion())
let configured = false
let activeManualCheck = false
const listeners = new Set<(next: UpdateState) => void>()

function shortError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/\s+/g, ' ').slice(0, 140)
}

function emit(event: UpdateEvent): UpdateState {
  state = reduceUpdateState(state, event)
  for (const listener of listeners) listener(state)
  return state
}

function notifyAvailable(info: UpdateInfo): void {
  if (activeManualCheck || !Notification.isSupported()) return
  const lang = getLanguageSettings().resolved
  new Notification({
    title: tx(lang, 'Peeko update available', 'Peeko 有新版本'),
    body: tx(lang, `Version ${info.version} is ready to download.`, `${info.version} 可以下载了。`)
  }).show()
}

export function getUpdateState(): UpdateState {
  return state
}

export function onUpdateState(listener: (next: UpdateState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function configureUpdater(): void {
  if (configured) return
  configured = true

  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    emit({ type: 'CHECK_START', at: Date.now() })
  })
  autoUpdater.on('update-available', (info) => {
    emit({ type: 'UPDATE_AVAILABLE', version: info.version, at: Date.now() })
    notifyAvailable(info)
  })
  autoUpdater.on('update-not-available', () => {
    emit({ type: 'UPDATE_NOT_AVAILABLE', at: Date.now() })
  })
  autoUpdater.on('download-progress', (progress) => {
    emit({ type: 'DOWNLOAD_PROGRESS', progress: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    emit({ type: 'DOWNLOAD_READY', version: info.version })
  })
  autoUpdater.on('error', (error) => {
    emit({ type: 'ERROR', error: shortError(error) })
  })
}

export async function checkForUpdates(manual = true): Promise<UpdateState> {
  configureUpdater()
  if (!app.isPackaged) {
    if (manual) emit({ type: 'ERROR', error: 'Updates work in packaged builds only' })
    return state
  }

  activeManualCheck = manual
  try {
    await autoUpdater.checkForUpdates()
    return state
  } catch (error) {
    return emit({ type: 'ERROR', error: shortError(error) })
  } finally {
    activeManualCheck = false
  }
}

export async function downloadUpdate(): Promise<UpdateState> {
  configureUpdater()
  if (!app.isPackaged) return emit({ type: 'ERROR', error: 'Updates work in packaged builds only' })
  emit({ type: 'DOWNLOAD_START' })
  try {
    await autoUpdater.downloadUpdate()
    return state
  } catch (error) {
    return emit({ type: 'ERROR', error: shortError(error) })
  }
}

export function installUpdate(): UpdateState {
  configureUpdater()
  if (state.phase !== 'downloaded') return state
  autoUpdater.quitAndInstall(false, true)
  return state
}

export function scheduleAutomaticUpdateCheck(): void {
  configureUpdater()
  if (!app.isPackaged) return
  const last = store.data.lastUpdateCheckAt ?? null
  if (last && Date.now() - last < AUTO_CHECK_INTERVAL_MS) return
  store.patch({ lastUpdateCheckAt: Date.now() })
  setTimeout(() => {
    void checkForUpdates(false)
  }, AUTO_CHECK_DELAY_MS)
}
