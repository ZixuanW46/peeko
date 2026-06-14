/**
 * [INPUT]: 依赖 src/main/sites 的 pickRule（match 为纯函数）
 * [OUTPUT]: 站点规则匹配与优先级测试
 * [POS]: tests 的规则注册表守卫
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, it, expect } from 'vitest'
import { pickRule } from '../src/main/sites/index'
import { genericRule } from '../src/main/sites/generic'

describe('pickRule', () => {
  it('小红书域名命中精修规则', () => {
    expect(pickRule('https://www.xiaohongshu.com/worldcup26').id).toBe('xiaohongshu')
    expect(pickRule('https://www.xiaohongshu.com/live/123').id).toBe('xiaohongshu')
  })
  it('其他站点落入 generic 兜底', () => {
    expect(pickRule('https://www.iqiyi.com/v_abc.html').id).toBe('generic')
    expect(pickRule('https://v.qq.com/x/cover/xyz').id).toBe('generic')
  })
  it('精修规则继承 generic 的保留链算法', () => {
    const xhs = pickRule('https://www.xiaohongshu.com/x')
    expect(xhs.css).toContain('data-peeko-keep')
    expect(xhs.jsOn).toContain('__peekoCinemaOff')
  })
  it('兜底规则周期性重选视频，避免广告切正片后锁旧链', () => {
    expect(genericRule.jsOn).toContain('clearMarks()')
    expect(genericRule.jsOn).toContain('setInterval(mark, 800)')
    expect(genericRule.jsOn).toContain('new MutationObserver(scheduleMark)')
  })
})
