'use client'

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'bw-antecipa-theme'

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const themeEventName = 'bw-antecipa-theme-change'

function getThemeFromDocument(): Theme {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function subscribeToTheme(callback: () => void) {
  window.addEventListener(themeEventName, callback)
  return () => window.removeEventListener(themeEventName, callback)
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  root.style.colorScheme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore<Theme>(subscribeToTheme, getThemeFromDocument, (): Theme => 'light')

  const setTheme = useCallback((nextTheme: Theme) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    applyTheme(nextTheme)
    window.dispatchEvent(new Event(themeEventName))
  }, [])

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  }), [setTheme, theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme deve ser usado dentro de ThemeProvider')
  return context
}
