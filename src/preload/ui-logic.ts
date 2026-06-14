/**
 * [INPUT]: 纯数据输入（无 DOM / Electron 依赖）
 * [OUTPUT]: preload UI 的事件门闩与媒体状态判定
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

export function shouldForwardPageDoubleClick(signal: PageDoubleClickSignal): boolean {
  return signal.trusted && !signal.didDrag && !signal.ownUi
}

export function effectiveVolumeFor(video: VolumeVideoState | null, wcMuted: boolean): number {
  if (!video) return 0
  return wcMuted || video.muted ? 0 : video.volume
}
