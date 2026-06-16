export type Action =
  | 'hide'
  | 'peek'
  | 'boss'
  | 'quit'
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
  quit: 'Control+Q',
  playpause: 'Control+P',
  mute: 'Control+M',
  volumeUp: 'Control+Command+Up',
  volumeDown: 'Control+Command+Down',
  mode: 'Control+B',
  passthrough: 'Control+T',
  fullscreen: 'Control+Enter',
  opacityUp: 'Control+Shift+Up',
  opacityDown: 'Control+Shift+Down',
  seekBack: 'Control+Command+Left',
  seekForward: 'Control+Command+Right'
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
