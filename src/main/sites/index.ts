/**
 * [INPUT]: 依赖 electron 的 WebContents（注入执行），./generic 与 ./xiaohongshu 规则
 * [OUTPUT]: 对外提供 SiteRule 类型、pickRule(url)、injectRule/ejectRule 执行器
 * [POS]: sites 的注册表与注入执行层，modes.ts 的唯一下游
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebContents } from 'electron'
import { genericRule } from './generic'
import { xiaohongshuRule } from './xiaohongshu'

export interface SiteRule {
  id: string
  match: (url: string) => boolean
  css: string
  jsOn: string
  jsOff: string
}

// 顺序即优先级，generic 永远兜底
const RULES: SiteRule[] = [xiaohongshuRule, genericRule]

export const pickRule = (url: string): SiteRule => RULES.find((r) => r.match(url)) ?? genericRule

let cssKey: string | null = null
let active: SiteRule | null = null

export async function injectRule(wc: WebContents, url: string): Promise<void> {
  await ejectRule(wc)
  active = pickRule(url)
  cssKey = await wc.insertCSS(active.css)
  await wc.executeJavaScript(active.jsOn).catch(() => {})
}

export async function ejectRule(wc: WebContents): Promise<void> {
  if (!active) return
  if (cssKey) await wc.removeInsertedCSS(cssKey).catch(() => {})
  await wc.executeJavaScript(active.jsOff).catch(() => {})
  cssKey = null
  active = null
}
