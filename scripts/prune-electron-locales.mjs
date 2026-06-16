/**
 * [INPUT]: electron-builder afterPack 上下文、Electron Framework 语言资源
 * [OUTPUT]: 仅保留 Peeko 需要的 Chromium locale，并写入 macOS 自动更新 feed 配置
 * [POS]: scripts 的 macOS afterPack 钩子；签名前生成运行时依赖，避免发布包缺 app-update.yml
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const keepPrefixes = ['en', 'zh_CN', 'zh_TW']

function shouldKeepLocale(name) {
  return keepPrefixes.some((prefix) => name === `${prefix}.lproj` || name.startsWith(`${prefix}_`))
}

function appContents(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents')
}

function frameworkResources(context) {
  return join(
    appContents(context),
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'Current',
    'Resources'
  )
}

function firstPublishConfig(config) {
  if (Array.isArray(config)) return config[0]
  return config
}

function writeUpdateFeed(context) {
  const publish = firstPublishConfig(context.packager.config.publish)
  if (!publish || publish.provider !== 'github' || !publish.owner || !publish.repo) {
    throw new Error(
      'Peeko macOS update feed requires publish.provider/owner/repo in electron-builder.yml.'
    )
  }

  const cacheName = `${context.packager.appInfo.sanitizedName ?? 'peeko'}-updater`
  const appUpdate = join(appContents(context), 'Resources', 'app-update.yml')
  const doc = {
    owner: publish.owner,
    repo: publish.repo,
    provider: publish.provider,
    releaseType: publish.releaseType ?? 'release',
    updaterCacheDirName: cacheName
  }

  writeFileSync(appUpdate, yaml.dump(doc, { lineWidth: 120 }), 'utf8')
  console.log(`  • wrote ${basename(appUpdate)} for ${publish.owner}/${publish.repo}`)
}

function pruneChromiumLocales(context) {
  const resources = frameworkResources(context)

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

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  writeUpdateFeed(context)
  pruneChromiumLocales(context)
}
