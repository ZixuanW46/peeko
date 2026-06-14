/**
 * [INPUT]: 依赖 shared/updater 的纯状态机与双语文案函数
 * [OUTPUT]: 验证检查、可更新、下载、完成、失败、单主动作与托盘文本
 * [POS]: tests 的更新系统守卫，防止自动更新状态散落在 renderer 分支里
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, it } from 'vitest'
import {
  createInitialUpdateState,
  reduceUpdateState,
  updateActionState,
  updateErrorText,
  updatePrimaryAction,
  updateStatusText,
  updateTrayCommand,
  updateTrayLabel
} from '../src/shared/updater'

describe('update state machine', () => {
  it('检查到新版后等待用户下载', () => {
    const checking = reduceUpdateState(createInitialUpdateState('0.1.1'), {
      type: 'CHECK_START',
      at: 100
    })
    const available = reduceUpdateState(checking, {
      type: 'UPDATE_AVAILABLE',
      version: '0.1.2',
      at: 120
    })

    expect(available.phase).toBe('available')
    expect(available.latestVersion).toBe('0.1.2')
    expect(updateActionState(available)).toEqual({
      canCheck: false,
      canDownload: true,
      canInstall: false,
      busy: false
    })
    expect(updatePrimaryAction(available, 'zh')).toEqual({
      command: 'update-download',
      enabled: true,
      label: '下载更新'
    })
    expect(updateTrayCommand(available)).toBe('update-download')
    expect(updateTrayLabel(available, 'en')).toBe('Update to 0.1.2...')
  })

  it('无新版时给手动检查显示最新状态', () => {
    const state = reduceUpdateState(createInitialUpdateState('0.1.1'), {
      type: 'UPDATE_NOT_AVAILABLE',
      at: 200
    })

    expect(state.phase).toBe('not-available')
    expect(updateStatusText(state, 'zh')).toBe('Peeko 已是最新版本')
    expect(updateActionState(state).canCheck).toBe(true)
  })

  it('下载进度被收敛为 0-100，完成后只允许安装', () => {
    const available = reduceUpdateState(createInitialUpdateState('0.1.1'), {
      type: 'UPDATE_AVAILABLE',
      version: '0.1.2',
      at: 100
    })
    const downloading = reduceUpdateState(available, { type: 'DOWNLOAD_PROGRESS', progress: 108.2 })
    const downloaded = reduceUpdateState(downloading, { type: 'DOWNLOAD_READY' })

    expect(downloading.progress).toBe(100)
    expect(updateStatusText(downloading, 'en')).toBe('Downloading update 100%')
    expect(downloaded.phase).toBe('downloaded')
    expect(updateActionState(downloaded)).toEqual({
      canCheck: false,
      canDownload: false,
      canInstall: true,
      busy: false
    })
    expect(updatePrimaryAction(downloaded, 'en')).toEqual({
      command: 'update-install',
      enabled: true,
      label: 'Restart & Install'
    })
    expect(updateTrayCommand(downloaded)).toBe('update-install')
    expect(updateTrayLabel(downloaded, 'zh')).toBe('重启以更新')
  })

  it('错误状态保留当前版本并允许重新检查', () => {
    const state = reduceUpdateState(createInitialUpdateState('0.1.1'), {
      type: 'ERROR',
      error: 'GitHub Release is unavailable'
    })

    expect(state.phase).toBe('error')
    expect(state.currentVersion).toBe('0.1.1')
    expect(updateStatusText(state, 'en')).toBe('GitHub Release is unavailable')
    expect(updateActionState(state).canCheck).toBe(true)
  })

  it('GitHub 404 不把机器错误暴露给设置页', () => {
    const raw = '404 {"method":"GET","url":"https://github.com/ZixuanW46/peeko"}'
    const state = reduceUpdateState(createInitialUpdateState('0.1.1'), {
      type: 'ERROR',
      error: raw
    })

    expect(updateErrorText(raw, 'zh')).toBe('更新源尚未发布')
    expect(updateStatusText(state, 'en')).toBe('Update feed is not published yet')
    expect(updatePrimaryAction(state, 'en')).toEqual({
      command: 'update-check',
      enabled: true,
      label: 'Check Again'
    })
  })
})
