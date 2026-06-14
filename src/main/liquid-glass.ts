/**
 * [INPUT]: 依赖 electron 的 BrowserWindow 类型；运行时动态 require electron-liquid-glass（darwin-only 原生模块）
 * [OUTPUT]: 对外提供 applyLiquidGlass(win, opts)——macOS 26 注入 NSGlassEffectView 拿真 Liquid Glass
 * [POS]: main 的材质层，被 tray.ts 的 popover 与 window.ts 的设置窗共用；非 mac26/非 darwin 静默回落
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { BrowserWindow } from 'electron'

interface GlassOptions {
  cornerRadius?: number
  tintColor?: string
  opaque?: boolean
}

interface GlassLib {
  addView(handle: Buffer, options?: GlassOptions): number
}

// macOS 主版本号；非 darwin 返回 0。Liquid Glass 由系统版本决定，与 Electron 链接的 SDK 无关
function macOSMajor(): number {
  if (process.platform !== 'darwin') return 0
  return Number(process.getSystemVersion().split('.')[0]) || 0
}

// 动态加载原生模块——缺失/加载失败时返回 null（依赖里有，但非 darwin 无原生二进制）
function loadGlass(): GlassLib | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('electron-liquid-glass')
    const lib = (mod?.default ?? mod) as GlassLib
    return typeof lib?.addView === 'function' ? lib : null
  } catch {
    return null
  }
}

/**
 * mac26+ 给窗口注入原生 Liquid Glass，注入后清掉 OS vibrancy（二者并存会发糊）。
 * 非 mac26 返回 false——调用方创建时预设的 OS vibrancy（popover/sidebar）原样保留为回落。
 * 前提：窗口 transparent:true。tintColor 不在此设，交给 CSS（随明暗自适应）。
 */
export function applyLiquidGlass(win: BrowserWindow, opts: GlassOptions = {}): boolean {
  if (macOSMajor() < 26) return false
  const glass = loadGlass()
  if (!glass) return false

  const inject = (): void => {
    if (win.isDestroyed()) return
    try {
      glass.addView(win.getNativeWindowHandle(), opts)
      win.setVibrancy(null) // 原生玻璃已就位，撤掉 OS vibrancy 回落
    } catch (err) {
      console.warn('[liquid-glass] addView 失败，保留 OS vibrancy 回落：', err)
    }
  }

  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', inject)
  else inject()
  return true
}
