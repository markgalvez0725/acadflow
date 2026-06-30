import React, { useEffect, useRef } from 'react'
import { useConnectionQuality } from '@/hooks/useConnectionQuality'
import { useUI } from '@/context/UIContext'
import { WifiOff, Activity, AlertTriangle } from 'lucide-react'

// Surfaces live connection quality to both the professor and the student.
// Beyond a hard disconnect it also flags a slow/poor link and an unstable one
// that keeps dropping - Firestore keeps serving cached data and queues writes
// throughout, so the messaging stays reassuring, not alarming.
const PILLS = {
  slow:     { label: 'Slow connection', Icon: Activity,      bg: 'var(--yellow-l)', fg: 'var(--gold-var)', bd: 'var(--yellow)' },
  unstable: { label: 'Unstable',        Icon: AlertTriangle, bg: 'var(--yellow-l)', fg: 'var(--gold-var)', bd: 'var(--yellow)' },
  offline:  { label: 'Offline',         Icon: WifiOff,       bg: 'var(--red-l)',    fg: 'var(--red)',      bd: 'var(--red)'    },
}

const TOASTS = {
  slow:     ['Slow connection. The app may load slowly, but your work is still being saved.', 'warn', 5000],
  unstable: ['Your connection keeps dropping. Changes are saved and will sync once it is stable.', 'warn', 5000],
  offline:  ['You are offline. Changes will sync when you reconnect.', 'warn', 5000],
}

export default function ConnectionStatus({ compact = false }) {
  const status = useConnectionQuality() // 'good' | 'slow' | 'unstable' | 'offline'
  const { toast } = useUI()
  const prev = useRef(status)

  useEffect(() => {
    if (status === prev.current) return
    const was = prev.current
    prev.current = status
    if (status === 'good') {
      // Only celebrate a recovery, not the initial healthy mount.
      if (was !== 'good') toast?.('Connection restored. Syncing your changes.', 'success', 3000)
      return
    }
    const t = TOASTS[status]
    if (t) toast?.(t[0], t[1], t[2])
  }, [status, toast])

  if (status === 'good') return null
  const pill = PILLS[status]
  if (!pill) return null
  const { label, Icon, bg, fg, bd } = pill

  // The label collapses to an icon-only pill on narrow widths via `.conn-label`
  // (see globals.css); `compact` forces icon-only on every width.
  return (
    <span
      className="conn-pill"
      title={TOASTS[status]?.[0]}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 28, padding: '0 10px', borderRadius: 999,
        background: bg, color: fg, border: `1px solid ${bd}`,
        fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <Icon size={13} />
      {!compact && <span className="conn-label">{label}</span>}
    </span>
  )
}
