// ── Web Push via Firebase Cloud Messaging (client) ────────────────────────
// Fully optional and self-gating: if the browser doesn't support push, the
// user denies permission, or no VAPID key is configured, every function here
// resolves to a harmless no-op. Nothing in the existing app depends on it.
import { getApp } from 'firebase/app'
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging'
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

  // Reuse the already-registered offline service worker so we don't register
  // a second worker for the same scope.
  let swReg = getSWRegistration()
  if (!swReg && 'serviceWorker' in navigator) {
    try { swReg = await navigator.serviceWorker.ready } catch { swReg = undefined }
  }

  const opts = {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: swReg || undefined,
  }

  _lastError = ''
  try {
    const token = await getToken(messaging, opts)
    return token || null
  } catch (e) {
    // The most common failure after rotating/changing the VAPID key is a
    // "push service error": the service worker still holds a push subscription
    // created with the OLD applicationServerKey, and the push service refuses
    // to re-subscribe with the new key. Clearing the stale subscription and
    // retrying once resolves it. (Harmless if there is no subscription.)
    console.warn('[push] getToken failed, clearing stale subscription and retrying:', e?.message)
    try {
      if (swReg?.pushManager) {
        const sub = await swReg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
      }
      const token = await getToken(messaging, opts)
      return token || null
    } catch (e2) {
      _lastError = e2?.message || e?.message || 'Push registration failed.'
      console.warn('[push] getToken failed after retry:', _lastError)
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
