// ── usePushNotifications ──────────────────────────────────────────────────
// Thin React wrapper around the FCM client. Wires foreground messages to a
// toast and (re)saves the registration token. Degrades to a no-op when push
// is unsupported or unconfigured.
import { useState, useEffect, useCallback, useRef } from 'react'
import { pushSupported, pushPermission, enablePush, onForegroundPush, lastPushError, VAPID_KEY } from '@/pwa/push'
import { fbSavePushToken } from '@/firebase/pushTokens'

export function usePushNotifications({ db, fbReady, ownerId, role = 'student', toast } = {}) {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')
  const [busy, setBusy] = useState(false)
  const wiredRef = useRef(false)

  useEffect(() => {
    let alive = true
    pushSupported().then((ok) => { if (alive) setSupported(ok && !!VAPID_KEY) })
    return () => { alive = false }
  }, [])

  // Wire foreground listener once and refresh token if already granted.
  useEffect(() => {
    if (wiredRef.current) return
    if (!fbReady || !db?.current) return
    if (!supported) return
    wiredRef.current = true

    const unsub = onForegroundPush((payload) => {
      const n = payload?.notification || payload?.data || {}
      if (n.title || n.body) toast?.(`${n.title ? n.title + ': ' : ''}${n.body || ''}`.trim(), 'info', 6000)
    })

    if (pushPermission() === 'granted') {
      enablePush().then((token) => {
        if (token) fbSavePushToken(db.current, token, ownerId, role)
      })
    }
    return () => { try { unsub() } catch {} }
  }, [supported, fbReady, db, ownerId, role, toast])

  const enable = useCallback(async () => {
    setBusy(true)
    try {
      const token = await enablePush()
      setPermission(pushPermission())
      if (token && db?.current) {
        await fbSavePushToken(db.current, token, ownerId, role)
        toast?.('Push notifications enabled on this device.', 'success')
        return true
      }
      if (pushPermission() === 'denied') {
        toast?.('Notifications are blocked. Enable them in your browser settings.', 'error', 6000)
      } else if (!VAPID_KEY) {
        toast?.('Push is not configured yet (missing VAPID key).', 'warn', 6000)
      } else if (lastPushError()) {
        toast?.('Could not enable push: ' + lastPushError(), 'error', 7000)
      }
      return false
    } finally {
      setBusy(false)
    }
  }, [db, ownerId, role, toast])

  return { supported, permission, busy, enable }
}
