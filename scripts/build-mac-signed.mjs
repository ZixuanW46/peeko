#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: package.json version、electron-builder 配置、Developer ID 证书、Apple notary profile
 * [OUTPUT]: 重新构建并验收 macOS 签名产物；DMG 作为最终分发物完成签名/公证/staple/metadata
 * [POS]: scripts 的 macOS 本地签名构建入口；release-mac-github 复用它，避免发布链路分叉
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap')

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const productName = pkg.productName ?? 'Peeko'
const packageName = pkg.name ?? 'peeko'
const updateFeed = readUpdateFeedConfig()
const dist = join(root, 'dist')
const out = join(root, 'out')
const app = join(dist, 'mac-arm64', `${productName}.app`)
const dmg = join(dist, `${packageName}-${version}.dmg`)
const zip = join(dist, `${productName}-${version}-arm64-mac.zip`)
const latest = join(dist, 'latest-mac.yml')
const finalizeOnly = process.argv.includes('--finalize-only')
const directNotaryNetwork = process.env.PEEKO_NOTARY_DIRECT !== '0'
const disableS3Acceleration = process.env.PEEKO_NOTARY_S3_ACCELERATION !== '1'
const notaryTimeoutMs = Number(process.env.PEEKO_NOTARY_TIMEOUT_MINUTES ?? 30) * 60_000
const notaryPollSeconds = Number(process.env.PEEKO_NOTARY_POLL_SECONDS ?? 20)

const proxyKeys = [
  'ALL_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'all_proxy',
  'https_proxy',
  'http_proxy'
]

function childEnv(opts = {}) {
  const env = { ...process.env, ...opts.env }
  if (opts.directNetwork) {
    for (const key of proxyKeys) delete env[key]
  }
  return env
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: childEnv(opts),
    stdio: opts.quiet ? 'pipe' : 'inherit',
    text: true
  })
  if (!opts.allowFailure && res.status !== 0) {
    const detail = res.stderr || res.stdout || ''
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`)
  }
  return res
}

function requiredEnv(name, label) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}: set it to ${label}.`)
  return value
}

const identity = requiredEnv('PEEKO_CODESIGN_IDENTITY', 'the Developer ID signing identity')
const profile = requiredEnv('APPLE_KEYCHAIN_PROFILE', 'the notarytool keychain profile')

function assertFile(file) {
  if (!existsSync(file)) throw new Error(`Missing macOS artifact: ${file}`)
}

function firstPublishConfig(config) {
  if (Array.isArray(config)) return config[0]
  return config
}

function readUpdateFeedConfig() {
  const config = yaml.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
  const publish = firstPublishConfig(config.publish)
  if (!publish || publish.provider !== 'github' || !publish.owner || !publish.repo) {
    throw new Error('macOS release requires publish.provider/owner/repo for electron-updater.')
  }
  return {
    provider: publish.provider,
    owner: publish.owner,
    repo: publish.repo,
    releaseType: publish.releaseType ?? 'release'
  }
}

function appUpdateFile(appPath) {
  return join(appPath, 'Contents', 'Resources', 'app-update.yml')
}

function assertAppUpdateMetadata(appPath) {
  const file = appUpdateFile(appPath)
  assertFile(file)

  const doc = yaml.load(readFileSync(file, 'utf8'))
  for (const [key, value] of Object.entries(updateFeed)) {
    if (doc?.[key] !== value) {
      throw new Error(`Invalid ${basename(file)} ${key}: expected ${value}, got ${doc?.[key]}`)
    }
  }
  if (!doc.updaterCacheDirName) throw new Error(`Invalid ${basename(file)}: missing updaterCacheDirName`)
}

function assertLatestMetadata() {
  const doc = yaml.load(readFileSync(latest, 'utf8'))
  if (doc?.version !== version) {
    throw new Error(`Invalid ${basename(latest)} version: expected ${version}, got ${doc?.version}`)
  }
  for (const file of doc.files ?? []) assertFile(join(dist, file.url))
  if (doc.path) assertFile(join(dist, doc.path))
}

function fileInfo(file) {
  const bytes = readFileSync(file)
  return {
    sha512: createHash('sha512').update(bytes).digest('base64'),
    size: bytes.length
  }
}

