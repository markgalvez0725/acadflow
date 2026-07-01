import React from 'react'
import { useUI } from '@/context/UIContext'

// Cycles light → dark → frost. The icon previews the theme the click switches
// TO (moon while on light, snowflake while on dark, sun while on frost).
const NEXT = { light: 'dark', dark: 'frost', frost: 'light' }
const NEXT_LABEL = { light: 'dark', dark: 'frosted glass', frost: 'light' }

const SunIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
)
const MoonIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
)
const FrostIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="4.2" y1="7" x2="19.8" y2="17"/><line x1="19.8" y1="7" x2="4.2" y2="17"/><path d="M12 2l-2 3h4z" fill="currentColor" stroke="none"/><path d="M12 22l-2-3h4z" fill="currentColor" stroke="none"/></svg>
)
const NEXT_ICON = { dark: MoonIcon, frost: FrostIcon, light: SunIcon }

export default function ThemeToggle({ style }) {
  const { theme, toggleTheme } = useUI()
  const next = NEXT[theme] || 'dark'
  return (
    <button
      className="theme-btn"
      style={style}
      onClick={toggleTheme}
      title={`Switch to ${NEXT_LABEL[theme] || 'dark'} theme`}
      aria-label={`Switch to ${NEXT_LABEL[theme] || 'dark'} theme`}
    >
      {NEXT_ICON[next]}
    </button>
  )
}
