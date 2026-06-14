export type Action =
  | 'hide'
  | 'peek'
  | 'boss'
  | 'playpause'
  | 'mute'
  | 'mode'
  | 'passthrough'
  | 'fullscreen'

export type ShortcutMap = Record<Action, string>

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  hide: 'Control+Z',
  peek: 'Control+X',
  boss: 'Control+C',
  playpause: 'Control+P',
  mute: 'Control+M',
  mode: 'Control+B',
  passthrough: 'Control+T',
  fullscreen: 'Control+Enter'
}

export function prettyShortcut(accel: string): string {
  return accel
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Alt', '⌥')
    .replace('Shift', '⇧')
    .replaceAll('+', '')
}
