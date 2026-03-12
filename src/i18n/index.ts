/**
 * Lightweight i18n system with type-safe translation keys.
 */

import { create } from 'zustand'
import { en } from './locales/en'

/* ── Types ─────────────────────────────────────────────── */

export type Locale = 'en' | 'ko' | 'ja' | 'zh'
export type TranslationTree = typeof en

type FlattenKeys<T, Prefix extends string = ''> = T extends string
  ? Prefix
  : T extends Record<string, any>
    ? { [K in keyof T & string]: FlattenKeys<T[K], Prefix extends '' ? K : `${Prefix}.${K}`> }[keyof T & string]
    : never

export type TranslationKey = FlattenKeys<TranslationTree>

/* ── Store ─────────────────────────────────────────────── */

interface I18nStore {
  locale: Locale
  translations: TranslationTree
  setLocale: (locale: Locale) => Promise<void>
}

const LOCALE_LOADERS: Record<Locale, () => Promise<TranslationTree>> = {
  en: async () => en,
  ko: async () => (await import('./locales/ko')).ko,
  ja: async () => (await import('./locales/ja')).ja,
  zh: async () => (await import('./locales/zh')).zh,
}

const savedLocale = (() => {
  try { return (localStorage.getItem('orion:locale') as Locale) || 'en' } catch { return 'en' as Locale }
})()

export const useI18nStore = create<I18nStore>((set) => ({
  locale: savedLocale,
  translations: en,

  setLocale: async (locale: Locale) => {
    try {
      const translations = await LOCALE_LOADERS[locale]()
      set({ locale, translations })
      localStorage.setItem('orion:locale', locale)
      document.documentElement.lang = locale
    } catch (err) {
      console.warn('Failed to load locale:', locale, err)
    }
  },
}))

// Load saved locale on startup
if (savedLocale !== 'en') {
  useI18nStore.getState().setLocale(savedLocale)
}

/* ── Translation Function ──────────────────────────────── */

function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === undefined || current === null) return undefined
    current = current[part]
  }
  return typeof current === 'string' ? current : undefined
}

/**
 * Translate a key with optional interpolation.
 * Falls back to English if key not found in current locale.
 *
 * Usage: t('menu.file.new') or t('editor.lineCount', { count: 42 })
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const { translations } = useI18nStore.getState()

  let text = getNestedValue(translations, key)
  if (text === undefined) {
    // Fallback to English
    text = getNestedValue(en, key)
  }
  if (text === undefined) {
    return key // Return key itself as last resort
  }

  // Interpolation: replace {{var}} with values
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
    }
  }

  return text
}

/* ── React Hook ────────────────────────────────────────── */

export function useTranslation() {
  const locale = useI18nStore(s => s.locale)
  const setLocale = useI18nStore(s => s.setLocale)
  return { t, locale, setLocale }
}

/* ── Available Locales ─────────────────────────────────── */

export const AVAILABLE_LOCALES: Array<{ code: Locale; name: string; nativeName: string }> = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文' },
]
