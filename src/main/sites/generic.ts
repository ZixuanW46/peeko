/**
 * [INPUT]: 零依赖（纯字符串模块——CSS/JS 注入片段）
 * [OUTPUT]: 对外提供 genericRule——任意视频站的兜底净化规则
 * [POS]: sites 的兜底层，"声明保留链，其余自灭"算法的唯一实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SiteRule } from './index'

// ============================================================
// 算法：找最大就绪视频 → 祖先链标记 data-peeko-keep →
//       CSS 隐藏链上每层的未标记兄弟 → 视频 fixed 铺满。
// MutationObserver 守护 SPA 重渲染，jsOff 全量撤销。
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
  const mark = () => {
    const v = [...document.querySelectorAll('video')]
      .filter(x => x.readyState > 0 && x.getBoundingClientRect().width > 0)
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
        return rb.width * rb.height - ra.width * ra.height
      })[0]
    if (!v) return
    document.querySelectorAll('[data-peeko-keep],[data-peeko-video],[data-moyu-keep],[data-moyu-video]').forEach(n => {
      if (n !== v && !n.contains(v)) {
        n.removeAttribute('data-peeko-keep')
        n.removeAttribute('data-peeko-video')
        n.removeAttribute('data-moyu-keep')
        n.removeAttribute('data-moyu-video')
      }
    })
    v.setAttribute('data-peeko-video', '')
    for (let n = v.parentElement; n; n = n.parentElement) n.setAttribute('data-peeko-keep', '')
  }
  mark()
  const mo = new MutationObserver(() => {
    if (!document.querySelector('video[data-peeko-video]')) mark()
  })
  mo.observe(document.body, { childList: true, subtree: true })
  window.__peekoCinemaOff = () => {
    mo.disconnect()
    document.querySelectorAll('[data-peeko-keep],[data-peeko-video],[data-moyu-keep],[data-moyu-video]').forEach(n => {
      n.removeAttribute('data-peeko-keep')
      n.removeAttribute('data-peeko-video')
      n.removeAttribute('data-moyu-keep')
      n.removeAttribute('data-moyu-video')
    })
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
