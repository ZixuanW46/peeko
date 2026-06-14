/**
 * [INPUT]: 零依赖（纯函数模块，electron 不可入内——可测试性铁律）
 * [OUTPUT]: 对外提供 reduce 纯转移函数、createMachine 工厂、Mode/Effect/Event 类型
 * [POS]: main 的行为内核——四态状态机，所有快捷键语义的唯一真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type Mode = 'NORMAL' | 'HIDDEN' | 'PEEK' | 'FEIGN'
export type Effect = 'SHOW' | 'HIDE' | 'MUTE' | 'UNMUTE' | 'PAUSE' | 'PLAY' | 'QUIT'
export type Event =
  | 'HIDE_TOGGLE'
  | 'PEEK_DOWN'
  | 'PEEK_UP'
  | 'BOSS'
  | 'REVIVE'
  | 'FORCE_NORMAL'
  | 'FORCE_HIDDEN'

export interface State {
  mode: Mode
  prev: Mode
  lastBossAt: number
}

export interface Transition {
  state: State
  effects: Effect[]
  reviveInMs?: number
}

export const BOSS_DOUBLE_MS = 1200

export const initial: State = { mode: 'NORMAL', prev: 'NORMAL', lastBossAt: -Infinity }

const noop = (s: State): Transition => ({ state: s, effects: [] })

// ============================================================
// 纯转移函数：状态 × 事件 × 时刻 → 新状态 + 副作用序列
// 效果顺序即执行顺序——FEIGN 的 HIDE 永远排第一（Vanish-First）
// ============================================================
export function reduce(s: State, ev: Event, now: number): Transition {
  switch (ev) {
    case 'HIDE_TOGGLE':
      if (s.mode === 'NORMAL') return { state: { ...s, mode: 'HIDDEN' }, effects: ['HIDE'] }
      if (s.mode === 'HIDDEN') return { state: { ...s, mode: 'NORMAL' }, effects: ['SHOW'] }
      if (s.mode === 'PEEK') return { state: { ...s, mode: 'NORMAL' }, effects: [] }
      return noop(s) // FEIGN 只认老板键

    case 'PEEK_DOWN':
      if (s.mode === 'HIDDEN') return { state: { ...s, mode: 'PEEK' }, effects: ['SHOW'] }
      if (s.mode === 'NORMAL') return { state: { ...s, mode: 'PEEK' }, effects: [] }
      return noop(s)

    case 'PEEK_UP':
      if (s.mode !== 'PEEK') return noop(s)
      return { state: { ...s, mode: 'HIDDEN' }, effects: ['HIDE'] }

    case 'BOSS': {
      const stamped = { ...s, lastBossAt: now }
      if (now - s.lastBossAt <= BOSS_DOUBLE_MS) return { state: stamped, effects: ['QUIT'] }
      if (s.mode !== 'FEIGN')
        return {
          state: { ...stamped, mode: 'FEIGN', prev: s.mode },
          effects: ['HIDE', 'MUTE', 'PAUSE']
        }
      // 已假死再单击：留出双击窗口，到期未续击才复活
      return { state: stamped, effects: [], reviveInMs: BOSS_DOUBLE_MS }
    }

    case 'REVIVE': {
      if (s.mode !== 'FEIGN') return noop(s) // 过期定时器
      const effects: Effect[] = ['UNMUTE', 'PLAY']
      if (s.prev !== 'HIDDEN') effects.push('SHOW')
      return { state: { ...s, mode: s.prev }, effects }
    }

    // 引导闯关的状态预置：把窗口摆到关卡需要的起点（FEIGN 需先解除静默）
    case 'FORCE_NORMAL': {
      const effects: Effect[] = s.mode === 'FEIGN' ? ['UNMUTE', 'PLAY', 'SHOW'] : ['SHOW']
      return { state: { ...s, mode: 'NORMAL' }, effects }
    }

    case 'FORCE_HIDDEN': {
      const effects: Effect[] = s.mode === 'FEIGN' ? ['UNMUTE', 'PLAY', 'HIDE'] : ['HIDE']
      return { state: { ...s, mode: 'HIDDEN' }, effects }
    }
  }
}

// ============================================================
// 运行时外壳：持有状态、调度 REVIVE 定时器、把效果交给执行器
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
  let reviveTimer: ReturnType<typeof setTimeout> | null = null

  const dispatch = (ev: Event): void => {
    const t = reduce(state, ev, clock())
    state = t.state
    if (reviveTimer && ev === 'BOSS') {
      clearTimeout(reviveTimer)
      reviveTimer = null
    }
    if (t.reviveInMs !== undefined) {
      reviveTimer = setTimeout(() => {
        reviveTimer = null
        dispatch('REVIVE')
      }, t.reviveInMs)
    }
    t.effects.forEach(execute)
    observe?.(ev, state.mode) // 观察者收到含内部 REVIVE 在内的全部事件
  }

  return { dispatch, mode: () => state.mode }
}
