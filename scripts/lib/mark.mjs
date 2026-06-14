/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: 无依赖（纯几何常量）
 * [OUTPUT]: 对外提供 PEEKO_MARK——pixel-dissolve 标记的权威几何（viewBox 0 0 64 64）
 * [POS]: scripts/lib 的品牌几何单一真相源，gen-app-icon 与 gen-tray-icon 共用，保证 App 图标与菜单栏托盘"长得一样"
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * "像素消散"：一块实心窗口(op1.0) 向右上碎裂成 5 块透明度递减的像素。
 * 来自 cloud design 品牌系统的 App icon(512px) 几何；改这里，App 图标/托盘/svg 同步变。
 */
export const PEEKO_MARK = [
  { x: 6, y: 21, w: 26, h: 24, r: 5.5, op: 1.0 }, // 实心窗口（锚）
  { x: 35, y: 24, w: 12, h: 12, r: 3.0, op: 0.6 }, // 右上中块
  { x: 49, y: 20, w: 9.5, h: 9.5, r: 2.5, op: 0.46 }, // 右上小块
  { x: 44, y: 38, w: 7, h: 7, r: 1.9, op: 0.42 }, // 右下小块
  { x: 57, y: 31, w: 5, h: 5, r: 1.4, op: 0.26 }, // 远端微块
  { x: 53, y: 42, w: 3.6, h: 3.6, r: 1.1, op: 0.15 } // 末梢尘
]

// {x,y,w,h,r} → SDF 入参（中心 + 半宽高）
export const toRect = (m) => ({
  cx: m.x + m.w / 2,
  cy: m.y + m.h / 2,
  hw: m.w / 2,
  hh: m.h / 2,
  r: m.r,
  op: m.op
})

// mark 内容包围盒（64 空间）+ padding，供托盘 viewBox / favicon 居中复用
export const markBounds = (pad = 0) => {
  const minX = Math.min(...PEEKO_MARK.map((m) => m.x))
  const minY = Math.min(...PEEKO_MARK.map((m) => m.y))
  const maxX = Math.max(...PEEKO_MARK.map((m) => m.x + m.w))
  const maxY = Math.max(...PEEKO_MARK.map((m) => m.y + m.h))
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + 2 * pad,
    h: maxY - minY + 2 * pad,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  }
}
