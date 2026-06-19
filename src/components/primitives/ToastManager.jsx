import React, { useEffect, useState } from 'react'
import { useUI } from '@/context/UIContext'

const TYPE_CLASS = {
  dark:   'toast-dark',
  green:  'toast-green',
  red:    'toast-red',
  blue:   'toast-blue',
  yellow: 'toast-yellow',
  purple: 'toast-purple',
}

function ToastItem({ id, msg, type, duration, onDismiss }) {
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
      style={{ '--toast-dur': duration / 1000 + 's' }}
      onClick={() => onDismiss(id)}
    >
      {msg}
    </div>
  )
}

export default function ToastManager() {
  const { toastQueue, dismissToast } = useUI()

  if (!toastQueue.length) return null

  // Render only the most recent toast (queue stacks, oldest auto-dismissed)
  const t = toastQueue[toastQueue.length - 1]
  return (
    <ToastItem
      key={t.id}
      {...t}
      onDismiss={dismissToast}
    />
  )
}
