/**
 * [INPUT]: 零依赖（纯函数模块，electron 不可入内——可测试性铁律）
 * [OUTPUT]: 对外提供 reduce 纯转移函数、createMachine 工厂、Mode/Effect/Event 类型
 * [POS]: main 的行为内核——三态状态机，所有快捷键语义的唯一真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type Mode = 'NORMAL' | 'HIDDEN' | 'PEEK'
export type Effect = 'SHOW' | 'HIDE' | 'MUTE' | 'PAUSE'
export type Event =
  | 'HIDE_TOGGLE'
  | 'PEEK_DOWN'
  | 'PEEK_UP'
  | 'BOSS'
  | 'FORCE_NORMAL'
  | 'FORCE_HIDDEN'

export interface State {
  mode: Mode
}

export interface Transition {
  state: State
  effects: Effect[]
}

export const initial: State = { mode: 'NORMAL' }

const noop = (s: State): Transition => ({ state: s, effects: [] })

// ============================================================
// 纯转移函数：状态 × 事件 × 时刻 → 新状态 + 副作用序列
// 效果顺序即执行顺序——Vanish 的 HIDE 永远排第一
// ============================================================
export function reduce(s: State, ev: Event, now = 0): Transition {
  void now
  switch (ev) {
    case 'HIDE_TOGGLE':
      if (s.mode === 'NORMAL') return { state: { ...s, mode: 'HIDDEN' }, effects: ['HIDE'] }
      if (s.mode === 'HIDDEN') return { state: { ...s, mode: 'NORMAL' }, effects: ['SHOW'] }
      if (s.mode === 'PEEK') return { state: { ...s, mode: 'NORMAL' }, effects: [] }
      return noop(s)

    case 'PEEK_DOWN':
      if (s.mode === 'HIDDEN') return { state: { ...s, mode: 'PEEK' }, effects: ['SHOW'] }
      if (s.mode === 'NORMAL') return { state: { ...s, mode: 'PEEK' }, effects: [] }
      return noop(s)

    case 'PEEK_UP':
      if (s.mode !== 'PEEK') return noop(s)
      return { state: { ...s, mode: 'HIDDEN' }, effects: ['HIDE'] }

    case 'BOSS':
      return { state: { ...s, mode: 'HIDDEN' }, effects: ['HIDE', 'MUTE', 'PAUSE'] }

    // 引导闯关的状态预置：把窗口摆到关卡需要的起点。
    case 'FORCE_NORMAL':
      return { state: { ...s, mode: 'NORMAL' }, effects: ['SHOW'] }

    case 'FORCE_HIDDEN':
      return { state: { ...s, mode: 'HIDDEN' }, effects: ['HIDE'] }
  }
}

// ============================================================
// 运行时外壳：持有状态，把效果交给执行器
// ============================================================
export interface Machine {
  dispatch(ev: Event): void
  mode(): Mode
}

export function createMachine(
  execute: (e: Effect) => void,
  clock = (): number => Date.now(),
  observe?: (ev: Event, mode: Mode) => void
): Machine {
  let state = initial

  const dispatch = (ev: Event): void => {
    const t = reduce(state, ev, clock())
    state = t.state
    t.effects.forEach(execute)
    observe?.(ev, state.mode)
  }

  return { dispatch, mode: () => state.mode }
}
