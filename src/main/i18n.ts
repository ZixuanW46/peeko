/**
 * [INPUT]: 依赖 electron app.getLocale 与 store.language
 * [OUTPUT]: 对外提供语言偏好解析、写入与主进程文案选择
 * [POS]: main 的语言门闩——系统语言只在这里解析，renderer 只消费 resolved language
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app } from 'electron'
import { resolveLanguage, tx, type LanguagePreference, type LanguageSettings } from '../shared/i18n'
import { store } from './store'

export function getLanguageSettings(): LanguageSettings {
  const systemLocale = app.getLocale?.() || 'en'
  return {
    preference: store.data.language,
    resolved: resolveLanguage(store.data.language, systemLocale),
    systemLocale
  }
}

export function setLanguagePreference(preference: LanguagePreference): LanguageSettings {
  store.patch({ language: preference })
  return getLanguageSettings()
}

export function t(en: string, zh: string): string {
  return tx(getLanguageSettings().resolved, en, zh)
}
