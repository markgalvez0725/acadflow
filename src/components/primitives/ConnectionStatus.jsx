import React, { useEffect, useRef } from 'react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useUI } from '@/context/UIContext'
import { WifiOff } from 'lucide-react'

// Shows an "Offline" pill while disconnected and toasts on each transition.
// Firestore keeps serving cached data and queues writes in the meantime.
export default function ConnectionStatus({ compact = false }) {
  const online = useOnlineStatus()
  const { toast } = useUI()
  const firstRun = useRef(true)

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (online) toast?.('Back online. Syncing your changes…', 'success', 3000)
    else toast?.('You are offline. Changes will sync when you reconnect.', 'warn', 5000)
  }, [online, toast])

  if (online) return null

  return (
    <span
      title="You are offline. Your changes are saved and will sync when you reconnect."
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 28, padding: compact ? '0 8px' : '0 10px', borderRadius: 999,
        background: 'var(--yellow-l)', color: 'var(--gold-var)',
        border: '1px solid var(--yellow)', fontSize: 12, fontWeight: 600,
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <WifiOff size={13} />
      {!compact && 'Offline'}
    </span>
  )
}
