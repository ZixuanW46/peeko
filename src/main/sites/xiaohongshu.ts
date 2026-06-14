/**
 * [INPUT]: 依赖 ./generic 的兜底算法（继承后叠加站点特修）
 * [OUTPUT]: 对外提供 xiaohongshuRule——小红书直播/视频页精修规则
 * [POS]: sites 的首个站点精修层，generic 之上的增量
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SiteRule } from './index'
import { genericRule } from './generic'

// 站点特修：generic 的保留链算法之外，压掉播放器容器内部的浮层
// （弹幕/礼物/互动层与 video 同容器，selector 实机迭代补充）
const EXTRA_CSS = `
[data-peeko-keep] .danmaku, [data-peeko-keep] [class*="danmu"],
[data-peeko-keep] [class*="barrage"], [data-peeko-keep] [class*="gift"] {
  display: none !important;
}
`

export const xiaohongshuRule: SiteRule = {
  id: 'xiaohongshu',
  match: (url) => url.includes('xiaohongshu.com'),
  css: genericRule.css + EXTRA_CSS,
  jsOn: genericRule.jsOn,
  jsOff: genericRule.jsOff
}
