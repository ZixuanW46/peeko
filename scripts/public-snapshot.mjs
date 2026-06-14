#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * [INPUT]: 当前 dev 工作区（允许 dirty）与公开白名单/黑名单规则
 * [OUTPUT]: 在独立 worktree 中生成/更新 public 分支快照并提交
 * [POS]: dev -> public 的唯一出口；避免内部文档、Agent 镜像和历史过程进入公开仓库
 * [PROTOCOL]: 变更时更新 CLAUDE.md，并确认 release:mac 只在 public 分支运行
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const publicBranch = process.env.PEEKO_PUBLIC_BRANCH ?? 'public'
const worktree = resolve(
  process.env.PEEKO_PUBLIC_WORKTREE ??
    join(dirname(root), `${basename(root)}-${publicBranch}-worktree`)
)
const commitMessage =
  process.env.PEEKO_PUBLIC_COMMIT_MESSAGE ?? `chore: update ${publicBranch} snapshot`

const rsyncExcludes = [
  '.git/',
  'node_modules/',
  'out/',
  'dist/',
  '.DS_Store',
  '.eslintcache',
  '*.log*',
  '.env',
  '.env.*',
  '.agents/',
  '.claude/',
  '.cursor/',
  '.gemini/',
  'landing/',
  'skills-lock.json',
  'PRODUCT.md',
  'DESIGN.md',
  'docs/',
  'AGENTS.md',
  'CLAUDE.md',
  '**/CLAUDE.md',
  'peeko-logo-hd*-screenshot-match.png'
]

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: opts.quiet ? 'pipe' : 'inherit',
    cwd: opts.cwd ?? root,
    text: true
  })
  if (!opts.allowFailure && res.status !== 0) {
    const detail = res.stderr || res.stdout || ''
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `\n${detail}` : ''}`)
  }
  return res
}

function stdout(cmd, args, opts = {}) {
  return String(run(cmd, args, { ...opts, quiet: true }).stdout ?? '').trim()
}

function branchExists(branch) {
  return (
    run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      allowFailure: true,
      quiet: true
    }).status === 0
  )
}

function ensurePublicWorktree() {
  mkdirSync(dirname(worktree), { recursive: true })
  if (existsSync(join(worktree, '.git'))) return
  if (existsSync(worktree) && readdirSync(worktree).length > 0) {
    throw new Error(`Refusing to reuse non-empty non-worktree path: ${worktree}`)
  }

  if (branchExists(publicBranch)) {
    run('git', ['worktree', 'add', worktree, publicBranch])
    return
  }

  run('git', ['worktree', 'add', '--detach', worktree, 'HEAD'])
  run('git', ['switch', '--orphan', publicBranch], { cwd: worktree })
}

function cleanPublicWorktree() {
  for (const entry of readdirSync(worktree)) {
    if (entry === '.git') continue
    rmSync(join(worktree, entry), { recursive: true, force: true })
  }
}

function copyPublicFiles() {
  run('rsync', [
    '-a',
    ...rsyncExcludes.map((pattern) => `--exclude=${pattern}`),
    `${root}/`,
    `${worktree}/`
  ])
}

function commitSnapshot() {
  run('git', ['add', '-A'], { cwd: worktree })
  const status = stdout('git', ['status', '--porcelain'], { cwd: worktree })
  if (!status) {
    console.log(`public snapshot unchanged: ${publicBranch}`)
    return
  }
  run('git', ['commit', '-m', commitMessage], { cwd: worktree })
}

ensurePublicWorktree()
cleanPublicWorktree()
copyPublicFiles()
commitSnapshot()

console.log(`public branch: ${publicBranch}`)
console.log(`public worktree: ${worktree}`)
