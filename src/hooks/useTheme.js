import { useContext } from 'react'
import { UIContext } from '@/context/UIContext'

/**
 * Consumer hook for theme state.
 * Core logic lives in UIContext — this adds the `isDark` convenience boolean.
 */
export function useTheme() {
  const { theme, toggleTheme } = useContext(UIContext)
  return { theme, toggleTheme, isDark: theme === 'dark' }
}
