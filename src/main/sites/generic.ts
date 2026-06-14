/**
 * [INPUT]: 零依赖（纯字符串模块——CSS/JS 注入片段）
 * [OUTPUT]: 对外提供 genericRule——任意视频站的兜底净化规则
 * [POS]: sites 的兜底层，"声明保留链，其余自灭"算法的唯一实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SiteRule } from './index'

// ============================================================
// 算法：周期性撤销旧链 → 重新测量最大就绪视频 → 祖先链标记 data-peeko-keep。
// 先撤再量是关键：广告结束后，真正视频常被旧广告保留链的 CSS 隐藏，
// 不把特殊情况消掉，新视频永远没有资格被选中。
// ============================================================
const CSS = `
/* [data-peeko-badge] 是 preload 的状态徽章子树，所有净化规则不得触碰 */
[data-peeko-keep] > :not([data-peeko-keep]):not([data-peeko-video]):not([data-peeko-badge]) { display: none !important; }
/* 祖先链全员摊平：清除 transform（fixed 定位陷阱）并逐层铺满视口，
   播放器容器的信箱式留边随之消失 */
[data-peeko-keep] {
  position: fixed !important; inset: 0 !important;
  width: 100vw !important; height: 100vh !important;
  max-width: none !important; max-height: none !important;
  margin: 0 !important; padding: 0 !important;
  transform: none !important; clip-path: none !important;
  border: 0 !important; border-radius: 0 !important;
  background: #000 !important; overflow: visible !important;
}
video[data-peeko-video] {
  position: fixed !important; inset: 0 !important;
  width: 100vw !important; height: 100vh !important;
  object-fit: contain !important; background: #000 !important;
  z-index: 2147483647 !important;
}
html, body { background: #000 !important; overflow: hidden !important; }
`

const JS_ON = `(() => {
  if (window.__peekoCinemaOff) return
  const TAGS = '[data-peeko-keep],[data-peeko-video],[data-moyu-keep],[data-moyu-video]'
  const clearMarks = () => {
    document.querySelectorAll(TAGS).forEach(n => {
      n.removeAttribute('data-peeko-keep')
      n.removeAttribute('data-peeko-video')
      n.removeAttribute('data-moyu-keep')
      n.removeAttribute('data-moyu-video')
    })
  }
  const area = (v) => {
    const r = v.getBoundingClientRect()
    return r.width * r.height
  }
  const candidate = (v) => {
    const r = v.getBoundingClientRect()
    const s = getComputedStyle(v)
    return v.isConnected && v.readyState > 0 && r.width > 0 && r.height > 0 &&
      s.display !== 'none' && s.visibility !== 'hidden'
  }
  const mark = () => {
    const previous = document.querySelector('video[data-peeko-video]')
    clearMarks()
    const v = [...document.querySelectorAll('video')]
      .filter(candidate)
      .sort((a, b) => area(b) - area(a))[0] || (previous?.isConnected ? previous : null)
    if (!v) return clearMarks()
    v.setAttribute('data-peeko-video', '')
    for (let n = v.parentElement; n; n = n.parentElement) n.setAttribute('data-peeko-keep', '')
  }
  let pending = 0
  const scheduleMark = () => {
    if (pending) return
    pending = window.setTimeout(() => {
      pending = 0
      mark()
    }, 80)
  }
  mark()
  const timer = window.setInterval(mark, 800)
  const mo = new MutationObserver(scheduleMark)
  mo.observe(document.body, { childList: true, subtree: true })
  window.__peekoCinemaOff = () => {
    window.clearInterval(timer)
    if (pending) window.clearTimeout(pending)
    mo.disconnect()
    clearMarks()
    delete window.__peekoCinemaOff
  }
})()`

const JS_OFF = `(window.__peekoCinemaOff || window.__moyuCinemaOff)?.()`

export const genericRule: SiteRule = {
  id: 'generic',
  match: () => true,
  css: CSS,
  jsOn: JS_ON,
  jsOff: JS_OFF
}
