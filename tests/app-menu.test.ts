/**
 * [INPUT]: 依赖 src/main/tray 的托盘命令模板与 macOS Application Menu 装配
 * [OUTPUT]: 验证顶部 Peeko 菜单复用托盘命令，而不是维护第二份菜单
 * [POS]: tests 的菜单入口守卫，防止 Dock 默认显示后顶部菜单退回 Electron 空壳
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
  setApplicationMenu: vi.fn(),
  appQuit: vi.fn(),
  readText: vi.fn(() => 'https://example.com/from-clipboard'),
  showMessageBox: vi.fn(),
  ipcHandle: vi.fn(),
  ipcOn: vi.fn()
}))

vi.mock('electron', () => ({
  app: { name: 'Peeko', quit: electron.appQuit },
  BrowserWindow: class {},
  Tray: class {},
  Menu: {
    buildFromTemplate: electron.buildFromTemplate,
    setApplicationMenu: electron.setApplicationMenu
  },
  clipboard: { readText: electron.readText },
  dialog: { showMessageBox: electron.showMessageBox },
  nativeImage: {
    createFromPath: () => ({ setTemplateImage: vi.fn() })
  },
  screen: {
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })
  },
  ipcMain: {
    handle: electron.ipcHandle,
    on: electron.ipcOn
  }
}))

vi.mock('../src/main/window', () => ({
  getFloat: () => null,
  hideFloatWindow: vi.fn(),
  showFloatWindow: vi.fn(),
  openOnboarding: vi.fn(),
  openSettings: vi.fn()
}))

vi.mock('../src/main/modes', () => ({
  isCinema: () => false,
  toggleCinema: vi.fn()
}))

vi.mock('../src/main/store', () => ({
  HOME_URL: 'https://example.com/worldcup',
  store: {
    data: {
      favorites: [{ name: 'Favorite Match', url: 'https://example.com/final' }]
    }
  }
}))

vi.mock('../src/main/runtime', () => ({
  ensureRuntimeVisible: vi.fn(),
  hasRequiredPermissions: () => true
}))

vi.mock('../src/main/i18n', () => ({
  getLanguageSettings: () => ({ preference: 'system', resolved: 'en' }),
  t: (en: string) => en
}))

vi.mock('../src/main/liquid-glass', () => ({ applyLiquidGlass: vi.fn() }))

vi.mock('../src/main/updater', () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdateState: () => ({
    phase: 'idle',
    currentVersion: '0.1.2',
    latestVersion: null,
    progress: null,
    error: null,
    lastCheckedAt: null
  })
}))

describe('application menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('顶部 Peeko 菜单复用托盘核心命令', async () => {
    const { buildApplicationMenuTemplate, installApplicationMenu } =
      await import('../src/main/tray')

    const template = buildApplicationMenuTemplate()
    const appMenu = template[0] as {
      label: string
      submenu: Array<{ label?: string; accelerator?: string }>
    }
    const labels = appMenu.submenu.map((item) => item.label).filter(Boolean)

    expect(appMenu.label).toBe('Peeko')
    expect(labels).toEqual(
      expect.arrayContaining([
        'Show / Hide Window',
        'Toggle Cinema Mode',
        'Favorite Match',
        '⭐ Favorite Current Page',
        'Open URL from Clipboard',
        'World Cup Home',
        'Check for Updates...',
        'Settings…',
        'Quit'
      ])
    )
    expect(appMenu.submenu.find((item) => item.label === 'Quit')?.accelerator).toBe('Command+Q')

    installApplicationMenu()

    const installedTemplate = electron.buildFromTemplate.mock.calls.at(-1)?.[0] as typeof template
    const installedAppMenu = installedTemplate[0] as {
      label: string
      submenu: Array<{ label?: string }>
    }

    expect(installedAppMenu.label).toBe('Peeko')
    expect(installedAppMenu.submenu.map((item) => item.label)).toContain('Show / Hide Window')
    expect(electron.setApplicationMenu).toHaveBeenCalledWith({ template: installedTemplate })
  })
})
