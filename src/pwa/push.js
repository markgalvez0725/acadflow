// ── Web Push via Firebase Cloud Messaging (client) ────────────────────────
// Fully optional and self-gating: if the browser doesn't support push, the
// user denies permission, or no VAPID key is configured, every function here
// resolves to a harmless no-op. Nothing in the existing app depends on it.
import { getApp } from 'firebase/app'
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from 'firebase/messaging'
import { getSWRegistration } from './registerSW'

// Web Push certificate ("VAPID key") from Firebase Console →
// Project settings → Cloud Messaging → Web Push certificates.
// Set VITE_FB_VAPID_KEY in your .env, or window.__ACADFLOW_VAPID__ at runtime.
export const VAPID_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FB_VAPID_KEY) ||
  (typeof window !== 'undefined' && window.__ACADFLOW_VAPID__) ||
  ''

let _messaging = null
let _lastError = ''

/** Last human-readable push error, for surfacing in the UI. */
export function lastPushError() { return _lastError }

// Turn a raw FCM/PushManager error into something a student can act on.
function friendlyPushError(e) {
  const m = (e && e.message) || ''
  if (/push service error|Registration failed|AbortError/i.test(m)) {
    return 'Your browser couldn’t register for push notifications. Close and reopen AcadFlow and try again — some browsers and in-app/private windows don’t support web push.'
  }
  if (/permission/i.test(m)) return 'Notifications are blocked. Enable them in your browser settings.'
  return m || 'Push registration failed.'
}

export async function pushSupported() {
  try {
    if (typeof window === 'undefined') return false
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return false
    return await isSupported()
  } catch { return false }
}

export function pushPermission() {
  return (typeof Notification !== 'undefined') ? Notification.permission : 'denied'
}

function getMessagingInstance() {
  if (_messaging) return _messaging
  try {
    _messaging = getMessaging(getApp('cp'))
  } catch {
    _messaging = null
  }
  return _messaging
}

/**
 * Ask for notification permission and fetch an FCM registration token.
 * @returns {Promise<string|null>} the token, or null if unavailable/denied.
 */
export async function enablePush() {
  if (!(await pushSupported())) return null
  if (!VAPID_KEY) {
    console.warn('[push] No VAPID key configured — set VITE_FB_VAPID_KEY to enable web push.')
    return null
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const messaging = getMessagingInstance()
  if (!messaging) return null

  // Reuse the already-registered offline service worker (root scope) so we
  // don't register a second worker. Prefer the *ready* (activated) registration
  // — getToken fails if the worker isn't active yet.
  let swReg
  if ('serviceWorker' in navigator) {
    try { swReg = await navigator.serviceWorker.ready } catch { swReg = undefined }
  }
  if (!swReg) swReg = getSWRegistration() || undefined

  const opts = {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: swReg || undefined,
  }

  _lastError = ''
  try {
    const token = await getToken(messaging, opts)
    return token || null
  } catch (e) {
    // The most common failure after rotating/changing the VAPID key (or after a
    // browser update) is a "push service error": the worker still holds a push
    // subscription created with the OLD applicationServerKey AND FCM caches the
    // stale token, so re-subscribing with the new key is refused. Clear BOTH —
    // FCM's cached token and the browser subscription — then retry once.
    console.warn('[push] getToken failed, clearing stale registration and retrying:', e?.message)
    try { await deleteToken(messaging) } catch (e2) { /* no cached token — fine */ }
    try {
      if (swReg?.pushManager) {
        const sub = await swReg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
      }
    } catch (e3) { /* nothing to clear — fine */ }
    try {
      const token = await getToken(messaging, opts)
      return token || null
    } catch (e4) {
      _lastError = friendlyPushError(e4 || e)
      console.warn('[push] getToken failed after retry:', e4?.message || e?.message)
      return null
    }
  }
}

/**
 * Listen for foreground messages (tab focused). Returns an unsubscribe fn.
 * @param {(payload:any)=>void} handler
 */
export function onForegroundPush(handler) {
  const messaging = getMessagingInstance()
  if (!messaging) return () => {}
  try {
    return onMessage(messaging, handler)
  } catch {
    return () => {}
  }
}
