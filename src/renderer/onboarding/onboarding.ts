/**
 * [INPUT]: 依赖 preload/ui.ts 暴露的 window.peeko 桥（demo:key 事件流 + prep/授权/完成通道）
 * [OUTPUT]: 首启蒙版编排 v6——权限门 → logo 呼吸 → 光团爆发 tagline → 五关闯关
 *           （系统语言单语、键帽实时点亮、按住校验、工具栏图例关）
 * [POS]: renderer/onboarding 的逻辑层，闯关由主进程广播的真实按键事件驱动
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { tx, type LanguageSettings, type ResolvedLanguage } from '../../shared/i18n'
import { DEFAULT_SHORTCUTS, type Action } from '../../shared/shortcuts'

interface PeekoBridge {
  getLanguage(): Promise<LanguageSettings>
  onboardingDone(): void
  onboardingClose(): void
  quitPeeko(): void
  prepDemo(target: 'NORMAL' | 'HIDDEN'): void
  floatRect(): Promise<{ x: number; y: number; w: number; h: number } | null>
  setFullscreenDemo(on: boolean): void
  setIgnoreMouse(on: boolean): void
  restoreOnboarding(): Promise<void>
  startRuntime(): Promise<void>
  setMode(mode: string, demoGeometry?: boolean): Promise<void>
  shouldRunIntro(): Promise<boolean>
  shortcutHealth(): Promise<ShortcutHealth[]>
  applyRecommendedShortcuts(): Promise<{ ok: boolean; health: ShortcutHealth[] }>
  axTrusted(): Promise<boolean>
  openAxSettings(): void
  openSettings(): void
  onLanguage(cb: (language: LanguageSettings) => void): void
  onDemoKey(cb: (p: { action: string; mode: string }) => void): void
}

interface ShortcutHealth {
  action: string
  accelerator: string
  ok: boolean
  critical: boolean
  reason: string
  recommended: string
}

const peeko = (window as unknown as { peeko: PeekoBridge }).peeko

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

let language: ResolvedLanguage = 'en'
const t = (en: string, zh: string): string => tx(language, en, zh)

let finished = false
let introReady = false
let shortcutHealth: ShortcutHealth[] = []

function applyLanguage(next: LanguageSettings): void {
  language = next.resolved
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  document.title = t('Welcome to Peeko', '欢迎使用 Peeko')
  $('skip').textContent = t('Skip', '跳过')
  renderTagline()
  CHALLENGES = CHALLENGES.length ? makeChallenges() : CHALLENGES
  MODE_GUIDES = MODE_GUIDES.length ? makeModeGuides() : MODE_GUIDES
  refreshVisibleCopy()
}

function renderTagline(): void {
  $('tagline').replaceChildren(
    document.createTextNode('Keep working.'),
    document.createElement('br'),
    document.createTextNode('Keep half-watching.')
  )
}

function refreshVisibleCopy(): void {
  if (!$('permission-gate').hidden) {
    document.body.dataset.permission === 'restart'
      ? showPermissionRestartState()
      : showPermissionRequestState()
  }
  if (!$('shortcut-gate').hidden) renderShortcutGate()
  if (current >= 0 && CHALLENGES[current]) refreshCurrentChallengeCopy()
  if (currentModeGuide >= 0 && MODE_GUIDES[currentModeGuide]) refreshCurrentModeGuideCopy()
  if (!$('finale').hidden) renderFinaleCopy()
}

function exitTour(): void {
  if (finished) return
  finished = true
  document.body.classList.add('exit')
  setTimeout(() => peeko.onboardingClose(), reducedMotion ? 0 : 300)
}

function finish(): void {
  if (!introReady) return
  if (finished) return
  finished = true
  document.body.classList.add('exit')
  setTimeout(() => peeko.onboardingDone(), reducedMotion ? 0 : 300)
}

$('skip').addEventListener('click', finish)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') exitTour()
})

// ============================================================
// Act 0：权限门。先拿到长按监听所需权限，再启动正式 intro。
// ============================================================
function showPermissionRequestState(): void {
  document.body.dataset.permission = 'request'
  $('skip').hidden = true
  $('permission-step').textContent = t('Permission first', '先开权限')
  $('permission-title').textContent = t('Let Peeko hear the shortcut', '让 Peeko 听见快捷键')
  $('permission-icon').textContent = shortcutText('peek')
  $('permission-icon').hidden = false
  $('permission-copy').textContent = t(
    'Peeko needs macOS Accessibility access for the hold-to-peek shortcut. No capture, no recording — just key events.',
    'Peeko 需要 macOS 辅助功能权限来识别长按偷看快捷键。不会录屏，不会录音，只监听快捷键。'
  )
  $('permission-action').textContent = t('Open System Settings', '打开系统设置')
  $('permission-check').textContent = t("I've granted access", '我已经授权了')
  $('permission-quit').textContent = t('Quit Peeko', '关闭 Peeko')
  $('permission-action').hidden = false
  $('permission-check').hidden = true
  $('permission-quit').hidden = true
  $('permission-status').textContent = t('Waiting for permission…', '等待授权中……')
}

function showPermissionRestartState(): void {
  document.body.dataset.permission = 'restart'
  $('permission-step').textContent = t('Restart Peeko', '重启 Peeko')
  $('permission-title').textContent = t('Try reopening Peeko', '试试重启 Peeko')
  $('permission-icon').textContent = '↻'
  $('permission-copy').textContent = t(
    'macOS still has not reported Accessibility access. Quit Peeko, reopen it, and the permission check will run again before the intro starts.',
    'macOS 还没有把辅助功能权限同步给 Peeko。先退出 Peeko，再重新打开；下次会先检测权限，再继续介绍流程。'
  )
  $('permission-action').hidden = true
  $('permission-check').hidden = true
  $('permission-quit').hidden = false
  $('permission-status').textContent = ''
}

async function waitForRequiredPermissions(): Promise<void> {
  document.body.classList.add('lit')
  if (await peeko.axTrusted()) return

  showPermissionRequestState()
  const gate = $('permission-gate')
  let granted = false
  gate.hidden = false
  $('permission-action').onclick = (): void => {
    $('permission-check').hidden = false
    $('permission-status').textContent = t(
      'The card moved aside. Turn on Peeko, then click the check button.',
      '提示卡已经让开。打开 Peeko 的开关后，点“我已经授权了”。'
    )
    peeko.openAxSettings()
  }
  $('permission-check').onclick = async (): Promise<void> => {
    $('permission-status').textContent = t('Checking access…', '正在检测权限……')
    if (await peeko.axTrusted()) {
      granted = true
      $('permission-status').textContent = t('Access confirmed.', '权限已确认。')
      return
    }
    showPermissionRestartState()
  }
  $('permission-quit').onclick = (): void => peeko.quitPeeko()

  while (!finished && !granted) {
    await sleep(200)
  }
  gate.hidden = true
}

// ============================================================
// Act 0.5：核心快捷键健康门。逃生键必须先可靠，intro 才有意义。
// ============================================================
function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    hide: t('Hide / restore picture', '隐藏 / 恢复画面'),
    peek: t('Hold to peek', '长按临时显示'),
    boss: t('Vanish key', 'Vanish 键'),
    quit: t('Quit Peeko', '退出 Peeko'),
    playpause: t('Play / pause', '播放 / 暂停'),
    mute: t('Mute', '静音'),
    volumeUp: t('Volume up', '音量增加'),
    volumeDown: t('Volume down', '音量降低'),
    mode: t('Cinema / browse mode', '观影 / 浏览模式'),
    passthrough: t('Click-through', '鼠标穿透'),
    fullscreen: t('Browser fullscreen', '浏览器全屏'),
    opacityUp: t('Click-through opacity up', '穿透不透明度增加'),
    opacityDown: t('Click-through opacity down', '穿透不透明度降低'),
    seekBack: t('Seek backward', '快退'),
    seekForward: t('Seek forward', '快进')
  }
  return labels[action] ?? action
}

function criticalShortcutIssues(): ShortcutHealth[] {
  return shortcutHealth.filter((h) => h.critical && !h.ok)
}

function renderShortcutGate(): void {
  $('shortcut-step').textContent = t('Shortcuts first', '先修快捷键')
  $('shortcut-title').textContent = t('Peeko needs working escape keys', '先保证逃生键可用')
  $('shortcut-copy').textContent = t(
    'These global shortcuts are already taken or unavailable. Fix them before the tour starts.',
    '这些全局快捷键已被占用或不可用。先修好它们，再进入教学。'
  )
  $('shortcut-recommend').textContent = t('Use fallback keys', '使用备用键位')
  $('shortcut-settings').textContent = t('Open Settings', '打开设置')
  $('shortcut-quit').textContent = t('Quit Peeko', '关闭 Peeko')

  const list = $('shortcut-list')
  list.replaceChildren()
  for (const h of criticalShortcutIssues()) {
    const row = document.createElement('div')
    row.className = 'shortcut-row'
    const name = document.createElement('strong')
    name.textContent = actionLabel(h.action)
    const meta = document.createElement('span')
    meta.textContent = `${acceleratorKeys(h.accelerator).join('')} → ${acceleratorKeys(
      h.recommended
    ).join('')}`
    const reason = document.createElement('small')
    reason.textContent = h.reason
    row.append(name, meta, reason)
    list.appendChild(row)
  }
}

async function waitForShortcutHealth(): Promise<void> {
  shortcutHealth = await peeko.shortcutHealth()
  if (!criticalShortcutIssues().length) return

  const gate = $('shortcut-gate')
  $('skip').hidden = true
  gate.hidden = false
  renderShortcutGate()

  $('shortcut-recommend').onclick = async (): Promise<void> => {
    $('shortcut-status').textContent = t('Trying recommended shortcuts…', '正在尝试推荐快捷键……')
    const res = await peeko.applyRecommendedShortcuts()
    shortcutHealth = res.health
    renderShortcutGate()
    $('shortcut-status').textContent = res.ok
      ? t('Shortcuts are ready.', '快捷键已可用。')
      : t(
          'Some shortcuts still need manual changes in Settings.',
          '还有快捷键需要在设置里手动修改。'
        )
  }
  $('shortcut-settings').onclick = (): void => {
    peeko.openSettings()
    $('shortcut-status').textContent = t(
      'Change the highlighted shortcuts, then return here.',
      '在设置里改好冲突快捷键，然后回到这里。'
    )
  }
  $('shortcut-quit').onclick = (): void => peeko.quitPeeko()

  while (!finished && criticalShortcutIssues().length) {
    await sleep(600)
    shortcutHealth = await peeko.shortcutHealth()
    renderShortcutGate()
  }
  gate.hidden = true
}

// ============================================================
// Act I：logo 呼吸 → 光团爆发显字 → 全屏光影扫过
// ============================================================
async function actIntro(): Promise<void> {
  document.body.classList.add('lit')
  $('logo-act').hidden = false
  await sleep(1100)

  const logo = $('logo')
  logo.classList.add('in')
  await sleep(2600)
  logo.classList.add('out')
  await sleep(1100)
  $('logo-act').hidden = true

  const act = $('tagline-act')
  act.hidden = false
  await sleep(200)

  const orb = $('orb')
  orb.classList.add('grow')
  await sleep(1500)
  orb.classList.remove('grow')
  orb.classList.add('burst')
  $('tagline').classList.add('in')
  await sleep(800)
  $('shine').classList.add('run')
  await sleep(2600)
  act.hidden = true
}

// ============================================================
// 键帽：渲染 + 物理按键实时点亮
// ============================================================
interface CapRef {
  label: string
  el: HTMLElement
}

let liveCaps: CapRef[] = []
const downLabels = new Set<string>()
const pulseLabels = new Set<string>()
const heldLabels = new Set<string>()
const ACTION_FLASH_MS = 520

const EVENT_TO_ACTION: Record<string, string> = {
  hide: 'hide',
  mute: 'mute',
  boss: 'boss',
  'peek-down': 'peek',
  'peek-up': 'peek',
  passthrough: 'passthrough'
}

function shortcutFor(action: string): string {
  return shortcutHealth.find((h) => h.action === action)?.accelerator ?? defaultShortcut(action)
}

function defaultShortcut(action: string): string {
  return action in DEFAULT_SHORTCUTS ? DEFAULT_SHORTCUTS[action as Action] : ''
}

function acceleratorKeys(accelerator: string): string[] {
  if (!accelerator) return []
  return accelerator.split('+').map((part) => {
    if (part === 'CommandOrControl' || part === 'Command' || part === 'Meta' || part === 'Super')
      return '⌘'
    if (part === 'Control') return '⌃'
    if (part === 'Alt' || part === 'Option') return '⌥'
    if (part === 'Shift') return '⇧'
    if (part.startsWith('Key')) return part.slice(3).toUpperCase()
    return part.toUpperCase()
  })
}

function shortcutKeys(action: string): string[] {
  return acceleratorKeys(shortcutFor(action))
}

function shortcutText(action: string): string {
  return shortcutKeys(action).join('')
}

function eventKeys(action: string): string[] {
  return shortcutKeys(EVENT_TO_ACTION[action] ?? action)
}

function keycaps(container: HTMLElement, keys: string[]): void {
  container.replaceChildren()
  liveCaps = keys.map((k) => {
    const cap = document.createElement('div')
    cap.className = 'keycap'
    cap.textContent = k
    container.appendChild(cap)
    return { label: k, el: cap }
  })
  applyCapLights()
}

function keyLabel(e: KeyboardEvent): string | null {
  if (e.code.startsWith('Key')) return e.code.slice(3).toUpperCase()
  if (e.code === 'AltLeft' || e.code === 'AltRight') return '⌥'
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return '⇧'
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') return '⌃'
  if (e.code === 'MetaLeft' || e.code === 'MetaRight') return '⌘'
  return null
}

function syncModifiers(e: KeyboardEvent): void {
  downLabels[e.altKey ? 'add' : 'delete']('⌥')
  downLabels[e.shiftKey ? 'add' : 'delete']('⇧')
  downLabels[e.ctrlKey ? 'add' : 'delete']('⌃')
  downLabels[e.metaKey ? 'add' : 'delete']('⌘')
}

function applyCapLights(): void {
  for (const { label, el } of liveCaps) {
    const lit = downLabels.has(label) || pulseLabels.has(label) || heldLabels.has(label)
    el.classList.toggle('press', lit)
  }
}

function syncHeldAction(action: string): void {
  if (action === 'peek-down') {
    eventKeys('peek-down').forEach((k) => heldLabels.add(k))
    applyCapLights()
    return
  }
  if (action === 'peek-up') {
    eventKeys('peek-down').forEach((k) => heldLabels.delete(k))
    applyCapLights()
  }
}

// 修饰键由事件标志位驱动，字母键由 code 集合驱动——按下即亮，松开即灭
window.addEventListener(
  'keydown',
  (e) => {
    const label = keyLabel(e)
    if (label) downLabels.add(label)
    syncModifiers(e)
    applyCapLights()
  },
  true
)
window.addEventListener(
  'keyup',
  (e) => {
    const label = keyLabel(e)
    if (label) downLabels.delete(label)
    syncModifiers(e)
    applyCapLights()
  },
  true
)
window.addEventListener('blur', () => {
  downLabels.clear()
  pulseLabels.clear()
  applyCapLights()
})

async function flashActionKeys(action: string): Promise<void> {
  const keys = eventKeys(action)
  if (!keys.length) return
  keys.forEach((k) => pulseLabels.add(k))
  applyCapLights()
  // 这是语义反馈，不是装饰动画；减少动态效果也不能让按键反馈瞬间消失。
  await sleep(ACTION_FLASH_MS)
  keys.forEach((k) => pulseLabels.delete(k))
  applyCapLights()
}

// ============================================================
// Act II：五关闯关
// ============================================================
interface Phase {
  hint: string
  keys?: string[] // 本阶段要按的键（不填沿用关卡主键）
}

interface Challenge {
  title: string
  keys: string[]
  phases: Phase[]
  fact: string
  prep: 'NORMAL' | 'HIDDEN'
  on: (action: string, mode: string, phase: number) => number | 'done' | 'retry'
  retry?: string
  needsAx?: boolean
  legend?: boolean // 第五关：展示工具栏图例
}

interface ModeGuide {
  mode: string
  title: string
  keys: string[]
  hint: string
  fact: string
}

let peekDownAt = 0
const HOLD_MS = 800

let CHALLENGES: Challenge[] = []

function makeChallenges(): Challenge[] {
  return [
    {
      title: t('The Vanish', '消失术'),
      keys: shortcutKeys('hide'),
      phases: [
        {
          keys: shortcutKeys('mute'),
          hint: t(
            `First, press ${shortcutText('mute')} and make sure you can HEAR the video.`,
            `先按 ${shortcutText('mute')} 把声音打开——确认你能听到视频的声音。`
          )
        },
        {
          hint: t(
            `Now press ${shortcutText('hide')} to hide the window. Keep listening…`,
            `现在按 ${shortcutText('hide')} 隐藏浮窗。注意听——`
          )
        },
        {
          hint: t(
            `Hear that? The sound never stopped. Press ${shortcutText('hide')} again.`,
            `听到了吗？声音一直都在。再按 ${shortcutText('hide')} 把画面召回来。`
          )
        }
      ],
      fact: t('🔊 Picture hides. Audio never stops.', '🔊 画面隐藏，声音永不中断——"只听球"模式。'),
      prep: 'NORMAL',
      on: (a, _m, phase) => {
        if (phase === 0 && a === 'mute') return 1
        if (phase === 1 && a === 'hide') return 2
        if (phase === 2 && a === 'hide') return 'done'
        return phase
      }
    },
    {
      title: t('The Peek', '偷看一眼'),
      keys: shortcutKeys('peek'),
      phases: [
        {
          hint: t(
            'The window is hidden. Press and HOLD the keys to peek at it.',
            '浮窗已经藏好了。按住这组键不放，偷看一眼。'
          )
        },
        {
          hint: t(
            'Keep holding… now release to let it slip away.',
            '保持按住……然后松手，让它溜走。'
          )
        }
      ],
      fact: t(
        '👁 Visible only while you hold. Release = gone.',
        '👁 按住才显形，松手即消失——精彩瞬间快速瞄一眼。'
      ),
      prep: 'HIDDEN',
      needsAx: true,
      retry: t('Too quick! Hold the keys down — really hold them.', '太快了！要一直按住不放才算。'),
      on: (a, _m, phase) => {
        if (a === 'peek-down') {
          peekDownAt = Date.now()
          return 1
        }
        if (a === 'peek-up' && phase === 1) {
          return Date.now() - peekDownAt >= HOLD_MS ? 'done' : 'retry'
        }
        return phase
      }
    },
    {
      title: t('The Vanish Key', 'Vanish 键'),
      keys: shortcutKeys('boss'),
      phases: [
        {
          hint: t(
            'Hide the picture, mute the sound, and pause instantly. Press once.',
            '隐藏画面、静音并暂停。按一下试试。'
          )
        }
      ],
      fact: t(
        '⚡ To quit Peeko entirely, use Control+Q or Command+Q.',
        '⚡ 要彻底退出 Peeko，用 Control+Q 或 Command+Q。'
      ),
      prep: 'NORMAL',
      on: (a, _m, phase) => {
        if (a === 'boss' && phase === 0) return 'done'
        return phase
      }
    },
    {
      title: t('The Ghost', '幽灵模式'),
      keys: shortcutKeys('passthrough'),
      phases: [
        {
          hint: t(
            'Press, then try clicking ON the window — your clicks land on whatever is UNDER it.',
            '按下后，试着点浮窗——你的点击会落在它"下面"的应用上。'
          )
        },
        {
          hint: t(
            'You just clicked through it. Press again to become solid.',
            '刚才那下穿过去了——鼠标操控的是下层窗口。再按一次恢复实体。'
          )
        }
      ],
      fact: t(
        '👻 Not just transparency — your mouse controls what is underneath.',
        '👻 不只是半透明：穿透时鼠标直接操作浮窗底下的东西。'
      ),
      prep: 'NORMAL',
      on: (a, _m, phase) => (a === 'passthrough' ? (phase === 0 ? 1 : 'done') : phase)
    },
    {
      title: t('The Toolbar', '工具栏'),
      keys: [],
      phases: [
        {
          hint: t(
            'One last thing — move your mouse over the window in the corner.',
            '最后一件事——把鼠标移到角落的浮窗上。'
          )
        },
        {
          hint: t(
            'Hover the window anytime to bring up this glass toolbar — here is every button:',
            '任何时候把鼠标移到浮窗上，就会浮出这条玻璃工具栏。每个按钮的用途：'
          )
        }
      ],
      fact: '',
      prep: 'NORMAL',
      legend: true,
      on: (a, _m, phase) => (phase === 0 && a === 'bar-hover' ? 1 : phase)
    }
  ]
}

let current = -1
let phase = 0
let currentModeGuide = -1

function renderDots(): void {
  const dots = $('dots')
  dots.replaceChildren()
  CHALLENGES.forEach((_, i) => {
    const d = document.createElement('div')
    d.className = 'dot' + (i <= current ? ' on' : '')
    dots.appendChild(d)
  })
}

// ---------- 工具栏图例（与控制条同源的 Feather 线条） ----------
type Shape = [string, Record<string, string>]

const LEGEND_ICONS: Record<string, Shape[]> = {
  back: [
    ['line', { x1: '19', y1: '12', x2: '5', y2: '12' }],
    ['polyline', { points: '12 19 5 12 12 5' }]
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }]
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
  play: [['polygon', { points: '6 3 20 12 6 21 6 3' }]],
  vol: [
    ['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07' }]
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
  gear: [
    ['circle', { cx: '12', cy: '12', r: '3' }],
    [
      'path',
      {
        d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
      }
    ]
  ],
  pointer: [
    ['path', { d: 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' }],
    ['path', { d: 'M13 13l6 6' }]
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
  ]
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function legendIcon(name: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  for (const [tag, attrs] of LEGEND_ICONS[name]) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    svg.appendChild(node)
  }
  return svg
}

interface LegendItem {
  icon: string | null // null = 文字符号
  glyph?: string
  label: string
}

function makeLegend(): LegendItem[] {
  return [
    { icon: 'back', label: t('Back to previous page', '返回上一页') },
    { icon: 'link', label: t('Short address bar — click to edit URL', '短地址栏：点击修改网址') },
    { icon: 'star', label: t('Favorites — save & jump', '收藏夹：存台 / 换台') },
    { icon: null, glyph: '⚽', label: t('World Cup home', '世界杯直播主页') },
    { icon: 'play', label: t('Play / pause', '播放 / 暂停') },
    { icon: 'vol', label: t('Mute · hover for volume', '静音 · 悬停出音量条') },
    { icon: 'cinema', label: t('Cinema ⇄ browse mode', '观影 ⇄ 浏览模式') },
    { icon: 'expand', label: t('Browser fullscreen · Esc to exit', '浏览器全屏 · Esc 退出') },
    { icon: 'gear', label: t('Settings', '设置') },
    { icon: 'pointer', label: t('Ghost mode (click-through)', '穿透模式') },
    { icon: 'hand', label: t('Drag handle — move window', '拖把手：移动窗口') },
    { icon: 'x', label: t('Vanish: hide + mute + pause', 'Vanish：隐藏画面 + 静音 + 暂停') }
  ]
}

function renderLegend(): void {
  const box = $('card-legend')
  box.replaceChildren()
  for (const item of makeLegend()) {
    const row = document.createElement('div')
    row.className = 'legend-row'
    if (item.icon) {
      row.appendChild(legendIcon(item.icon))
    } else {
      const g = document.createElement('span')
      g.className = 'lg'
      g.textContent = item.glyph ?? ''
      row.appendChild(g)
    }
    const label = document.createElement('span')
    label.textContent = item.label
    row.appendChild(label)
    box.appendChild(row)
  }
  box.hidden = false
}

function setHint(text: string): void {
  $('card-hint').textContent = text
}

// ============================================================
// Act I.5：快捷键总览——正式闯关前一次看完所有键 + 一句功能说明
// ============================================================
const PRETTY_KEY: Record<string, string> = {
  ENTER: '⏎',
  SPACE: '␣',
  TAB: '⇥',
  UP: '↑',
  DOWN: '↓',
  LEFT: '←',
  RIGHT: '→'
}

interface CheatItem {
  action?: string
  keys?: string[]
  label: string
}

function makeCheats(): CheatItem[] {
  return [
    { action: 'mute', label: t('Mute / unmute the sound', '静音 / 取消静音') },
    { action: 'volumeUp', label: t('Volume up', '音量增大') },
    { action: 'volumeDown', label: t('Volume down', '音量减小') },
    { action: 'hide', label: t('Hide the picture — sound keeps playing', '隐藏画面，声音继续放') },
    {
      action: 'peek',
      label: t('Hold to keep visible; release to hide', '按住保持可见，松手隐藏')
    },
    {
      action: 'boss',
      label: t('Vanish key: hide picture, mute sound, and pause', 'Vanish 键：隐藏画面、静音并暂停')
    },
    { action: 'quit', label: t('Quit Peeko globally', '全局退出 Peeko') },
    {
      keys: ['⌘', 'Q'],
      label: t('Quit Peeko when Peeko is focused', 'Peeko 被选中时退出 Peeko')
    },
    {
      action: 'passthrough',
      label: t(
        'Ghost mode: clicks pass through to the app underneath',
        '穿透模式：鼠标点击穿到下层应用'
      )
    },
    {
      action: 'opacityUp',
      label: t('Click-through opacity up', '穿透时提高不透明度')
    },
    {
      action: 'opacityDown',
      label: t('Click-through opacity down', '穿透时降低不透明度')
    },
    { action: 'playpause', label: t('Play / pause', '播放 / 暂停') },
    { action: 'seekBack', label: t('Seek backward 10 seconds', '快退 10 秒') },
    { action: 'seekForward', label: t('Seek forward 10 seconds', '快进 10 秒') },
    { action: 'mode', label: t('Cinema / browse mode', '观影 / 浏览模式') },
    {
      action: 'fullscreen',
      label: t('Browser fullscreen (Esc to exit)', '浏览器全屏（Esc 退出）')
    }
  ]
}

function renderCheats(): void {
  const list = $('cheat-list')
  list.replaceChildren()
  for (const c of makeCheats()) {
    const row = document.createElement('div')
    row.className = 'cheat-row'
    const caps = document.createElement('div')
    caps.className = 'cheat-keys'
    for (const k of c.keys ?? shortcutKeys(c.action ?? '')) {
      const cap = document.createElement('div')
      cap.className = 'keycap'
      cap.textContent = PRETTY_KEY[k] ?? k
      caps.appendChild(cap)
    }
    const label = document.createElement('span')
    label.className = 'cheat-label'
    label.textContent = c.label
    row.append(caps, label)
    list.appendChild(row)
  }
}

// 展示总览，等用户点"知道了"再 resolve（skip 时页面会关，挂起的 promise 自然作废）
function showShortcutSummary(): Promise<void> {
  return new Promise((resolve) => {
    renderCheats()
    $('cheat-title').textContent = t('Your keys', '你的快捷键')
    $('cheat-sub').textContent = t(
      "These keys run everything. Skim them — then we'll try a few together.",
      '这几个键就能搞定一切。先扫一眼，待会儿一起试几个。'
    )
    $('cheat-next').textContent = t("Got it — let's try a few", '知道了，来试几个')
    const sheet = $('cheatsheet')
    sheet.hidden = false
    requestAnimationFrame(() => sheet.classList.add('in'))
    $('cheat-next').onclick = (): void => {
      sheet.classList.remove('in')
      setTimeout(
        () => {
          sheet.hidden = true
          resolve()
        },
        reducedMotion ? 0 : 350
      )
    }
  })
}

function stepLabel(index: number): string {
  return t(
    `Challenge ${index + 1} of ${CHALLENGES.length}`,
    `第 ${index + 1} 关 · 共 ${CHALLENGES.length} 关`
  )
}

function enterPhase(c: Challenge, p: number): void {
  exitToolbarTry() // 默认收尾；下面图例阶段再开启
  phase = p
  const ph = c.phases[p]
  setHint(ph.hint)
  keycaps($('card-keys'), ph.keys ?? c.keys)
  // 第五关图例阶段：摊开工具清单 + 完成按钮 + 让用户能真去 hover 浮窗试工具栏
  if (c.legend && p === 1) {
    renderLegend()
    const action = $('card-action')
    action.textContent = t('Got it', '明白了')
    action.hidden = false
    action.onclick = (): void => completeCurrent()
    enterToolbarTry()
  }
}

function refreshCurrentChallengeCopy(): void {
  const c = CHALLENGES[current]
  $('card-step').textContent = stepLabel(current)
  $('card-title').textContent = c.title
  $('card-fact').textContent = c.fact
  enterPhase(c, phase)
}

// 完成音效：Web Audio 生成两声短促上行"叮咚"，无需打包音频资源
function playDing(): void {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    const notes: [number, number][] = [
      [880, 0],
      [1318.5, 0.085]
    ]
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + at)
      gain.gain.exponentialRampToValueAtTime(0.16, now + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + at)
      osc.stop(now + at + 0.3)
    }
    setTimeout(() => void ctx.close(), 700)
  } catch {
    // 无音频环境忽略
  }
}

function completeCurrent(): void {
  const idx = current
  if (idx < 0) return
  current = -1
  exitToolbarTry() // 工具栏"试一下"态收尾（恢复鼠标捕获）
  $('card-keys')
    .querySelectorAll('.keycap')
    .forEach((k) => {
      k.classList.remove('press')
      k.classList.add('complete') // 完成爆发：与"按下/按住"明显不同
    })
  playDing()
  setTimeout(() => {
    if (idx + 1 < CHALLENGES.length) void showChallenge(idx + 1)
    else void showModeGuide(0)
  }, 820)
}

async function showChallenge(index: number): Promise<void> {
  const card = $('card')
  card.classList.add('swap')
  await sleep(reducedMotion ? 0 : 300)

  current = index
  const c = CHALLENGES[index]
  $('card-step').textContent = stepLabel(index)
  $('card-title').textContent = c.title
  $('card-fact').textContent = c.fact
  $('card-legend').hidden = true
  const action = $('card-action')
  action.hidden = true
  renderDots()

  // The Peek 的前置：辅助功能授权流
  if (c.needsAx && !(await peeko.axTrusted())) {
    $('card-title').textContent = t('One permission first', '先开一个权限')
    $('card-fact').textContent = ''
    keycaps($('card-keys'), c.keys)
    setHint(
      t(
        'Holding a key needs Accessibility access. Grant it, then come back — Peeko picks it up automatically.',
        '长按监听需要"辅助功能"权限。去系统设置打开开关，回来即自动生效。'
      )
    )
    action.textContent = t('Open System Settings', '打开系统设置')
    action.hidden = false
    action.onclick = (): void => peeko.openAxSettings()
    const poll = setInterval(async () => {
      if (await peeko.axTrusted()) {
        clearInterval(poll)
        void showChallenge(index)
      }
    }, 2000)
    card.classList.remove('swap')
    return
  }

  peeko.prepDemo(c.prep)
  enterPhase(c, c.legend ? 1 : 0) // 工具栏关跳过 hover，直接展示工具图例给他看
  card.classList.remove('swap')
}

let demoSeq = 0

peeko.onDemoKey(async ({ action, mode }) => {
  if (current < 0 || finished) return
  syncHeldAction(action)
  const c = CHALLENGES[current]
  const next = c.on(action, mode, phase)
  if (next === phase) {
    return
  }

  const seq = ++demoSeq
  await flashActionKeys(action)
  if (seq !== demoSeq || current < 0 || finished || c !== CHALLENGES[current]) return

  if (next === 'done') {
    completeCurrent()
  } else if (next === 'retry') {
    enterPhase(c, 0)
    setHint(c.retry ?? '')
  } else {
    enterPhase(c, next)
  }
})

peeko.onLanguage((next) => {
  applyLanguage(next)
})

// ============================================================
// Act II.5：模式说明。讲模式差异时，旁边 demo 浮窗同步切到对应形态。
// ============================================================
let MODE_GUIDES: ModeGuide[] = []

function makeModeGuides(): ModeGuide[] {
  return [
    {
      mode: 'browse',
      title: t('Browse Mode', '浏览模式'),
      keys: [],
      hint: t(
        'Use this when you need login, search, change channels, or type a URL.',
        '登录、搜索、换台、输入网址时用浏览模式。'
      ),
      fact: t('Full web page, full control.', '完整网页，完整控制。')
    },
    {
      mode: 'cinema',
      title: t('Cinema Mode', '观影模式'),
      keys: [],
      hint: t(
        'After the main video plays for a few seconds, Peeko can shrink into video-only mode.',
        '主视频播放几秒后，Peeko 可以自动缩成只剩画面的小窗。'
      ),
      fact: t('Double-click the picture to return to Browse Mode.', '双击画面即可回到浏览模式。')
    },
    {
      mode: 'passthrough',
      title: t('Click-through Mode', '穿透模式'),
      keys: shortcutKeys('passthrough'),
      hint: t(
        `Press ${shortcutText('passthrough')} when the window should be visible but untouchable.`,
        `想看见画面、但鼠标要操作下层窗口时，按 ${shortcutText('passthrough')}。`
      ),
      fact: t('Your clicks land on the app underneath.', '鼠标点击会落到浮窗下面的应用。')
    },
    {
      mode: 'window-fullscreen-info',
      title: t('Browser Fullscreen', '浏览器全屏'),
      keys: shortcutKeys('fullscreen'),
      hint: t(
        `Press ${shortcutText('fullscreen')} to make the Peeko browser fill the screen.`,
        `按 ${shortcutText('fullscreen')}，让 Peeko 浏览器进入全屏。`
      ),
      fact: t(
        'Esc exits browser fullscreen. Website player fullscreen stays independent.',
        'Esc 退出浏览器全屏。网页播放器全屏保持独立。'
      )
    },
    {
      mode: 'web-fullscreen-info',
      title: t('Website Player Fullscreen', '网页播放器全屏'),
      keys: [],
      hint: t(
        'This is the fullscreen button inside the video website. Peeko allows it and uses the same player layer.',
        '这是视频网站播放器自己的全屏按钮。Peeko 会允许它，并使用同一层播放器全屏。'
      ),
      fact: t('Peeko allows website fullscreen requests.', 'Peeko 会允许网页播放器自己的全屏请求。')
    }
  ]
}

function renderModeDots(): void {
  const dots = $('dots')
  dots.replaceChildren()
  MODE_GUIDES.forEach((_, i) => {
    const d = document.createElement('div')
    d.className = 'dot' + (i <= currentModeGuide ? ' on' : '')
    dots.appendChild(d)
  })
}

async function showModeGuide(index: number): Promise<void> {
  current = -1
  currentModeGuide = index
  const card = $('card')
  card.classList.add('swap')
  await sleep(reducedMotion ? 0 : 300)

  const guide = MODE_GUIDES[index]
  await peeko.setMode(guide.mode, true) // true：摆演示位（浏览左上大窗 / 观影右下小窗）
  peeko.setFullscreenDemo(guide.mode === 'window-fullscreen-info') // 全屏那屏真进全屏，其余退出
  refreshCurrentModeGuideCopy()
  card.classList.remove('swap')
}

function refreshCurrentModeGuideCopy(): void {
  const index = currentModeGuide
  const guide = MODE_GUIDES[index]
  $('card-step').textContent = t(
    `Mode ${index + 1} of ${MODE_GUIDES.length}`,
    `模式 ${index + 1} · 共 ${MODE_GUIDES.length} 个`
  )
  $('card-title').textContent = guide.title
  $('card-hint').textContent = guide.hint
  $('card-fact').textContent = guide.fact
  $('card-legend').hidden = true
  keycaps($('card-keys'), guide.keys)
  renderModeDots()
  const action = $('card-action')
  action.textContent = index + 1 < MODE_GUIDES.length ? t('Next', '下一项') : t('Done', '完成')
  action.hidden = false
  action.onclick = (): void => {
    if (index + 1 < MODE_GUIDES.length) void showModeGuide(index + 1)
    else actFinale()
  }
}

// ============================================================
// Act III：终幕
// ============================================================
function actFinale(): void {
  peeko.prepDemo('NORMAL')
  peeko.setFullscreenDemo(false) // 终幕前确保退出演示全屏
  void peeko.setMode('browse')
  $('challenges').hidden = true
  const finale = $('finale')
  finale.hidden = false
  renderFinaleCopy()
  requestAnimationFrame(() => finale.classList.add('in'))
  $('start').addEventListener('click', finish)
}

function renderFinaleCopy(): void {
  $('finale-title').textContent = t("You're ready.", '准备好了。')
  $('finale').querySelector('.sub')!.textContent = t(
    'Peeko lives in your menu bar. The window waits in the corner.',
    'Peeko 常驻在菜单栏，浮窗已在角落待命。'
  )
  $('start').textContent = t('Start watching', '开始看球')
}

// 非阻塞联网提示：无网时温和告知"直播看不到、但教学照常"，绝不拦推进
function setupNetNotice(): void {
  const notice = document.createElement('div')
  notice.style.cssText =
    'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);padding:7px 14px;' +
    'border-radius:999px;font-size:12px;color:var(--ink-2);background:var(--glass);' +
    'box-shadow:var(--glass-edge);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
    'opacity:0;transition:opacity .3s ease-out;pointer-events:none;z-index:50'
  document.body.appendChild(notice)
  const sync = (): void => {
    notice.textContent = t(
      'No internet — live content is unavailable, but the tour continues.',
      '当前没有联网，直播内容暂时看不到，但教学照常进行。'
    )
    notice.style.opacity = navigator.onLine ? '0' : '1'
  }
  window.addEventListener('online', sync)
  window.addEventListener('offline', sync)
  sync()
}

// 聚光灯灰纱：轮询浮窗矩形，挖洞突显浮窗（仅闯关/模式说明期间）；浮窗隐藏时收回全屏灰纱
const scrim = $('scrim')
let spotlightActive = false

async function syncSpotlight(): Promise<void> {
  const r = spotlightActive ? await peeko.floatRect() : null
  if (!r) {
    // 浮窗藏起来/无聚光：清 .spot + inline 定位，恢复全屏均匀灰纱
    // （只移类不清 inline，#scrim 会卡在浮窗原位留下一块底色阴影）
    if (scrim.classList.contains('spot')) {
      scrim.classList.remove('spot')
      scrim.removeAttribute('style')
    }
    return
  }
  scrim.style.left = `${r.x}px`
  scrim.style.top = `${r.y}px`
  scrim.style.width = `${r.w}px`
  scrim.style.height = `${r.h}px`
  scrim.classList.add('spot')
}
setInterval(() => void syncSpotlight(), 120)

// 工具栏"试一下"：图例展示时让蒙版鼠标穿透，用户能去 hover 浮窗唤起真实工具栏；
// 卡片仍视觉在最上，鼠标移到按钮/Skip 上时临时夺回点击
let toolbarTry = false
let mouseIgnored = false

function setMouseIgnored(ignore: boolean): void {
  if (ignore === mouseIgnored) return
  mouseIgnored = ignore
  peeko.setIgnoreMouse(ignore)
}

function enterToolbarTry(): void {
  toolbarTry = true
  setMouseIgnored(true) // 先穿透到浮窗
}

function exitToolbarTry(): void {
  toolbarTry = false
  setMouseIgnored(false) // 恢复蒙版正常捕获
}

document.addEventListener(
  'mousemove',
  (e) => {
    if (!toolbarTry) return
    const overBtn = !!(e.target as HTMLElement)?.closest?.('#card-action, #skip')
    setMouseIgnored(!overBtn) // 在按钮上→夺回点击；其余→穿透到浮窗
  },
  true
)

// ============================================================
// 总编排
// ============================================================
async function run(): Promise<void> {
  applyLanguage(await peeko.getLanguage())
  shortcutHealth = await peeko.shortcutHealth()
  await waitForRequiredPermissions()
  if (finished) return
  await waitForShortcutHealth()
  if (finished) return
  await peeko.startRuntime()
  await peeko.setMode('browse')
  setupNetNotice()
  await peeko.restoreOnboarding()
  if (!(await peeko.shouldRunIntro())) {
    peeko.onboardingClose()
    return
  }
  shortcutHealth = await peeko.shortcutHealth()
  CHALLENGES = makeChallenges()
  MODE_GUIDES = makeModeGuides()
  introReady = true
  $('skip').hidden = false
  await actIntro()
  if (finished) return
  await showShortcutSummary() // 先一次看完所有键，点"知道了"再进闯关
  if (finished) return
  spotlightActive = true // logo 介绍阶段不挖洞；闯关起聚光灯突显浮窗
  $('challenges').hidden = false
  await showChallenge(0)
}

void run()

export {}
