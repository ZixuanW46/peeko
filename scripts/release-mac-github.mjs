#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: 干净 git 工作区、package.json version、electron-builder 配置、Apple notary profile、gh CLI 登录态
 * [OUTPUT]: 构建/签名/公证/验收 macOS 产物，推送 commit/tag，并上传白名单产物到 GitHub Release
 * [POS]: scripts 的正式 macOS 发布入口；避免未验收或未绑定源码版本的 DMG 被直接发布
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`
const productName = pkg.productName ?? 'Peeko'
const packageName = pkg.name ?? 'peeko'
const repo = process.env.PEEKO_GITHUB_REPO ?? 'ZixuanW46/peeko'
const remote = process.env.PEEKO_GIT_REMOTE ?? 'origin'
const dist = join(root, 'dist')
const app = join(dist, 'mac-arm64', `${productName}.app`)
const dmg = join(dist, `${packageName}-${version}.dmg`)
const zip = join(dist, `${productName}-${version}-arm64-mac.zip`)
const latest = join(dist, 'latest-mac.yml')
const releaseBranch = process.env.PEEKO_RELEASE_BRANCH ?? 'public'
const allowDirty = process.env.PEEKO_RELEASE_ALLOW_DIRTY === '1'
const allowBranch = process.env.PEEKO_RELEASE_ALLOW_BRANCH === '1'
const skipGitPush = process.env.PEEKO_RELEASE_SKIP_GIT_PUSH === '1'

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: opts.quiet ? 'pipe' : 'inherit',
    cwd: root,
    text: true
  })
  if (!opts.allowFailure && res.status !== 0) {
    const detail = res.stderr || res.stdout || ''
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`)
  }
  return res
}

function assertFile(file) {
  if (!existsSync(file)) throw new Error(`Missing release artifact: ${file}`)
}

function stdout(cmd, args) {
  return String(run(cmd, args, { quiet: true }).stdout ?? '').trim()
}

function shortOutput(text, maxLines = 40) {
  const lines = text.trim().split('\n')
  const shown = lines.slice(0, maxLines).join('\n')
  const more = lines.length > maxLines ? `\n... ${lines.length - maxLines} more lines` : ''
  return `${shown}${more}`
}

function releaseAssets() {
  return [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, latest].filter(existsSync)
}

function currentBranch() {
  return stdout('git', ['branch', '--show-current'])
}

function remoteMatchesRepo(remoteUrl) {
  const lowerUrl = remoteUrl.toLowerCase().replace(/\.git$/, '')
  const lowerRepo = repo.toLowerCase()
  return (
    lowerUrl.endsWith(`github.com/${lowerRepo}`) || lowerUrl.endsWith(`github.com:${lowerRepo}`)
  )
}

function assertReleaseBranch() {
  if (allowBranch) return
  const branch = currentBranch()
  if (branch !== releaseBranch) {
    throw new Error(
      [
        `Release must run from ${releaseBranch}.`,
        `Current branch: ${branch || '(detached HEAD)'}`,
        `Update the public worktree from dev first, then release from the ${releaseBranch} worktree.`
      ].join('\n')
    )
  }
}

function assertCleanSource() {
  if (allowDirty) return
  const status = stdout('git', ['status', '--porcelain'])
  if (!status) return
  throw new Error(
    [
      'Release requires a clean git working tree.',
      'Commit or stash local changes first so the uploaded assets map to one exact source commit.',
      '',
      shortOutput(status)
    ].join('\n')
  )
}

function assertGitHubTarget() {
  const remoteUrl = stdout('git', ['remote', 'get-url', remote])
  if (!remoteMatchesRepo(remoteUrl)) {
    throw new Error(
      [
        `Git remote ${remote} does not point at ${repo}.`,
        `Current ${remote}: ${remoteUrl}`,
        `Set ${remote} to git@github.com:${repo}.git or override PEEKO_GIT_REMOTE/PEEKO_GITHUB_REPO deliberately.`
      ].join('\n')
    )
  }
  run('gh', ['auth', 'status'], { quiet: true })
  run('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'], { quiet: true })
}

function ensureReleaseTag() {
  if (skipGitPush) return
  const branch = currentBranch()
  if (!branch) throw new Error('Release requires a named git branch; detached HEAD is not allowed.')

  run('git', ['fetch', remote, '--tags', '--prune'])

  const head = stdout('git', ['rev-parse', 'HEAD'])
  const existing = run('git', ['rev-parse', '--verify', '--quiet', tag], {
    allowFailure: true,
    quiet: true
  })

  if (existing.status === 0) {
    const taggedCommit = stdout('git', ['rev-list', '-n', '1', tag])
    if (taggedCommit !== head) {
      throw new Error(`Tag ${tag} already exists but does not point at HEAD.`)
    }
  } else {
    run('git', ['tag', '-a', tag, '-m', `Peeko ${version}`])
  }

  run('git', ['push', remote, `HEAD:${branch}`])
  run('git', ['push', remote, tag])
}

function uploadRelease() {
  const assets = releaseAssets()
  const names = assets.map((asset) => basename(asset)).join(', ')
  const exists = run('gh', ['release', 'view', tag, '--repo', repo], {
    allowFailure: true,
    quiet: true
  })
  if (exists.status === 0) {
    run('gh', ['release', 'upload', tag, '--repo', repo, '--clobber', ...assets])
    return
  }
  run('gh', [
    'release',
    'create',
    tag,
    '--repo',
    repo,
    '--title',
    `Peeko ${version}`,
    '--notes',
    `Peeko ${version}\n\nAssets: ${names}`,
    ...assets
  ])
}

assertReleaseBranch()
assertCleanSource()
assertGitHubTarget()

run('node', ['scripts/build-mac-signed.mjs'])

assertFile(app)
assertFile(dmg)
assertFile(zip)
assertFile(latest)

ensureReleaseTag()
uploadRelease()
