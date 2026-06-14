/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: 依赖 lib/raster.mjs 的 writePng/sdRoundRect/coverage/clamp01 与 lib/mark.mjs 的 PEEKO_MARK/toRect
 * [OUTPUT]: resources/trayTemplate.svg（白色源）+ trayTemplate.png(+@2x)——Peeko 菜单栏图标
 * [POS]: scripts 的菜单栏图标生成器，pixel-dissolve logo（与 App 图标同一几何）的菜单栏转译
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 与 App 图标"长一样"：直接用 PEEKO_MARK 完整六块，不再自创紧凑变体。
 * 菜单栏图标不必方形——做成贴合 mark 的宽形（整体略小于满高，避免占位过宽），mark 完整展开且各块清晰。
 *
 * 颜色：按设计画白色 + 透明度分层（block 纯白、像素渐隐成不同灰白）。trayTemplate 仍由
 *   tray.ts setTemplateImage(true) 标记为模板图——系统忽略 RGB、仅用 alpha 着色（深色栏白、
 *   浅色栏黑），故白/黑等效；画白只为直观，并让非模板回退时深色栏仍可读。
 */
import { writePng, sdRoundRect, coverage, clamp01 } from './lib/raster.mjs'
import { PEEKO_MARK, toRect, markBounds } from './lib/mark.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const rects = PEEKO_MARK.map(toRect)

// ---------- viewBox：贴合 mark 内容 + padding（64 空间单位，与 favicon 共用 markBounds） ----------
const { x: vbX, y: vbY, w: vbW, h: vbH } = markBounds(3)

// ---------- SDF 渲染：白色 RGB + alpha=覆盖率×透明度 ----------
function draw(W, H) {
  const rgba = Buffer.alloc(W * H * 4)
  const sx = W / vbW
  const sy = H / vbH
  const s = (sx + sy) / 2 // 把 64 空间的 SDF 距离换算到像素（用于 1px 软边）

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mx = vbX + (x + 0.5) / sx
      const my = vbY + (y + 0.5) / sy

      // 六块取最大覆盖（无重叠，max==over）；alpha = 覆盖率 × 该块透明度
      let a = 0
      for (const rc of rects) {
        const d = sdRoundRect(mx, my, rc.cx, rc.cy, rc.hw, rc.hh, rc.r)
        const c = coverage(d * s) * rc.op
        if (c > a) a = c
      }

      const i = (y * W + x) * 4
      rgba[i] = 255 // 白
      rgba[i + 1] = 255
      rgba[i + 2] = 255
      rgba[i + 3] = Math.round(clamp01(a) * 255)
    }
  }
  return rgba
}

// ---------- SVG 源：白 fill + opacity 分层（人类可编辑的真相相） ----------
function svg() {
  const r = (m) =>
    `  <rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="${m.r}" fill="#ffffff" opacity="${m.op}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" fill="none">\n${PEEKO_MARK.map(r).join('\n')}\n</svg>\n`
}

// ---------- 产出（整体高度 H，宽度按 mark 比例自适应） ----------
// 整体高度（< 菜单栏满高 18，避免宽形 mark 占位过宽、显得比邻居大）；改这一个数即可整体缩放
const H = 14
const W = Math.round((vbW / vbH) * H)

mkdirSync('resources', { recursive: true })
writeFileSync('resources/trayTemplate.svg', svg())
writePng('resources/trayTemplate.png', W, H, draw(W, H))
writePng('resources/trayTemplate@2x.png', W * 2, H * 2, draw(W * 2, H * 2))
console.log(`生成完成: resources/trayTemplate.svg + .png(${W}×${H}) + @2x(${W * 2}×${H * 2})`)
