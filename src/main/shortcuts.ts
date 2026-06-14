/**
 * [INPUT]: 依赖 electron 的 globalShortcut/systemPreferences/app，uiohook-napi 的全局键钩，
 *          ./state-machine 的 createMachine，./window 的浮窗单例与穿透开关，./store 的快捷键映射
 * [OUTPUT]: 对外提供 registerShortcuts()、rebindShortcuts()、togglePlayPause/toggleMute
 * [POS]: main 的输入层，状态机唯一的事件来源；长按 peek 的 uiohook 权限降级在此
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app, globalShortcut, systemPreferences } from 'electron'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { createMachine, type Effect, type Machine } from './state-machine'
import { toggleCinema } from './modes'
import {
  getFloat,
  getOnboarding,
  isOnboarding,
  raiseOnboarding,
  hideFloatWindow,
  showFloatWindow,
  togglePassthrough,
  toggleWindowFullscreen
} from './window'
import { store, type Action, type ShortcutMap } from './store'
import { t } from './i18n'

export interface ShortcutFailure {
  action: Action
  accelerator: string
}

export interface ShortcutHealth {
  action: Action
  accelerator: string
  ok: boolean
  critical: boolean
  reason: string
  recommended: string
}

let shortcutFailures: ShortcutFailure[] = []
let recordingShortcuts = false
let peekHookInstalled = false
let peekHookStarted = false
let peekHookError = ''

const ACTIONS: Action[] = [
  'hide',
  'peek',
  'boss',
  'playpause',
  'mute',
  'mode',
  'passthrough',
  'fullscreen'
]
const CRITICAL_ACTIONS = new Set<Action>(['hide', 'peek', 'boss'])

export const getShortcutFailures = (): ShortcutFailure[] => [...shortcutFailures]
export const isRecordingShortcuts = (): boolean => recordingShortcuts

// 引导闯关回声：把真实动作（含状态机内部 REVIVE）+ 现态广播给蒙版页
function echoToOnboarding(action: string): void {
  getOnboarding()?.webContents.send('demo:key', { action, mode: machine?.mode() ?? 'NORMAL' })
  raiseOnboarding()
}

const EVENT_ACTION: Record<string, string> = {
  HIDE_TOGGLE: 'hide',
  BOSS: 'boss',
  PEEK_DOWN: 'peek-down',
  PEEK_UP: 'peek-up',
  REVIVE: 'revive'
  // FORCE_* 是预置动作，不回声给闯关判定
}

// ============================================================
// 注入页面的 video 控制片段：操作"面积最大的就绪视频"，无就绪视频时回退到最大视频
// （首启未缓冲 readyState 0 也选得中；能否真的起播取决于 runJs 的 userGesture）
// ============================================================
const JS_PAUSE_ALL = `document.querySelectorAll('video').forEach(v => v.pause())`

const mainVideo = `(() => {
  const vids = [...document.querySelectorAll('video')].sort((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return rb.width * rb.height - ra.width * ra.height
  })
  // 优先就绪视频；首启暂停且未缓冲(readyState 0)时回退到最大视频——play() 会自行触发加载
  return vids.find(v => v.readyState > 0) ?? vids[0] ?? null
})()`

const JS_PLAY_MAIN = `(() => { const v = ${mainVideo}; if (v) v.play() })()`
const JS_TOGGLE_MAIN = `(() => { const v = ${mainVideo}; if (v) v.paused ? v.play() : v.pause() })()`
const JS_PAGE_MUTED = `(() => { const v = ${mainVideo}; return v ? (v.muted || v.volume === 0) : null })()`
const JS_UNMUTE_PAGE = `(() => { const v = ${mainVideo}; if (!v) return; v.muted = false; if (v.volume === 0) v.volume = 1 })()`

function runJs(code: string): void {
  // 第二参 userGesture=true：模拟用户手势，绕过浏览器自动播放策略——
  // 否则首启暂停且从未被真实点击过的视频，脚本 v.play() 会被拦截、静默 reject。
  getFloat()
    ?.pageView.webContents.executeJavaScript(code, true)
    .catch(() => {})
}

// 供控制条 IPC 复用——按钮永远只是快捷键的回显
export const togglePlayPause = (): void => runJs(JS_TOGGLE_MAIN)

export const dispatchHideToggle = (): void => machine?.dispatch('HIDE_TOGGLE')

// 闯关状态预置：每关开始前把真实窗口摆到该关需要的起点
export const prepareDemo = (target: 'NORMAL' | 'HIDDEN'): void =>
  machine?.dispatch(target === 'NORMAL' ? 'FORCE_NORMAL' : 'FORCE_HIDDEN')

// 双层静音联动：有效静音 = Chromium 级 OR 站内播放器级（muted/音量为零）。
// 取消静音时两层一起打开，覆写站内播放器自己的静音状态
export async function toggleMute(): Promise<void> {
  const wc = getFloat()?.pageView.webContents
  if (!wc) return
  const pageMuted = (await wc.executeJavaScript(JS_PAGE_MUTED).catch(() => null)) as boolean | null
  if (pageMuted === null) {
    wc.send('state:muted', false)
    return
  }
  const effectiveMuted = wc.isAudioMuted() || pageMuted
  if (effectiveMuted) {
    wc.setAudioMuted(false)
    runJs(JS_UNMUTE_PAGE)
  } else {
    wc.setAudioMuted(true)
  }
  wc.send('state:muted', !effectiveMuted)
}

function execute(effect: Effect): void {
  const f = getFloat()
  switch (effect) {
    case 'HIDE':
      hideFloatWindow()
      break
    case 'SHOW':
      showFloatWindow()
      break
    case 'MUTE':
      f?.pageView.webContents.setAudioMuted(true)
      break
    case 'UNMUTE':
      f?.pageView.webContents.setAudioMuted(false)
      break
    case 'PAUSE':
      runJs(JS_PAUSE_ALL)
      break
    case 'PLAY':
      runJs(JS_PLAY_MAIN)
      break
    case 'QUIT':
      // 引导期守门：闯关演示老板键时双击不退出（防 demo 误杀进程）
      if (!isOnboarding()) app.quit()
      break
  }
}

let machine: Machine | null = null

// ============================================================
// 长按 peek：uiohook 观测 keydown/keyup（globalShortcut 无 keyup）。
// 键位规格随每次按键从 store 现读——改键即时生效，无需重启钩子。
// macOS 未授辅助功能权限时 uIOhook.start() 会崩溃——前置检查降级。
// ============================================================
interface PeekSpec {
  code: number
  alt: boolean
  shift: boolean
  ctrl: boolean
  meta: boolean
}

function peekSpecFrom(accelerator: string): PeekSpec | null {
  const parts = accelerator.split('+')
  const key = parts[parts.length - 1].toUpperCase()
  const code = (UiohookKey as Record<string, number>)[key]
  if (!code) return null
  return {
    code,
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
    ctrl: parts.includes('Control'),
    meta: parts.some((p) => p === 'Command' || p === 'Super' || p === 'Meta')
  }
}

function peekSpec(): PeekSpec | null {
  return peekSpecFrom(store.data.shortcuts.peek)
}

function setupPeekKey(): void {
  // 权限自愈：未授权则轮询等待，用户在系统设置打开开关后立即激活，无需重启
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    console.warn('[shortcuts] 辅助功能未授权，长按显示待命轮询中')
    const poll = setInterval(() => {
      if (systemPreferences.isTrustedAccessibilityClient(false)) {
        clearInterval(poll)
        startPeekHook()
      }
    }, 5000)
    app.on('will-quit', () => clearInterval(poll))
    return
  }
  startPeekHook()
}

function startPeekHook(): void {
  if (peekHookStarted) return
  let held = false
  if (!peekHookInstalled) {
    uIOhook.on('keydown', (e) => {
      if (recordingShortcuts) return
      const s = peekSpec()
      if (!s || held) return
      if (
        e.keycode === s.code &&
        e.altKey === s.alt &&
        e.shiftKey === s.shift &&
        e.ctrlKey === s.ctrl &&
        e.metaKey === s.meta
      ) {
        held = true
        machine?.dispatch('PEEK_DOWN')
      }
    })
    uIOhook.on('keyup', (e) => {
      if (recordingShortcuts) return
      const s = peekSpec()
      if (held && s && e.keycode === s.code) {
        held = false
        machine?.dispatch('PEEK_UP')
      }
    })
    peekHookInstalled = true
    app.on('will-quit', () => uIOhook.stop())
  }
  try {
    uIOhook.start()
    peekHookStarted = true
    peekHookError = ''
  } catch (err) {
    peekHookStarted = false
    peekHookError = err instanceof Error ? err.message : String(err)
  }
}

// ============================================================
// 绑定全部 globalShortcut（从 store 现读）；改键后调 rebindShortcuts()
// ============================================================
function handlerFor(action: Action): () => void {
  const m = machine!
  const notFeign = (fn: () => void) => (): void => {
    if (m.mode() !== 'FEIGN') fn()
  }
  switch (action) {
    case 'hide':
      return () => m.dispatch('HIDE_TOGGLE')
    case 'boss':
      return () => m.dispatch('BOSS')
    case 'playpause':
      return notFeign(togglePlayPause)
    case 'mute':
      return notFeign(() => {
        void toggleMute()
        echoToOnboarding('mute')
      })
    case 'mode':
      return notFeign(() => {
        void toggleCinema()
        echoToOnboarding('mode')
      })
    case 'passthrough':
      return () => {
        togglePassthrough()
        echoToOnboarding('passthrough')
      }
    case 'fullscreen':
      return notFeign(() => toggleWindowFullscreen())
    case 'peek':
      return () => {}
  }
}

function bindAction(action: Action): void {
  shortcutFailures = shortcutFailures.filter((f) => f.action !== action)
  const accelerator = store.data.shortcuts[action]
  if (!globalShortcut.register(accelerator, handlerFor(action))) {
    shortcutFailures.push({ action, accelerator })
    console.warn(`[shortcuts] 注册失败：${action} -> ${accelerator}`)
  }
}

function bindAll(): void {
  if (recordingShortcuts) return
  shortcutFailures = []
  for (const action of ACTIONS) bindAction(action)
}

export function rebindShortcuts(): void {
  globalShortcut.unregisterAll()
  bindAll()
}

function duplicateAction(
  action: Action,
  accelerator: string,
  shortcuts: ShortcutMap = store.data.shortcuts
): Action | null {
  return (
    (Object.entries(shortcuts).find(([a, acc]) => a !== action && acc === accelerator)?.[0] as
      | Action
      | undefined) ?? null
  )
}

export function recommendedShortcut(accelerator: string): string {
  const key = accelerator.split('+').at(-1) ?? accelerator
  return accelerator.startsWith('Control+') ? `Alt+Shift+${key}` : `Control+${key}`
}

export function probeShortcut(
  action: Action,
  accelerator: string
): { ok: boolean; reason?: string } {
  const dup = duplicateAction(action, accelerator)
  if (dup)
    return {
      ok: false,
      reason: t(
        'This shortcut is already used by another Peeko action',
        '该按键已被其他 Peeko 动作占用'
      )
    }

  const current = store.data.shortcuts[action]
  const wasCurrentRegistered = globalShortcut.isRegistered(current)
  if (wasCurrentRegistered) globalShortcut.unregister(current)

  const ok = globalShortcut.register(accelerator, () => {})
  if (ok) globalShortcut.unregister(accelerator)
  if (wasCurrentRegistered && !recordingShortcuts) bindAction(action)

  return ok
    ? { ok: true }
    : {
        ok: false,
        reason: t(
          'This shortcut is already used by macOS or another app',
          '该按键已被系统或其他软件占用'
        )
      }
}

export function setShortcut(
  action: Action,
  accelerator: string
): { ok: boolean; reason?: string; health: ShortcutHealth[] } {
  const probe = probeShortcut(action, accelerator)
  if (!probe.ok) return { ...probe, health: getShortcutHealth() }

  const sc: ShortcutMap = { ...store.data.shortcuts, [action]: accelerator }
  store.patch({ shortcuts: sc })
  if (!recordingShortcuts) rebindShortcuts()
  return { ok: true, health: getShortcutHealth() }
}

export function beginShortcutRecording(): void {
  recordingShortcuts = true
  globalShortcut.unregisterAll()
}

export function endShortcutRecording(): ShortcutHealth[] {
  recordingShortcuts = false
  rebindShortcuts()
  return getShortcutHealth()
}

export function applyRecommendedShortcuts(): { ok: boolean; health: ShortcutHealth[] } {
  beginShortcutRecording()
  const next: ShortcutMap = { ...store.data.shortcuts }
  for (const h of getShortcutHealth()) {
    if (!h.ok && h.critical) {
      const probe = probeShortcut(h.action, h.recommended)
      if (probe.ok) next[h.action] = h.recommended
    }
  }
  store.patch({ shortcuts: next })
  const health = endShortcutRecording()
  return { ok: !health.some((h) => h.critical && !h.ok), health }
}

export function getShortcutHealth(): ShortcutHealth[] {
  if (
    process.platform === 'darwin' &&
    systemPreferences.isTrustedAccessibilityClient(false) &&
    !peekHookStarted
  ) {
    startPeekHook()
  }

  const failures = new Map(shortcutFailures.map((f) => [f.action, f.accelerator]))
  return ACTIONS.map((action) => {
    const accelerator = store.data.shortcuts[action]
    const critical = CRITICAL_ACTIONS.has(action)
    const reasons: string[] = []

    if (failures.get(action) === accelerator) {
      reasons.push(
        t('Shortcut is already used by macOS or another app', '快捷键已被系统或其他软件占用')
      )
    }
    if (action === 'peek') {
      if (!peekSpecFrom(accelerator)) {
        reasons.push(t('Hold-to-peek does not support this key yet', '长按监听暂不支持这个按键'))
      }
      if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
        reasons.push(t('Waiting for Accessibility permission', '等待辅助功能权限'))
      } else if (!peekHookStarted) {
        reasons.push(
          peekHookError
            ? t(`Hold listener failed: ${peekHookError}`, `长按监听启动失败：${peekHookError}`)
            : t('Hold listener has not started', '长按监听未启动')
        )
      }
    }

    return {
      action,
      accelerator,
      ok: reasons.length === 0,
      critical,
      reason: reasons.join('；'),
      recommended: recommendedShortcut(accelerator)
    }
  })
}

export function hasCriticalShortcutIssues(): boolean {
  return getShortcutHealth().some((h) => h.critical && !h.ok)
}

export function registerShortcuts(): void {
  machine = createMachine(execute, undefined, (ev, mode) => {
    const action = EVENT_ACTION[ev]
    if (action) {
      getOnboarding()?.webContents.send('demo:key', { action, mode })
      raiseOnboarding()
    }
  })
  bindAll()
  setupPeekKey()
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
