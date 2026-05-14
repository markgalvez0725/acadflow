import { useUI } from '@/context/UIContext'

/**
 * Consumer hook for theme state.
 * Core logic lives in UIContext — this adds the `isDark` convenience boolean.
 */
export function useTheme() {
  const { theme, toggleTheme } = useUI()
  return { theme, toggleTheme, isDark: theme === 'dark' }
}
