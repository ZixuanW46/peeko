/**
 * [INPUT]: 依赖 preload/ui.ts 暴露的 window.peeko 桥
 * [OUTPUT]: 设置窗逻辑——自动观影、更新单主动作+下载浮层、改键录制、收藏管理
 * [POS]: renderer/settings 的逻辑层
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import {
  tx,
  type LanguagePreference,
  type LanguageSettings,
  type ResolvedLanguage
} from '../../shared/i18n'
import { prettyShortcut } from '../../shared/shortcuts'
import {
  updatePrimaryAction,
  updateStatusText,
  type UpdateCommand,
  type UpdateState
} from '../../shared/updater'

interface Favorite {
  name: string
  url: string
}

interface ShortcutFailure {
  action: string
  accelerator: string
}

interface ShortcutHealth {
  action: string
  accelerator: string
  ok: boolean
  critical: boolean
  reason: string
  recommended: string
}

interface PeekoBridge {
  getSettings(): Promise<{
    shortcuts: Record<string, string>
    favorites: Favorite[]
    autoCinema: boolean
    passthroughOpacity: number
    showInDock: boolean
    shortcutFailures: ShortcutFailure[]
    shortcutHealth: ShortcutHealth[]
    language: LanguageSettings
  }>
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  installUpdate(): Promise<UpdateState>
  getLanguage(): Promise<LanguageSettings>
  setLanguagePreference(preference: LanguagePreference): Promise<LanguageSettings>
  probeShortcut(action: string, accelerator: string): Promise<{ ok: boolean; reason?: string }>
  setShortcut(
    action: string,
    accelerator: string
  ): Promise<{ ok: boolean; reason?: string; health: ShortcutHealth[] }>
  beginShortcutRecording(): Promise<void>
  endShortcutRecording(): Promise<ShortcutHealth[]>
  resetShortcuts(): Promise<{ shortcuts: Record<string, string>; shortcutHealth: ShortcutHealth[] }>
  setAutoCinema(on: boolean): Promise<boolean>
  setPassthroughOpacity(v: number): Promise<number>
  setShowInDock(show: boolean): Promise<boolean>
  replayIntro(): void
  copyDiagnostics(): Promise<string>
  clearBrowserSession(): Promise<boolean>
  clearFavorites(): Promise<Favorite[]>
  resetPreferences(): Promise<{
    shortcuts: Record<string, string>
    autoCinema: boolean
    passthroughOpacity: number
    showInDock: boolean
    shortcutHealth: ShortcutHealth[]
    language: LanguageSettings
  }>
  removeFavorite(url: string): Promise<Favorite[]>
  renameFavorite(url: string, name: string): Promise<Favorite[]>
  onUpdateState(cb: (state: UpdateState) => void): void
}

const peeko = (window as unknown as { peeko: PeekoBridge }).peeko
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

let language: ResolvedLanguage = 'en'
let currentUpdateState: UpdateState | null = null
let updateDialogArmed = false
let updateDialogDismissed = false
const t = (en: string, zh: string): string => tx(language, en, zh)

function applyLanguage(next: LanguageSettings): void {
  language = next.resolved
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  applyStaticCopy()
  if (currentUpdateState) renderUpdate(currentUpdateState)
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    hide: t('Hide / restore picture (audio continues)', '隐藏 / 恢复画面（音频继续）'),
    peek: t('Hold to peek', '长按临时显示'),
    boss: t('Boss key (single press hides / double press quits)', '老板键（单击潜伏 / 双击退出）'),
    playpause: t('Play / pause', '播放 / 暂停'),
    mute: t('Mute toggle', '静音切换'),
    volumeUp: t('Volume up', '音量增加'),
    volumeDown: t('Volume down', '音量降低'),
    mode: t('Cinema / browse mode', '观影 / 浏览模式'),
    passthrough: t('Click-through', '鼠标穿透'),
    fullscreen: t('Video fullscreen', '视频全屏'),
    opacityUp: t('Click-through opacity up', '穿透不透明度增加'),
    opacityDown: t('Click-through opacity down', '穿透不透明度降低'),
    seekBack: t('Seek backward', '快退'),
    seekForward: t('Seek forward', '快进')
  }
  return labels[action] ?? action
}

function setText(id: string, text: string): void {
  $(id).textContent = text
}

function applyStaticCopy(): void {
  document.title = t('Peeko Settings', 'Peeko 设置')
  setText('general-title', t('General', '通用'))
  setText('auto-cinema-label', t('Auto Cinema Mode', '自动观影模式'))
  const autoCinemaInfo = $('auto-cinema-info') as HTMLButtonElement
  const autoCinemaTip = t(
    'After the main video plays for 3 seconds, Peeko enters Cinema Mode automatically.',
    '主视频播放 3 秒后，Peeko 会自动进入观影模式。'
  )
  autoCinemaInfo.setAttribute('aria-label', autoCinemaTip)
  $('auto-cinema-tip').replaceChildren(
    document.createTextNode(t('After the main video plays for 3 seconds,', '主视频播放 3 秒后，')),
    document.createElement('br'),
    document.createTextNode(
      t('Peeko enters Cinema Mode automatically.', 'Peeko 会自动进入观影模式。')
    )
  )
  setText('show-dock-label', t('Show Peeko in Dock', '在 Dock 中显示 Peeko'))
  setText('language-label', t('Language', '语言'))
  setText('pass-opacity-label', t('Click-through opacity', '穿透模式画面不透明度'))
  setText('replay-intro-label', t('Replay intro guide', '重看新手引导'))
  setText('replay-intro', t('Replay intro', '重看引导'))
  setText('shortcuts-title', t('Shortcuts', '快捷键'))
  setText('reset-shortcuts', t('Reset to defaults', '重置为默认'))
  setText(
    'shortcut-hint',
    t(
      'Click a keycap, then press a new combo with a modifier. Esc cancels.',
      '点击键帽后按下新组合（需含修饰键），Esc 取消'
    )
  )
  setText('updates-title', t('Updates', '更新'))
  setText('updates-current-label', t('Current version', '当前版本'))
  setText('updates-status-label', t('Status', '状态'))
  setText('updates-actions-label', t('Software updates', '软件更新'))
  setText('favorites-title', t('Favorites', '收藏'))
  setText('fav-empty', t('Favorites is empty', '当前收藏夹为空'))
  setText('fav-hint', t('Click a name to rename it', '点击名称可重命名'))
  setText('maintenance-title', t('Maintenance', '维护'))
  setText('copy-diagnostics-label', t('Copy diagnostics', '复制诊断信息'))
  setText('copy-diagnostics', t('Copy', '复制'))
  setText('clear-session-label', t('Clear browser session', '清除浏览会话'))
  setText('clear-session', t('Clear', '清除'))
  setText('clear-favorites-label', t('Clear favorites', '清空收藏'))
  setText('clear-favorites', t('Clear', '清空'))
  setText('reset-preferences-label', t('Restore preference defaults', '恢复偏好默认值'))
  setText('reset-preferences', t('Reset', '恢复'))

  const languageSelect = $('language') as HTMLSelectElement
  languageSelect.options[0].textContent = t('Auto (System)', '自动（跟随系统）')
  languageSelect.options[1].textContent = '中文'
  languageSelect.options[2].textContent = 'English'
}

const pretty = prettyShortcut

function updateProgress(state: UpdateState): number {
  return state.phase === 'downloaded' ? 100 : (state.progress ?? 0)
}

function renderUpdateDialog(state: UpdateState): void {
  const dialog = $('update-dialog')
  const visible =
    updateDialogArmed &&
    !updateDialogDismissed &&
    (state.phase === 'downloading' || state.phase === 'downloaded')
  dialog.hidden = !visible
  if (!visible) return

  const progress = updateProgress(state)
  const version = state.latestVersion ?? state.currentVersion
  const ready = state.phase === 'downloaded'
  $('update-dialog-close').setAttribute('aria-label', t('Close', '关闭'))
  setText(
    'update-dialog-title',
    ready ? t('Update ready', '更新已就绪') : t('Downloading update', '正在下载更新')
  )
  setText(
    'update-dialog-body',
    ready
      ? t(`Peeko ${version} has been downloaded.`, `Peeko ${version} 已下载完成。`)
      : t(`Downloading Peeko ${version}.`, `正在下载 Peeko ${version}。`)
  )
  ;($('update-progress-bar') as HTMLSpanElement).style.width = `${progress}%`
  setText('update-progress-label', `${progress}%`)
  setText('update-dialog-later', ready ? t('Later', '稍后') : t('Hide', '隐藏'))
  setText('update-dialog-install', t('Restart & Install', '重启并安装'))
  ;($('update-dialog-install') as HTMLButtonElement).hidden = !ready
}

function renderUpdate(state: UpdateState): void {
  const previous = currentUpdateState
  currentUpdateState = state
  if (state.phase === 'downloading' && previous?.phase !== 'downloading') {
    updateDialogArmed = true
    updateDialogDismissed = false
  }
  if (state.phase !== 'downloading' && state.phase !== 'downloaded') {
    updateDialogArmed = false
    updateDialogDismissed = false
  }

  const action = updatePrimaryAction(state, language)
  const button = $('updates-action') as HTMLButtonElement
  $('updates-version').textContent = state.currentVersion
  $('updates-status').textContent = updateStatusText(state, language)
  button.textContent = action.label
  button.disabled = !action.enabled
  button.dataset.command = action.command ?? ''
  renderUpdateDialog(state)
}

async function runUpdateCommand(command: UpdateCommand | null): Promise<void> {
  if (!command) return
  if (command === 'update-check') {
    renderUpdate(await peeko.checkForUpdates())
    return
  }
  if (command === 'update-download') {
    if (currentUpdateState) {
      renderUpdate({ ...currentUpdateState, phase: 'downloading', progress: 0, error: null })
    }
    renderUpdate(await peeko.downloadUpdate())
    return
  }
  renderUpdate(await peeko.installUpdate())
}

function dismissUpdateDialog(): void {
  updateDialogDismissed = true
  $('update-dialog').hidden = true
}

async function initUpdates(): Promise<void> {
  renderUpdate(await peeko.getUpdateState())
  peeko.onUpdateState(renderUpdate)
  $('updates-action').addEventListener('click', async () => {
    const action = updatePrimaryAction(currentUpdateState!, language)
    await runUpdateCommand(action.command)
  })
  $('update-dialog-close').addEventListener('click', dismissUpdateDialog)
  $('update-dialog-later').addEventListener('click', dismissUpdateDialog)
  $('update-dialog-install').addEventListener('click', async () =>
    renderUpdate(await peeko.installUpdate())
  )
}

// 纯修饰键 code——录制时只按这些应继续等待，不算"不支持"
const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

// 字母/数字/功能键之外的可绑定主键：code → Electron accelerator token
const SPECIAL_KEYS: Record<string, string> = {
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Space: 'Space',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

// e.code → 主键 token；非可绑定主键（含修饰键、未知键）返回 null
function mainKeyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F[0-9]{1,2}$/.test(code)) return code
  return SPECIAL_KEYS[code] ?? null
}

// KeyboardEvent → Electron Accelerator（修饰键必选，主键取 code）
function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (!mods.length) return null
  const key = mainKeyToken(e.code)
  if (!key) return null
  return [...mods, key].join('+')
}

// ============================================================
// 通用：自动观影开关
// ============================================================
async function initAutoCinema(): Promise<void> {
  const sw = document.getElementById('auto-cinema')!
  const { autoCinema } = await peeko.getSettings()
  sw.setAttribute('aria-checked', String(autoCinema))
  sw.addEventListener('click', async () => {
    const next = sw.getAttribute('aria-checked') !== 'true'
    await peeko.setAutoCinema(next)
    sw.setAttribute('aria-checked', String(next))
  })
}

async function initDockVisibility(): Promise<void> {
  const sw = document.getElementById('show-dock')!
  const { showInDock } = await peeko.getSettings()
  sw.setAttribute('aria-checked', String(showInDock))
  sw.addEventListener('click', async () => {
    const next = sw.getAttribute('aria-checked') !== 'true'
    const applied = await peeko.setShowInDock(next)
    sw.setAttribute('aria-checked', String(applied))
  })
}

async function initLanguage(): Promise<void> {
  const settings = await peeko.getSettings()
  applyLanguage(settings.language)
  const select = $('language') as HTMLSelectElement
  select.value = settings.language.preference
  select.addEventListener('change', async () => {
    const next = await peeko.setLanguagePreference(select.value as LanguagePreference)
    applyLanguage(next)
    await renderShortcuts()
    await renderFavorites()
  })
}

// 穿透透明度滑条：拖动即落盘，穿透进行中实时预览
async function initPassOpacity(): Promise<void> {
  const slider = document.getElementById('pass-opacity') as HTMLInputElement
  const val = document.getElementById('pass-opacity-val')!
  const { passthroughOpacity } = await peeko.getSettings()
  slider.value = String(Math.round(passthroughOpacity * 100))
  val.textContent = `${slider.value}%`
  slider.addEventListener('input', () => {
    val.textContent = `${slider.value}%`
    void peeko.setPassthroughOpacity(Number(slider.value) / 100)
  })
}

// ============================================================
// 快捷键：录制 + 重置
// ============================================================
async function renderShortcuts(): Promise<void> {
  const { shortcuts, shortcutHealth } = await peeko.getSettings()
  const ul = document.getElementById('shortcuts')!
  const warn = document.getElementById('shortcut-warn')!
  const healthByAction = new Map(shortcutHealth.map((h) => [h.action, h]))
  ul.replaceChildren()
  for (const [action, accel] of Object.entries(shortcuts)) {
    const li = document.createElement('li')
    const label = document.createElement('span')
    label.textContent = actionLabel(action)
    const err = document.createElement('span')
    err.className = 'err'
    const kbd = document.createElement('kbd')
    kbd.textContent = pretty(accel)
    const health = healthByAction.get(action)
    if (health && !health.ok) {
      li.classList.add(health.critical ? 'shortcut-critical' : 'shortcut-warning')
      err.textContent = health.reason
      kbd.title = t(
        `Recommended fallback: ${pretty(health.recommended)}`,
        `推荐备用：${pretty(health.recommended)}`
      )
    } else {
      err.textContent = t('Available', '可用')
      err.classList.add('ok')
    }
    kbd.addEventListener('click', () => record(action, kbd, err))
    li.append(label, err, kbd)
    ul.appendChild(li)
  }
  const broken = shortcutHealth.filter((h) => !h.ok)
  warn.textContent = broken.length
    ? t(
        `These shortcuts need attention: ${broken
          .map((h) => `${actionLabel(h.action)} ${pretty(h.accelerator)}`)
          .join(', ')}. Click a keycap to choose a new combo.`,
        `这些快捷键需要处理：${broken
          .map((h) => `${actionLabel(h.action)} ${pretty(h.accelerator)}`)
          .join('、')}。点击键帽改成新的组合。`
      )
    : ''
}

function record(action: string, kbd: HTMLElement, err: HTMLElement): void {
  const original = kbd.textContent
  kbd.textContent = t('Press keys…', '按下按键…')
  kbd.classList.add('recording')
  err.textContent = ''
  void peeko.beginShortcutRecording()

  let captured = false

  // 唯一收尾门：同步摘监听 + 复位态，再结束录制并重渲染。
  // onKey 任一分支抛错都靠 finally 兜到这里——begin 注销了全部全局键，
  // 这里必须执行 end 才会重注册，否则全局键全卡在注销态。
  const finish = async (): Promise<void> => {
    window.removeEventListener('keydown', onKey, true)
    kbd.classList.remove('recording')
    await peeko.endShortcutRecording()
    await renderShortcuts()
  }

  const onKey = async (e: KeyboardEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    if (captured) return // 已捕获，丢弃后续重复 keydown（防自动重复 re-entrancy）

    if (e.key === 'Escape') {
      captured = true
      kbd.textContent = original
      await finish()
      return
    }
    if (MODIFIER_CODES.has(e.code)) return // 只按了修饰键，继续等

    const key = mainKeyToken(e.code)
    if (!key) {
      err.textContent = t(
        'This key is not supported — try a letter, number, or arrow key',
        '这个键不支持，换字母／数字／方向键试试'
      )
      return
    }
    const accel = toAccelerator(e)
    if (!accel) {
      err.textContent = t('Add a modifier: ⌘ ⌥ ⌃ ⇧', '再配一个修饰键：⌘ ⌥ ⌃ ⇧')
      return
    }

    captured = true // 锁定——以下 await 期间不再接受新按键
    try {
      const probe = await peeko.probeShortcut(action, accel)
      if (!probe.ok) {
        kbd.textContent = original
        err.textContent = probe.reason ?? t('This shortcut is unavailable', '该按键不可用')
        return
      }
      const res = await peeko.setShortcut(action, accel)
      if (res.ok) kbd.textContent = pretty(accel)
      else {
        kbd.textContent = original
        err.textContent = res.reason ?? t('Could not save shortcut', '设置失败')
      }
    } finally {
      await finish()
    }
  }

  window.addEventListener('keydown', onKey, true)
}

document.getElementById('reset-shortcuts')!.addEventListener('click', async () => {
  await peeko.resetShortcuts()
  renderShortcuts()
})

// ============================================================
// 收藏：两行（名称+网址），点名称重命名，✕ 删除
// ============================================================
async function renderFavorites(): Promise<void> {
  const { favorites } = await peeko.getSettings()
  const ul = document.getElementById('favorites')!
  const empty = document.getElementById('fav-empty')!
  const hint = document.getElementById('fav-hint')!
  ul.replaceChildren()
  empty.style.display = favorites.length ? 'none' : 'block'
  hint.style.display = favorites.length ? 'block' : 'none'
  for (const f of favorites) {
    const li = document.createElement('li')
    const cell = document.createElement('div')
    cell.className = 'fav-cell'

    const name = document.createElement('span')
    name.className = 'fav-name'
    name.textContent = f.name
    name.title = t('Click to rename', '点击重命名')
    name.addEventListener('click', () => startRename(f, name))

    const url = document.createElement('span')
    url.className = 'fav-url'
    url.textContent = f.url
    url.title = f.url

    cell.append(name, url)

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '✕'
    del.addEventListener('click', async () => {
      await peeko.removeFavorite(f.url)
      renderFavorites()
    })

    li.append(cell, del)
    ul.appendChild(li)
  }
}

function startRename(f: Favorite, name: HTMLElement): void {
  const input = document.createElement('input')
  input.className = 'fav-rename'
  input.value = f.name
  name.replaceWith(input)
  input.focus()
  input.select()

  const commit = async (): Promise<void> => {
    const next = input.value.trim()
    if (next && next !== f.name) await peeko.renameFavorite(f.url, next)
    renderFavorites()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void commit()
    if (e.key === 'Escape') renderFavorites()
  })
  input.addEventListener('blur', () => void commit())
}

document.getElementById('replay-intro')!.addEventListener('click', () => peeko.replayIntro())

const maintenanceStatus = document.getElementById('maintenance-status')!

document.getElementById('copy-diagnostics')!.addEventListener('click', async () => {
  await peeko.copyDiagnostics()
  maintenanceStatus.textContent = t('Diagnostics copied', '诊断信息已复制')
})

document.getElementById('clear-session')!.addEventListener('click', async () => {
  if (
    !confirm(
      t(
        'Clearing the browser session signs you out of websites, but keeps favorites and shortcuts. Continue?',
        '清除浏览会话会退出网站登录，但不会删除收藏和快捷键。继续？'
      )
    )
  )
    return
  await peeko.clearBrowserSession()
  maintenanceStatus.textContent = t('Browser session cleared', '浏览会话已清除')
})

document.getElementById('clear-favorites')!.addEventListener('click', async () => {
  if (!confirm(t('Clear all favorites?', '清空所有收藏？'))) return
  await peeko.clearFavorites()
  await renderFavorites()
  maintenanceStatus.textContent = t('Favorites cleared', '收藏已清空')
})

document.getElementById('reset-preferences')!.addEventListener('click', async () => {
  if (
    !confirm(
      t(
        'Restore preference defaults? This will not replay the intro or delete favorites.',
        '恢复偏好默认值？这不会重置新手引导，也不会删除收藏。'
      )
    )
  )
    return
  const next = await peeko.resetPreferences()
  applyLanguage(next.language)
  ;($('language') as HTMLSelectElement).value = next.language.preference
  document.getElementById('auto-cinema')!.setAttribute('aria-checked', String(next.autoCinema))
  document.getElementById('show-dock')!.setAttribute('aria-checked', String(next.showInDock))
  const slider = document.getElementById('pass-opacity') as HTMLInputElement
  const val = document.getElementById('pass-opacity-val')!
  slider.value = String(Math.round(next.passthroughOpacity * 100))
  val.textContent = `${slider.value}%`
  await renderShortcuts()
  maintenanceStatus.textContent = t('Preferences restored', '偏好已恢复默认')
})

void (async () => {
  await initLanguage()
  await initAutoCinema()
  await initDockVisibility()
  await initPassOpacity()
  await initUpdates()
  await renderShortcuts()
  await renderFavorites()
})()

export {}
