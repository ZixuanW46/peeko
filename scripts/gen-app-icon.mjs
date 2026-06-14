/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: 依赖 lib/raster.mjs 的 writePng/sdRoundRect/coverage/mix 与 lib/mark.mjs 的 PEEKO_MARK/toRect
 * [OUTPUT]: build/icon.png(1024² .icns 源) + src/renderer/onboarding/icon.png(512² 呼吸 logo) + landing/favicon.svg
 * [POS]: scripts 的 App 图标生成器，pixel-dissolve logo 的 macOS 应用图标转译
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 设计（DESIGN.md / cloud design 定稿）：Apple White——浅色 squircle（#fff→#eef1f5 顶光渐变
 *   + 柔性落影），居中 ink(#2d2620) 的"像素消散"母题：一块实心窗口向右上碎裂成渐隐像素。
 *   母题几何与品牌系统 App icon(512px) 一致；同一几何也喂给托盘模板与 favicon。
 */
import { writePng, sdRoundRect, clamp01, coverage, coverageSoft, mix } from './lib/raster.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { PEEKO_MARK as MARK, toRect, markBounds } from './lib/mark.mjs'

// ---------- 调色（sRGB） ----------
const INK = [45, 38, 32] // #2d2620  品牌墨色（--ink 暖近黑）
const TOP = [255, 255, 255] // #ffffff  squircle 顶部
const BOTTOM = [238, 241, 245] // #eef1f5  squircle 底部
const SHADOW = [28, 38, 60] // 落影冷色
const EDGE = [28, 38, 60] // 边缘 hairline 冷色
const byte = (v) => Math.max(0, Math.min(255, Math.round(v))) // 0–255 钳位

// pixel-dissolve 母题几何 = lib/mark.mjs 的 PEEKO_MARK（App 图标/托盘/favicon 单一源）

// ---------- 渲染一张图标 ----------
// opts: { size, marginFrac, shadow }
function drawIcon(size, { marginFrac, shadow }) {
  const rgba = Buffer.alloc(size * size * 4)
  const margin = size * marginFrac
  const body = size - 2 * margin
  const cx = size / 2
  const cy = shadow ? size / 2 - size * 0.008 : size / 2 // 有影时上移一点留影位
  const hw = body / 2
  const hh = body / 2
  const r = body * 0.235 // squircle 圆角比例（沿用设计 31/132）
  const bodyTop = cy - hh
  const bodyH = hh * 2

  // mark：把 64 单位盒居中铺到 body 的 70%
  const markFrac = 0.7
  const scale = (body * markFrac) / 64
  const originX = cx - 32 * scale
  const originY = cy - 32 * scale
  const rects = MARK.map(toRect)

  // 落影参数（按 size 比例）
  const shDy = size * 0.026
  const shBlur = size * 0.05
  const shOp = shadow ? 0.3 : 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      // 1) squircle body 覆盖率（抗锯齿）
      const dBody = sdRoundRect(px, py, cx, cy, hw, hh, r)
      const bodyA = coverage(dBody)

      // 2) body 颜色：顶光垂直渐变
      const tg = clamp01((py - bodyTop) / bodyH)
      let col = mix(TOP, BOTTOM, tg)

      // 2a) 边缘冷色 hairline（仅内侧 ~1.4px，提升浅底上的轮廓）
      const edge = clamp01((dBody + 1.4) / 1.4) * clamp01(0.5 - dBody) * 2
      col = mix(col, EDGE, 0.1 * clamp01(edge))

      // 3) mark：六块取最大覆盖（无重叠，max==over）
      let markA = 0
      for (const rc of rects) {
        const dm = sdRoundRect(
          (px - originX) / scale,
          (py - originY) / scale,
          rc.cx,
          rc.cy,
          rc.hw,
          rc.hh,
          rc.r
        )
        const c = coverage(dm * scale) * rc.op
        if (c > markA) markA = c
      }
      col = mix(col, INK, markA)

      // 4) 落影（body 之外、下方柔光）
      const dSh = sdRoundRect(px, py - shDy, cx, cy, hw, hh, r)
      const shA = shOp * coverageSoft(dSh, shBlur) * (1 - bodyA)

      // 5) 合成（直 alpha；body 不透明叠在影之上）
      //   col/SHADOW 通道是 0–255；premul 后除以 outA 仍是 0–255，按字节钳位即可。
      const outA = clamp01(bodyA + shA)
      const i = (y * size + x) * 4
      if (outA <= 0) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0
        continue
      }
      const pr = col[0] * bodyA + SHADOW[0] * shA
      const pg = col[1] * bodyA + SHADOW[1] * shA
      const pb = col[2] * bodyA + SHADOW[2] * shA
      rgba[i] = byte(pr / outA)
      rgba[i + 1] = byte(pg / outA)
      rgba[i + 2] = byte(pb / outA)
      rgba[i + 3] = Math.round(outA * 255)
    }
  }
  return rgba
}

// ---------- favicon（与 App 图标/托盘同一 PEEKO_MARK，方形居中，深浅自适应） ----------
function faviconSvg() {
  const b = markBounds(3)
  const side = Math.max(b.w, b.h) // 方形 viewBox：水平贴合、垂直居中
  const vbX = (b.cx - side / 2).toFixed(1)
  const vbY = (b.cy - side / 2).toFixed(1)
  const rect = (m) =>
    `  <rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="${m.r}" opacity="${m.op}"/>`
  // 颜色由 <style> 控制 → 浅色标签栏 ink、深色标签栏浅色；opacity 仍逐块保留"消散"层次
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${side} ${side}" fill="none">
  <style>
    rect { fill: #2d2620 }
    @media (prefers-color-scheme: dark) { rect { fill: #ededed } }
  </style>
${MARK.map(rect).join('\n')}
</svg>
`
}

// ---------- 产出 ----------
const ICON = 1024
const RES = 512

// 满幅 squircle：留 ~1.4% 极小边距，外层容器（onboarding CSS border-radius + box-shadow）自带圆角与投影
const fullBleed = drawIcon(RES, { marginFrac: 0.014, shadow: false })

writePng('build/icon.png', ICON, ICON, drawIcon(ICON, { marginFrac: 0.094, shadow: true })) // macOS .icns 源（Apple 网格留边距 + 烘焙柔影）
writePng('src/renderer/onboarding/icon.png', RES, RES, fullBleed) // onboarding Act I 呼吸 logo（CSS 包装圆角与光晕）
mkdirSync('landing', { recursive: true })
writeFileSync('landing/favicon.svg', faviconSvg())

console.log('生成完成: build/icon.png · src/renderer/onboarding/icon.png · landing/favicon.svg')
