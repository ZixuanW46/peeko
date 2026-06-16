/**
 * [INPUT]: 依赖 src/main/store 的持久化文件命名与旧文件迁移逻辑
 * [OUTPUT]: 验证新用户只生成 peeko-store.json，旧 moyu-store.json 可无损迁移
 * [POS]: tests 的本地状态命名守卫，防止历史品牌名回流到用户目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const electron = vi.hoisted(() => ({
  userData: '',
  getPath: vi.fn(() => ''),
  on: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: electron.getPath,
    on: electron.on
  }
}))

async function loadStore(): Promise<typeof import('../src/main/store')> {
  vi.resetModules()
  return import('../src/main/store')
}

describe('store 文件命名', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    electron.userData = mkdtempSync(join(tmpdir(), 'peeko-store-'))
    electron.getPath.mockImplementation(() => electron.userData)
    electron.on.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(electron.userData, { recursive: true, force: true })
  })

  it('新用户只写 peeko-store.json', async () => {
    const { store, STORE_FILE, DEFAULT_SHORTCUTS } = await loadStore()

    expect(store.data.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    expect(store.data.shortcuts.quit).toBe('Control+Q')
    expect(store.data.autoCinema).toBe(false)
    expect(store.data.showInDock).toBe(true)

    store.patch({ onboarded: true })
    vi.advanceTimersByTime(500)

    expect(existsSync(join(electron.userData, STORE_FILE))).toBe(true)
    expect(existsSync(join(electron.userData, 'moyu-store.json'))).toBe(false)
  })

  it('旧 moyu-store.json 首次读取时迁移到 peeko-store.json', async () => {
    writeFileSync(
      join(electron.userData, 'moyu-store.json'),
      JSON.stringify({ onboarded: true, passthroughOpacity: 0.42 })
    )
    const { store, STORE_FILE } = await loadStore()

    expect(store.data.onboarded).toBe(true)
    expect(store.data.passthroughOpacity).toBe(0.42)
    expect(existsSync(join(electron.userData, STORE_FILE))).toBe(true)
    expect(existsSync(join(electron.userData, 'moyu-store.json'))).toBe(false)
    expect(readFileSync(join(electron.userData, STORE_FILE), 'utf-8')).toContain('"onboarded":true')
  })

  it('旧默认快捷键升级为新的 Control 默认组', async () => {
    writeFileSync(
      join(electron.userData, 'peeko-store.json'),
      JSON.stringify({
        shortcuts: {
          hide: 'Alt+Shift+H',
          peek: 'Alt+Shift+V',
          boss: 'Alt+Shift+B',
          playpause: 'Alt+Shift+P',
          mute: 'Alt+Shift+M',
          passthrough: 'Alt+Shift+T',
          fullscreen: 'Alt+Shift+Enter'
        }
      })
    )
    const { store, DEFAULT_SHORTCUTS } = await loadStore()

    expect(store.data.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    expect(store.data.shortcuts.quit).toBe('Control+Q')
  })

  it('上一个全屏默认快捷键继续升级为 Control+Enter', async () => {
    writeFileSync(
      join(electron.userData, 'peeko-store.json'),
      JSON.stringify({ shortcuts: { fullscreen: 'Control+Shift+Enter' } })
    )
    const { store } = await loadStore()

    expect(store.data.shortcuts.fullscreen).toBe('Control+Enter')
  })

  it('旧透明度方向键默认迁移到 Control+Shift', async () => {
    writeFileSync(
      join(electron.userData, 'peeko-store.json'),
      JSON.stringify({ shortcuts: { opacityUp: 'Control+Up', opacityDown: 'Control+Down' } })
    )
    const { store } = await loadStore()

    expect(store.data.shortcuts.volumeUp).toBe('Control+Command+Up')
    expect(store.data.shortcuts.volumeDown).toBe('Control+Command+Down')
    expect(store.data.shortcuts.opacityUp).toBe('Control+Shift+Up')
    expect(store.data.shortcuts.opacityDown).toBe('Control+Shift+Down')
  })

  it('旧音量方向键默认迁移到 Control+Command，避开 macOS 调度中心', async () => {
    writeFileSync(
      join(electron.userData, 'peeko-store.json'),
      JSON.stringify({ shortcuts: { volumeUp: 'Control+Up', volumeDown: 'Control+Down' } })
    )
    const { store } = await loadStore()

    expect(store.data.shortcuts.volumeUp).toBe('Control+Command+Up')
    expect(store.data.shortcuts.volumeDown).toBe('Control+Command+Down')
  })

  it('旧快进快退默认迁移到 Control+Command，避开 macOS 桌面切换', async () => {
    writeFileSync(
      join(electron.userData, 'peeko-store.json'),
      JSON.stringify({ shortcuts: { seekBack: 'Control+Left', seekForward: 'Control+Right' } })
    )
    const { store } = await loadStore()

    expect(store.data.shortcuts.seekBack).toBe('Control+Command+Left')
    expect(store.data.shortcuts.seekForward).toBe('Control+Command+Right')
  })

  it('用户自定义快捷键不被默认迁移覆盖', async () => {
    writeFileSync(
      join(electron.userData, 'peeko-store.json'),
      JSON.stringify({ shortcuts: { hide: 'Command+1', fullscreen: 'F11' } })
    )
    const { store } = await loadStore()

    expect(store.data.shortcuts.hide).toBe('Command+1')
    expect(store.data.shortcuts.fullscreen).toBe('F11')
  })

  it('用户显式关闭 Dock 图标时不被默认值迁移覆盖', async () => {
    writeFileSync(
      join(electron.userData, 'peeko-store.json'),
      JSON.stringify({ showInDock: false })
    )
    const { store } = await loadStore()

    expect(store.data.showInDock).toBe(false)
  })
})
