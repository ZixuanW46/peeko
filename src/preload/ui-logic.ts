/**
 * [INPUT]: 纯数据输入（无 DOM / Electron 依赖）
 * [OUTPUT]: preload UI 的事件门闩、快捷键吞事件判定、短地址格式化与媒体状态判定
 * [POS]: preload 的可测试交互规则，page.ts 只负责把真实 DOM 状态喂进来
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export interface PageDoubleClickSignal {
  trusted: boolean
  didDrag: boolean
  ownUi: boolean
}

export interface VolumeVideoState {
  muted: boolean
  volume: number
}

export interface ShortcutKeySignal {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const KEY_ALIASES: Record<string, string> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Esc: 'Escape',
  Return: 'Enter'
}

function keyMatches(expected: string, signal: ShortcutKeySignal): boolean {
  const key = KEY_ALIASES[expected] ?? expected
  if (key.length === 1) return signal.key.toLowerCase() === key.toLowerCase()
  return signal.key === key || signal.code === key
}

function acceleratorMatches(accelerator: string, signal: ShortcutKeySignal): boolean {
  const parts = accelerator.split('+')
  const key = parts.at(-1)
  if (!key || !keyMatches(key, signal)) return false
  const commandOrControl = parts.includes('CommandOrControl')
  const ctrl = parts.includes('Control')
  const meta = parts.some((p) => p === 'Command' || p === 'Super' || p === 'Meta')
  return (
    signal.altKey === parts.includes('Alt') &&
    signal.shiftKey === parts.includes('Shift') &&
    (commandOrControl
      ? signal.ctrlKey !== signal.metaKey
      : signal.ctrlKey === ctrl && signal.metaKey === meta)
  )
}

export function shouldForwardPageDoubleClick(signal: PageDoubleClickSignal): boolean {
  return signal.trusted && !signal.didDrag && !signal.ownUi
}

export function shouldCapturePageShortcut(
  signal: ShortcutKeySignal,
  shortcuts: Record<string, string>
): boolean {
  return Object.values(shortcuts).some((accelerator) => acceleratorMatches(accelerator, signal))
}

export function effectiveVolumeFor(video: VolumeVideoState | null, wcMuted: boolean): number {
  if (!video) return 0
  return wcMuted || video.muted ? 0 : video.volume
}

export function formatShortAddress(href: string): string {
  const fallback = href.trim().slice(0, 40)
  try {
    const url = new URL(href)
    const host = url.hostname.replace(/^www\./i, '')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length === 0) return host
    return `${host}/${parts[0]}${parts.length > 1 ? '/...' : ''}`
  } catch {
    return fallback
  }
}
