import React from 'react'
import { Search } from 'lucide-react'

// Small launcher that opens the global command palette. Detects platform for
// the right modifier glyph. Hidden label on very small screens (icon only).
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

export default function CommandPaletteButton({ compact = false }) {
  const open = () => window.dispatchEvent(new Event('acadflow:open-command'))
  return (
    <button
      onClick={open}
      title="Search & quick navigation (Ctrl/⌘ + K)"
      aria-label="Open command palette"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        height: 32, padding: compact ? '0 8px' : '0 10px',
        borderRadius: 9, cursor: 'pointer',
        background: 'var(--surface2)', border: '1px solid var(--border)',
        color: 'var(--ink3)', fontSize: 12.5, fontFamily: 'var(--font-body)',
      }}
    >
      <Search size={14} />
      {!compact && <span className="hidden lg:inline">Search</span>}
      {!compact && (
        <span className="hidden lg:inline" style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, padding: '1px 5px',
          borderRadius: 5, background: 'var(--surface)', border: '1px solid var(--border)',
        }}>
          {isMac ? '⌘K' : 'Ctrl K'}
        </span>
      )}
    </button>
  )
}
