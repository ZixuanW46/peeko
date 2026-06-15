export type Action =
  | 'hide'
  | 'peek'
  | 'boss'
  | 'playpause'
  | 'mute'
  | 'volumeUp'
  | 'volumeDown'
  | 'mode'
  | 'passthrough'
  | 'fullscreen'
  | 'opacityUp'
  | 'opacityDown'
  | 'seekBack'
  | 'seekForward'

export type ShortcutMap = Record<Action, string>

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  hide: 'Control+Z',
  peek: 'Control+X',
  boss: 'Control+C',
  playpause: 'Control+P',
  mute: 'Control+M',
  volumeUp: 'Control+Up',
  volumeDown: 'Control+Down',
  mode: 'Control+B',
  passthrough: 'Control+T',
  fullscreen: 'Control+Enter',
  opacityUp: 'Control+Shift+Up',
  opacityDown: 'Control+Shift+Down',
  seekBack: 'Control+Left',
  seekForward: 'Control+Right'
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
