/**
 * [INPUT]: 依赖 electron 的 app.getPath('userData')、node:fs 同步读写、shared/shortcuts 默认键契约
 * [OUTPUT]: 对外提供 store 单例（data 直读 + patch 防抖落盘）与 Bounds/StoreData 类型
 * [POS]: main 的唯一持久化层，所有可变配置（lastUrl/几何/快捷键/收藏）的单一真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { isLanguagePreference, type LanguagePreference } from '../shared/i18n'
import { DEFAULT_SHORTCUTS, type Action, type ShortcutMap } from '../shared/shortcuts'

export { DEFAULT_SHORTCUTS, type Action, type ShortcutMap } from '../shared/shortcuts'

// 世界杯直播门户：⚽ 键与托盘主页的共同落点；该页是导航页，永不自动观影
export const HOME_URL = 'https://www.xiaohongshu.com/worldcup26?wcup_source=web_sidebar_entry'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Favorite {
  name: string
  url: string
}

const LEGACY_DEFAULT_SHORTCUTS: Partial<ShortcutMap> = {
  hide: 'Alt+Shift+H',
  peek: 'Alt+Shift+V',
  boss: 'Alt+Shift+B',
  playpause: 'Alt+Shift+P',
  mute: 'Alt+Shift+M',
  passthrough: 'Alt+Shift+T',
  fullscreen: 'Alt+Shift+Enter'
}
const LEGACY_FULLSCREEN_DEFAULT = 'Control+Shift+Enter'

export interface StoreData {
  lastUrl: string
  browseBounds: Bounds | null
  cinemaBounds: Bounds | null
  favorites: Favorite[]
  shortcuts: ShortcutMap
  autoCinema: boolean
  passthroughOpacity: number
  onboarded: boolean
  showInDock: boolean
  language: LanguagePreference
  lastUpdateCheckAt: number | null
}

const DEFAULTS: StoreData = {
  lastUrl: '',
  browseBounds: null,
  cinemaBounds: null,
  favorites: [],
  shortcuts: DEFAULT_SHORTCUTS,
  autoCinema: true,
  passthroughOpacity: 0.55,
  onboarded: false,
  showInDock: false,
  language: 'system',
  lastUpdateCheckAt: null
}

// ============================================================
export const STORE_FILE = 'peeko-store.json'
const LEGACY_STORE_FILE = 'moyu-store.json'

// 读：启动时一次性加载合并默认值，旧 moyu-store.json 只迁移一次
// 写：patch 后 500ms 防抖落盘，进程退出前强制刷盘
// ============================================================
const FILE = (): string => join(app.getPath('userData'), STORE_FILE)
const LEGACY_FILE = (): string => join(app.getPath('userData'), LEGACY_STORE_FILE)

function migrateLegacyStore(): void {
  const next = FILE()
  const legacy = LEGACY_FILE()
  if (existsSync(next) || !existsSync(legacy)) return
  try {
    renameSync(legacy, next)
  } catch {
    // 迁移失败时仍允许读取旧文件；下一次写入会落到 peeko-store.json。
  }
}

function readStore(file: string): StoreData | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'))
    const shortcuts = migrateShortcuts(parsed.shortcuts)
    return {
      ...DEFAULTS,
      ...parsed,
      language: isLanguagePreference(parsed.language) ? parsed.language : DEFAULTS.language,
      shortcuts
    }
  } catch {
    return null
  }
}

function migrateShortcuts(saved: Partial<ShortcutMap> | undefined): ShortcutMap {
  const shortcuts: ShortcutMap = { ...DEFAULT_SHORTCUTS, ...saved }
  if (!saved) return shortcuts

  for (const action of Object.keys(DEFAULT_SHORTCUTS) as Action[]) {
    if (saved[action] === LEGACY_DEFAULT_SHORTCUTS[action])
      shortcuts[action] = DEFAULT_SHORTCUTS[action]
  }
  if (saved.fullscreen === LEGACY_FULLSCREEN_DEFAULT)
    shortcuts.fullscreen = DEFAULT_SHORTCUTS.fullscreen

  return shortcuts
}

function load(): StoreData {
  migrateLegacyStore()
  return readStore(FILE()) ?? readStore(LEGACY_FILE()) ?? { ...DEFAULTS }
}

let cache: StoreData | null = null
let flushTimer: NodeJS.Timeout | null = null

function flush(): void {
  flushTimer = null
  writeFileSync(FILE(), JSON.stringify(cache, null, 2))
}

export const store = {
  get data(): StoreData {
    cache ??= load()
    return cache
  },
  patch(partial: Partial<StoreData>): void {
    Object.assign(this.data, partial)
    flushTimer ??= setTimeout(flush, 500)
  }
}

app.on('before-quit', () => {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flush()
  }
})
