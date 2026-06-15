/**
 * [INPUT]: electron-builder afterPack 上下文、Electron Framework 语言资源
 * [OUTPUT]: 仅保留 Peeko 需要的 Chromium locale，减少签名和公证上传体积
 * [POS]: scripts 的 macOS 打包瘦身钩子；业务 i18n 仍由 src/shared/i18n.ts 管理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

const keepPrefixes = ['en', 'zh_CN', 'zh_TW']

function shouldKeepLocale(name) {
  return keepPrefixes.some((prefix) => name === `${prefix}.lproj` || name.startsWith(`${prefix}_`))
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const resources = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'Current',
    'Resources'
  )

  let removed = 0
  for (const entry of readdirSync(resources, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.lproj') || shouldKeepLocale(entry.name)) {
      continue
    }
    rmSync(join(resources, entry.name), { recursive: true, force: true })
    removed += 1
  }

  console.log(`  • pruned ${removed} Chromium locale folders from ${basename(resources)}`)
}
