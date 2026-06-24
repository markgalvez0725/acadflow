import React, { useEffect, useState } from 'react'
import { useUI } from '@/context/UIContext'

const TYPE_CLASS = {
  dark:    'toast-dark',
  green:   'toast-green',
  red:     'toast-red',
  blue:    'toast-blue',
  yellow:  'toast-yellow',
  purple:  'toast-purple',
  // Semantic aliases — UIContext normalizes these, but map them here too so a
  // raw type never falls through to an unstyled toast.
  success: 'toast-green',
  error:   'toast-red',
  danger:  'toast-red',
  warn:    'toast-yellow',
  warning: 'toast-yellow',
  info:    'toast-blue',
}
const ASSERTIVE_TYPES = new Set(['red', 'error', 'danger'])

function ToastItem({ id, msg, type, duration, action, onDismiss }) {
  const [state, setState] = useState('') // '' | 'show' | 'dying'

  useEffect(() => {
    // Trigger show on next tick so CSS transition fires
    const t1 = setTimeout(() => setState('show'), 16)
    // Start dying phase slightly before dismiss so animation finishes
    const t2 = setTimeout(() => setState('dying'), duration - 400)
    const t3 = setTimeout(() => onDismiss(id), duration)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  const cls = ['toast', TYPE_CLASS[type] || 'toast-dark', state].filter(Boolean).join(' ')

  return (
    <div
      className={cls}
      style={{ '--toast-dur': duration / 1000 + 's', ...(action ? { display: 'flex', alignItems: 'center', gap: 12 } : null) }}
      onClick={() => { if (!action) onDismiss(id) }}
    >
      <span>{msg}</span>
      {action && (
        <button
          type="button"
          className="toast-action-btn"
          onClick={(e) => { e.stopPropagation(); try { action.onAction?.() } finally { onDismiss(id) } }}
        >
          {action.label || 'Undo'}
        </button>
      )}
    </div>
  )
}

export default function ToastManager() {
  const { toastQueue, dismissToast } = useUI()

  // Render only the most recent toast (queue stacks, oldest auto-dismissed).
  const t = toastQueue.length ? toastQueue[toastQueue.length - 1] : null

  // The live-region wrapper is always mounted (even when empty) so assistive
  // tech reliably announces toasts as they appear. Errors interrupt (assertive);
  // everything else is announced politely. The wrapper has no layout/size of its
  // own — the toast itself is position:fixed, so the region stays invisible.
  return (
    <div role="status" aria-live={t && ASSERTIVE_TYPES.has(t.type) ? 'assertive' : 'polite'} aria-atomic="true">
      {t && <ToastItem key={t.id} {...t} onDismiss={dismissToast} />}
    </div>
  )
}
