/**
 * Theme hooks for responsive theme management.
 */

import { useEffect, useState, useCallback } from 'react'
import { useThemeStore } from '@/store/theme'

/** Hook: detect system dark/light preference */
export function useSystemTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return theme
}

/** Hook: detect if user prefers reduced motion */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}

/** Hook: detect high contrast mode */
export function useHighContrast(): boolean {
  const [hc, setHc] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-contrast: more)').matches
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-contrast: more)')
    const handler = (e: MediaQueryListEvent) => setHc(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return hc
}

/** Hook: get CSS variable value from current theme */
export function useCssVariable(variable: string): string {
  const [value, setValue] = useState('')
  const activeTheme = useThemeStore(s => s.activeTheme)

  useEffect(() => {
    const computed = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
    setValue(computed)
  }, [variable, activeTheme])

  return value
}

/** Hook: apply a temporary theme preview (restores on unmount) */
export function useThemePreview() {
  const previewTheme = useThemeStore(s => s.previewTheme)

  const startPreview = useCallback((themeId: string) => {
    previewTheme(themeId)
  }, [previewTheme])

  const stopPreview = useCallback(() => {
    previewTheme(null)
  }, [previewTheme])

  useEffect(() => {
    return () => { previewTheme(null) }
  }, [previewTheme])

  return { startPreview, stopPreview }
}
