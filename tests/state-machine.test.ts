/**
 * [INPUT]: 依赖 src/main/state-machine 的 reduce/initial/createMachine（纯函数，无 electron）
 * [OUTPUT]: 状态机转移表全覆盖测试 + 老板键时序 + 效果顺序断言
 * [POS]: tests 的行为内核守卫，Vanish-First 红线的机器证人
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  reduce,
  createMachine,
  BOSS_DOUBLE_MS,
  type State,
  type Effect
} from '../src/main/state-machine'

const at = (
  mode: State['mode'],
  prev: State['mode'] = 'NORMAL',
  lastBossAt = -Infinity
): State => ({
  mode,
  prev,
  lastBossAt
})

describe('画面显隐（⌃Z）', () => {
  it('NORMAL → HIDDEN，只藏窗不动音频', () => {
    const t = reduce(at('NORMAL'), 'HIDE_TOGGLE', 0)
    expect(t.state.mode).toBe('HIDDEN')
    expect(t.effects).toEqual(['HIDE'])
  })
  it('HIDDEN → NORMAL', () => {
    const t = reduce(at('HIDDEN'), 'HIDE_TOGGLE', 0)
    expect(t.state.mode).toBe('NORMAL')
    expect(t.effects).toEqual(['SHOW'])
  })
  it('PEEK 中按 H 转正显示，无重复效果', () => {
    const t = reduce(at('PEEK'), 'HIDE_TOGGLE', 0)
    expect(t.state.mode).toBe('NORMAL')
    expect(t.effects).toEqual([])
  })
  it('FEIGN 中 H 无效——假死只认老板键', () => {
    const t = reduce(at('FEIGN'), 'HIDE_TOGGLE', 0)
    expect(t.state.mode).toBe('FEIGN')
    expect(t.effects).toEqual([])
  })
})

describe('长按临显（⌃X）', () => {
  it('HIDDEN 按住 Peek 临时显示，松手隐藏', () => {
    expect(reduce(at('HIDDEN'), 'PEEK_DOWN', 0).state.mode).toBe('PEEK')
    expect(reduce(at('FEIGN'), 'PEEK_DOWN', 0).state.mode).toBe('FEIGN')
  })
  it('NORMAL 按住 Peek 不重复显示，松手隐藏', () => {
    const down = reduce(at('NORMAL'), 'PEEK_DOWN', 0)
    expect(down.state.mode).toBe('PEEK')
    expect(down.effects).toEqual([])

    const up = reduce(down.state, 'PEEK_UP', 1)
    expect(up.state.mode).toBe('HIDDEN')
    expect(up.effects).toEqual(['HIDE'])
  })
  it('松手回 HIDDEN，瞬时 HIDE', () => {
    const t = reduce(at('PEEK'), 'PEEK_UP', 0)
    expect(t.state.mode).toBe('HIDDEN')
    expect(t.effects).toEqual(['HIDE'])
  })
})

describe('老板键（⌃C）', () => {
  it('单击假死：HIDE 必须是第一个效果（Vanish-First 红线）', () => {
    const t = reduce(at('NORMAL'), 'BOSS', 1000)
    expect(t.state.mode).toBe('FEIGN')
    expect(t.state.prev).toBe('NORMAL')
    expect(t.effects[0]).toBe('HIDE')
    expect(t.effects).toEqual(['HIDE', 'MUTE', 'PAUSE'])
  })
  it('双击窗口内再次老板键 → QUIT', () => {
    const first = reduce(at('NORMAL'), 'BOSS', 1000)
    const second = reduce(first.state, 'BOSS', 1000 + BOSS_DOUBLE_MS)
    expect(second.effects).toEqual(['QUIT'])
  })
  it('假死后超过双击窗口再击 → 安排复活窗口而非立即复活', () => {
    const first = reduce(at('NORMAL'), 'BOSS', 1000)
    const second = reduce(first.state, 'BOSS', 1000 + BOSS_DOUBLE_MS + 1)
    expect(second.effects).toEqual([])
    expect(second.reviveInMs).toBe(BOSS_DOUBLE_MS)
  })
  it('画面隐藏态假死，复活后保持隐藏（不弹窗）', () => {
    const feign = reduce(at('HIDDEN'), 'BOSS', 1000)
    const revive = reduce(feign.state, 'REVIVE', 2500)
    expect(revive.state.mode).toBe('HIDDEN')
    expect(revive.effects).toEqual(['UNMUTE', 'PLAY'])
  })
  it('正常态假死，复活带 SHOW', () => {
    const feign = reduce(at('NORMAL'), 'BOSS', 1000)
    const revive = reduce(feign.state, 'REVIVE', 2500)
    expect(revive.state.mode).toBe('NORMAL')
    expect(revive.effects).toEqual(['UNMUTE', 'PLAY', 'SHOW'])
  })
  it('过期 REVIVE 定时器对非 FEIGN 态无效', () => {
    const t = reduce(at('NORMAL'), 'REVIVE', 0)
    expect(t.state.mode).toBe('NORMAL')
    expect(t.effects).toEqual([])
  })
})

describe('createMachine 运行时', () => {
  afterEach(() => vi.useRealTimers())

  it('假死单击后等待双击窗口自动复活；双击则取消复活直接退出', () => {
    vi.useFakeTimers()
    const log: Effect[] = []
    let now = 0
    const m = createMachine(
      (e) => log.push(e),
      () => now
    )

    now = 1000
    m.dispatch('BOSS') // 假死
    now = 1000 + BOSS_DOUBLE_MS + 1
    m.dispatch('BOSS') // 安排复活
    vi.advanceTimersByTime(BOSS_DOUBLE_MS)
    expect(m.mode()).toBe('NORMAL')
    expect(log).toEqual(['HIDE', 'MUTE', 'PAUSE', 'UNMUTE', 'PLAY', 'SHOW'])

    now += BOSS_DOUBLE_MS + 1
    m.dispatch('BOSS') // 再假死
    now += 300
    m.dispatch('BOSS') // 双击退出
    vi.advanceTimersByTime(1000)
    expect(log).toContain('QUIT')
    expect(m.mode()).toBe('FEIGN') // QUIT 后状态冻结，不再复活
  })
})
