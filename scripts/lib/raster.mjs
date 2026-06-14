/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: 依赖 node:zlib（deflate）、node:fs（落盘）——零外部依赖
 * [OUTPUT]: 对外提供 encodePng / writePng / sdRoundRect / clamp01 / coverage / lerp / mix
 * [POS]: scripts/lib 的栅格原语层，gen-tray-icon 与 gen-app-icon 共用的单一真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 为什么自己写 PNG：本仓库刻意零依赖（无 sharp/canvas），且本机 rsvg-convert
 * 是 Intel 二进制、arm64 无 Rosetta 跑不动。SDF + 最小 PNG 编码器最稳、最可复现。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

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

export function encodePng(width, height, rgba) {
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

export function writePng(path, width, height, rgba) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encodePng(width, height, rgba))
}

// ---------- SDF 几何与覆盖率 ----------
// 圆角矩形有符号距离场：<0 在内，>0 在外，0 在边
export const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

export const clamp01 = (v) => Math.min(1, Math.max(0, v))
// 1px 软边：SDF → 覆盖率（d=0 → 0.5）
export const coverage = (d) => clamp01(0.5 - d)
// 任意软边宽度 w：SDF → 覆盖率
export const coverageSoft = (d, w) => clamp01(0.5 - d / w)

// 标量与颜色插值
export const lerp = (a, b, t) => a + (b - a) * t
export const mix = (c0, c1, t) => [
  lerp(c0[0], c1[0], t),
  lerp(c0[1], c1[1], t),
  lerp(c0[2], c1[2], t)
]
