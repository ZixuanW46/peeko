export type LanguagePreference = 'system' | 'zh' | 'en'
export type ResolvedLanguage = 'zh' | 'en'

export interface LanguageSettings {
  preference: LanguagePreference
  resolved: ResolvedLanguage
  systemLocale: string
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'zh' || value === 'en'
}

export function resolveLanguage(
  preference: LanguagePreference,
  systemLocale: string
): ResolvedLanguage {
  if (preference === 'zh' || preference === 'en') return preference
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function tx(language: ResolvedLanguage, en: string, zh: string): string {
  return language === 'zh' ? zh : en
}
