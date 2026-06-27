// ── useOnlineStatus ───────────────────────────────────────────────────────
// Tracks browser connectivity. Pairs with Firestore's offline cache: when
// offline, reads come from cache and writes are queued, then flushed on
// reconnect - this hook just surfaces that state to the UI.
import { useState, useEffect } from 'react'

export function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
