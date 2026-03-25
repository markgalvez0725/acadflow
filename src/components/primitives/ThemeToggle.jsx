import React from 'react'
import { useUI } from '@/context/UIContext'

export default function ThemeToggle({ style }) {
  const { theme, toggleTheme } = useUI()
  return (
    <button
      className="theme-btn"
      style={style}
      onClick={toggleTheme}
      title="Toggle theme"
      aria-label="Toggle dark/light mode"
    >
      {theme === 'dark' ? '🌙' : '☀️'}
    </button>
  )
}
