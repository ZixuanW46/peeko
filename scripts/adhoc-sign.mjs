/**
 * [INPUT]: 依赖 node:child_process 的 codesign 调用，electron-builder afterSign 上下文
 * [OUTPUT]: 对外提供 afterSign 钩子——对产物 .app 做 ad-hoc 全量签名
 * [POS]: scripts 的打包后处理；无签名 + quarantine 会被 macOS 判"已损坏"，
 *        ad-hoc 签名让其降级为"无法验证开发者"（右键打开可放行）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execSync } from 'node:child_process'
import { join } from 'node:path'

function teamIdentifier(app) {
  try {
    const out = execSync(`codesign -dv --verbose=4 "${app}" 2>&1`, { encoding: 'utf8' })
    const match = out.match(/^TeamIdentifier=(.+)$/m)
    return match?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const team = teamIdentifier(app)
  if (team && team !== 'not set') {
    console.log(`  • 已由 TeamIdentifier=${team} 正式签名，跳过 ad-hoc 覆盖`)
    return
  }
  console.log(`  • ad-hoc 签名 ${app}`)
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' })
  execSync(`codesign --verify --deep "${app}"`, { stdio: 'inherit' })
}
