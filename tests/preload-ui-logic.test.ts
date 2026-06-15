/**
 * [INPUT]: 依赖 preload/ui-logic 的纯 UI 判定函数
 * [OUTPUT]: 验证 Toolbar 事件门闩、Peeko 快捷键吞事件与无媒体音量模型
 * [POS]: tests 的 preload 交互守卫，防止页面级双击/音量回写吞掉控制条语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, it } from 'vitest'
import {
  effectiveVolumeFor,
  shouldCapturePageShortcut,
  shouldForwardPageDoubleClick
} from '../src/preload/ui-logic'

describe('preload UI logic', () => {
  it('页面双击只来自真实网页画面，不来自 Peeko 自己的 Toolbar', () => {
    expect(shouldForwardPageDoubleClick({ trusted: true, didDrag: false, ownUi: false })).toBe(true)
    expect(shouldForwardPageDoubleClick({ trusted: true, didDrag: false, ownUi: true })).toBe(false)
    expect(shouldForwardPageDoubleClick({ trusted: true, didDrag: true, ownUi: false })).toBe(false)
    expect(shouldForwardPageDoubleClick({ trusted: false, didDrag: false, ownUi: false })).toBe(
      false
    )
  })

  it('无视频时音量显示为 0，拖动滑条不应假装有 100% 音量', () => {
    expect(effectiveVolumeFor(null, false)).toBe(0)
    expect(effectiveVolumeFor(null, true)).toBe(0)
  })

  it('有视频时音量由 WebContents 静音层与 video 状态共同决定', () => {
    expect(effectiveVolumeFor({ muted: false, volume: 0.42 }, false)).toBe(0.42)
    expect(effectiveVolumeFor({ muted: false, volume: 0.42 }, true)).toBe(0)
    expect(effectiveVolumeFor({ muted: true, volume: 0.42 }, false)).toBe(0)
  })

  it('Peeko 快捷键在页面捕获阶段吞掉，避免网页播放器重复消费', () => {
    const shortcuts = {
      volumeUp: 'Control+Up',
      volumeDown: 'Control+Down',
      opacityUp: 'Control+Shift+Up',
      opacityDown: 'Control+Shift+Down',
      fullscreen: 'Alt+Shift+Enter'
    }

    expect(
      shouldCapturePageShortcut(
        {
          key: 'ArrowUp',
          code: 'ArrowUp',
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          metaKey: false
        },
        shortcuts
      )
    ).toBe(true)
    expect(
      shouldCapturePageShortcut(
        {
          key: 'ArrowDown',
          code: 'ArrowDown',
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          metaKey: false
        },
        shortcuts
      )
    ).toBe(true)
    expect(
      shouldCapturePageShortcut(
        {
          key: 'ArrowUp',
          code: 'ArrowUp',
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
          metaKey: false
        },
        shortcuts
      )
    ).toBe(true)
    expect(
      shouldCapturePageShortcut(
        {
          key: 'Enter',
          code: 'Enter',
          ctrlKey: false,
          altKey: true,
          shiftKey: true,
          metaKey: false
        },
        shortcuts
      )
    ).toBe(true)
    expect(
      shouldCapturePageShortcut(
        {
          key: 'ArrowUp',
          code: 'ArrowUp',
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false
        },
        shortcuts
      )
    ).toBe(false)
  })
})
