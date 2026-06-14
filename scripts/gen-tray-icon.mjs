/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: 依赖 node:zlib / node:fs（零外部依赖）
 * [OUTPUT]: 生成 resources/trayTemplate.png 与 @2x——Peeko 菜单栏模板图标
 * [POS]: scripts 的资产生成器，logo 母题（外框+叠卡）的菜单栏转译
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 设计：纯黑 + 透明度分层（macOS template image 规范）。
 *   外层圆角方框：线条，alpha 1.0
 *   右下叠卡：圆角实心，alpha 0.45（透明度做层次，参考系统图标语言）
 *   叠卡内两条短横线：镂空（alpha 0）
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

// ---------- 最小 PNG 编码器（RGBA → PNG） ----------
function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- SDF 几何：圆角矩形 ----------
const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))
// 1px 软边：SDF → 覆盖率
const coverage = (d) => clamp01(0.5 - d)

// ---------- 绘制（坐标按 18pt 设计，scale 放大） ----------
function draw(size, scale) {
  const rgba = Buffer.alloc(size * size * 4)
  const S = (v) => v * scale

  // 外框：中心 (8,8)，半宽高 6.5，圆角 2.2，线宽 1.5
  // 叠卡：中心 (12.2,12.2)，半宽高 4.2，圆角 1.6，实心 45%
  // 卡内横线：两条 1.1 高、4.4 宽的镂空圆角条
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      const dFrame = sdRoundRect(px, py, S(8), S(8), S(6.5), S(6.5), S(2.2))
      const frameStroke = coverage(Math.abs(dFrame) - S(0.75))

      const dCard = sdRoundRect(px, py, S(12.2), S(12.2), S(4.2), S(4.2), S(1.6))
      const cardFill = coverage(dCard)

      const dLine1 = sdRoundRect(px, py, S(12.2), S(10.9), S(2.2), S(0.55), S(0.55))
      const dLine2 = sdRoundRect(px, py, S(12.2), S(13.5), S(2.2), S(0.55), S(0.55))
      const lineCut = Math.max(coverage(dLine1), coverage(dLine2))

      // 叠卡区域内禁止外框线穿透（卡片"叠"在框上）+ 横线镂空
      const cardGuard = coverage(dCard - S(0.9)) // 卡片外扩一圈遮挡外框
      const frameA = frameStroke * (1 - cardGuard)
      const cardA = cardFill * 0.45 * (1 - lineCut)

      const alpha = clamp01(frameA + cardA)
      const i = (y * size + x) * 4
      rgba[i] = 0
      rgba[i + 1] = 0
      rgba[i + 2] = 0
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, size, rgba)
}

mkdirSync('resources', { recursive: true })
writeFileSync('resources/trayTemplate.png', draw(18, 1))
writeFileSync('resources/trayTemplate@2x.png', draw(36, 2))
console.log('生成完成: resources/trayTemplate.png (+@2x)')