function resetGeneratedDirs() {
  rmSync(dist, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
}

function builderEnv() {
  return {
    APPLE_KEYCHAIN_PROFILE: profile,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/'
  }
}

function buildArtifacts() {
  resetGeneratedDirs()
  run('npm', ['run', 'build'])
  run('npx', ['electron-builder', '--mac', 'dir', '--publish', 'never'], {
    directNetwork: true,
    env: builderEnv()
  })
  notarizeAndStapleApp()
  run(
    'npx',
    ['electron-builder', '--mac', 'dmg', 'zip', '--prepackaged', app, '--publish', 'never'],
    {
      directNetwork: true,
      env: builderEnv()
    }
  )
}

function assertArtifacts() {
  for (const file of [app, dmg, zip, latest]) assertFile(file)
  assertAppUpdateMetadata(app)
  assertLatestMetadata()
}

async function rebuildDmgBlockMap() {
  await buildBlockMap(dmg, 'gzip', `${dmg}.blockmap`)
}

function refreshLatestMetadata() {
  const doc = yaml.load(readFileSync(latest, 'utf8'))
  for (const file of doc.files ?? []) {
    const artifact = join(dist, file.url)
    if (existsSync(artifact)) Object.assign(file, fileInfo(artifact))
  }
  if (doc.path) doc.sha512 = fileInfo(join(dist, doc.path)).sha512
  writeFileSync(latest, yaml.dump(doc, { lineWidth: 120 }), 'utf8')
}

function parseJsonOutput(res, label) {
  const text = String(res.stdout || res.stderr || '').trim()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Unable to parse ${label} JSON output:\n${text}`)
  }
}

function waitForNotary(id, file) {
  const deadline = Date.now() + notaryTimeoutMs
  while (Date.now() < deadline) {
    const res = run(
      'xcrun',
      ['notarytool', 'info', id, '--keychain-profile', profile, '--output-format', 'json'],
      {
        allowFailure: true,
        directNetwork: directNotaryNetwork,
        quiet: true
      }
    )
    if (res.status === 0) {
      const info = parseJsonOutput(res, 'notary info')
      if (info.status === 'Accepted') {
        console.log(`  • notary accepted ${basename(file)} (${id})`)
        return
      }
      if (info.status !== 'In Progress') {
        throw new Error(`Notary submission ${id} for ${file} finished with ${info.status}`)
      }
      console.log(`  • notary ${basename(file)} still in progress (${id})`)
    } else {
      const detail = String(res.stderr || res.stdout || '').trim()
      console.log(`  • notary info retry for ${basename(file)} (${id}): ${detail}`)
    }
    run('sleep', [String(notaryPollSeconds)], { quiet: true })
  }
  throw new Error(`Timed out waiting for notary submission ${id} for ${file}`)
}

function submitForNotary(file) {
  const args = [
    'notarytool',
    'submit',
    file,
    '--keychain-profile',
    profile,
    '--output-format',
    'json',
    '--no-wait'
  ]
  if (disableS3Acceleration) args.push('--no-s3-acceleration')
  const submit = run('xcrun', args, { directNetwork: directNotaryNetwork, quiet: true })
  const result = parseJsonOutput(submit, 'notary submit')
  if (!result.id) throw new Error(`Notary submit did not return an id for ${file}`)
  console.log(`  • notary submitted ${basename(file)} (${result.id})`)
  waitForNotary(result.id, file)
}

function notarizeAndStapleApp() {
  const tmp = mkdtempSync(join(tmpdir(), 'peeko-app-notary-'))
  const appZip = join(tmp, `${productName}.zip`)
  try {
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', basename(app), appZip], {
      cwd: dirname(app),
      quiet: true
    })
    submitForNotary(appZip)
    run('xcrun', ['stapler', 'staple', app])
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function signAndNotarizeDmg() {
  run('codesign', ['--sign', identity, '--timestamp', '--force', dmg])
  submitForNotary(dmg)
  run('xcrun', ['stapler', 'staple', dmg])
}

function verifyApp(appPath) {
  assertAppUpdateMetadata(appPath)
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  run('xcrun', ['stapler', 'validate', appPath])
  run('spctl', ['-a', '-vvv', '-t', 'execute', appPath])
}

function verifyDmg() {
  run('codesign', ['--verify', '--verbose=2', dmg])
  run('xcrun', ['stapler', 'validate', dmg])
  run('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmg])
}

function verifyMountedDmg() {
  const mountDir = mkdtempSync(join(tmpdir(), 'peeko-dmg-verify-'))
  try {
    run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountDir, dmg])
    verifyApp(join(mountDir, `${productName}.app`))
  } finally {
    run('hdiutil', ['detach', mountDir], { allowFailure: true, quiet: true })
    rmSync(mountDir, { recursive: true, force: true })
  }
}

function verifyArtifacts() {
  verifyApp(app)
  verifyDmg()
  verifyMountedDmg()
}

function printSummary() {
  const files = [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, latest].filter(existsSync)
  console.log('\nmacOS signed artifacts:')
  for (const file of files) console.log(`  ${file} (${statSync(file).size} bytes)`)
}

async function main() {
  if (!finalizeOnly) buildArtifacts()
  assertArtifacts()
  signAndNotarizeDmg()
  await rebuildDmgBlockMap()
  refreshLatestMetadata()
  verifyArtifacts()
  printSummary()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
