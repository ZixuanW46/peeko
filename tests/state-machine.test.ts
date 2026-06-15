/**
 * [INPUT]: 依赖 src/main/state-machine 的 reduce/initial/createMachine（纯函数，无 electron）
 * [OUTPUT]: 状态机转移表全覆盖测试 + Vanish 顺序断言
 * [POS]: tests 的行为内核守卫，确保 Vanish 只是普通隐藏组合动作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, it, expect } from 'vitest'
import { reduce, createMachine, type State, type Effect } from '../src/main/state-machine'

const at = (mode: State['mode']): State => ({ mode })

describe('画面显隐（⌃Z）', () => {
  it('NORMAL -> HIDDEN，只藏窗不动音频', () => {
    const t = reduce(at('NORMAL'), 'HIDE_TOGGLE', 0)
    expect(t.state.mode).toBe('HIDDEN')
    expect(t.effects).toEqual(['HIDE'])
  })

  it('HIDDEN -> NORMAL', () => {
    const t = reduce(at('HIDDEN'), 'HIDE_TOGGLE', 0)
    expect(t.state.mode).toBe('NORMAL')
    expect(t.effects).toEqual(['SHOW'])
  })

  it('PEEK 中按 Hide 转正显示，无重复效果', () => {
    const t = reduce(at('PEEK'), 'HIDE_TOGGLE', 0)
    expect(t.state.mode).toBe('NORMAL')
    expect(t.effects).toEqual([])
  })
})

describe('长按临显（⌃X）', () => {
  it('HIDDEN 按住 Peek 临时显示', () => {
    const t = reduce(at('HIDDEN'), 'PEEK_DOWN', 0)
    expect(t.state.mode).toBe('PEEK')
    expect(t.effects).toEqual(['SHOW'])
  })

  it('NORMAL 按住 Peek 不重复显示，松手隐藏', () => {
    const down = reduce(at('NORMAL'), 'PEEK_DOWN', 0)
    expect(down.state.mode).toBe('PEEK')
    expect(down.effects).toEqual([])

    const up = reduce(down.state, 'PEEK_UP', 1)
    expect(up.state.mode).toBe('HIDDEN')
    expect(up.effects).toEqual(['HIDE'])
  })

  it('非 PEEK 松手无效', () => {
    const t = reduce(at('NORMAL'), 'PEEK_UP', 0)
    expect(t.state.mode).toBe('NORMAL')
    expect(t.effects).toEqual([])
  })
})

describe('Vanish 键（⌃C）', () => {
  it('单击只输出 HIDE + MUTE + PAUSE，且 HIDE 永远第一', () => {
    const t = reduce(at('NORMAL'), 'BOSS', 1000)
    expect(t.state.mode).toBe('HIDDEN')
    expect(t.effects).toEqual(['HIDE', 'MUTE', 'PAUSE'])
  })

  it('Vanish 后 Hide / Show 能正常恢复窗口，不自动播放或取消静音', () => {
    const vanished = reduce(at('NORMAL'), 'BOSS', 1000)
    const shown = reduce(vanished.state, 'HIDE_TOGGLE', 1200)

    expect(shown.state.mode).toBe('NORMAL')
    expect(shown.effects).toEqual(['SHOW'])
  })

  it('重复 Vanish 仍是同一个普通动作，不退出、不自动恢复', () => {
    const first = reduce(at('NORMAL'), 'BOSS', 1000)
    const second = reduce(first.state, 'BOSS', 1100)

    expect(second.state.mode).toBe('HIDDEN')
    expect(second.effects).toEqual(['HIDE', 'MUTE', 'PAUSE'])
  })
})

describe('createMachine 运行时', () => {
  it('按顺序执行 Vanish 与 Show，没有延迟恢复副作用', () => {
    const log: Effect[] = []
    const m = createMachine((e) => log.push(e))

    m.dispatch('BOSS')
    m.dispatch('HIDE_TOGGLE')

    expect(m.mode()).toBe('NORMAL')
    expect(log).toEqual(['HIDE', 'MUTE', 'PAUSE', 'SHOW'])
  })
})
