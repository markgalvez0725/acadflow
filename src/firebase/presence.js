// ── RTDB access for Who's online presence ──────────────────────────────────
// One node per user at `presence/{userId}` on the Realtime Database, whole-node
// replaced by that user's own device on a slow heartbeat (the localStorage
// accumulator is the truth). Only the professor reads the branch back, one-shot,
// from the System reports tab.
//
// Deliberately NOT Firestore and NOT the RTDB SDK:
// - Firestore bills per operation; presence writes from every active device plus
//   the admin's whole-collection polls were quota the app can't spare, and a
//   quota outage made Who's online show everyone offline mid-class.
// - The RTDB SDK holds a websocket, and simultaneous connections are the one
//   RTDB free-tier limit meetings actually budget against (100). Plain REST
//   requests don't count as connections and are billed only by bandwidth.
// Callers keep passing `db` (Firestore) for signature stability; it is unused.

import { getFbApp, getIdToken } from './firebaseInit'

// Same resolution as rtcRtdb.js rtdbUrl(); duplicated so this file stays free
// of the firebase/database SDK (utils/presence.js sits in the main bundle).
function rtdbUrl() {
  const env = String(import.meta.env.VITE_FB_DATABASE_URL || '').trim()
  if (env) return env.replace(/\/$/, '')
  const pid = getFbApp()?.options?.projectId
  return pid ? `https://${pid}-default-rtdb.firebaseio.com` : ''
}

async function nodeUrl(uid) {
  const base = rtdbUrl()
  if (!base) return ''
  const token = await getIdToken()
  if (!token) return ''
  const path = uid ? '/presence/' + encodeURIComponent(uid) : '/presence'
  return base + path + '.json?auth=' + encodeURIComponent(token)
}

export async function fbSavePresence(db, uid, data) {
  if (!uid || !data) return
  const url = await nodeUrl(uid)
  if (!url) return
  // keepalive so pagehide/visibility flushes survive tab teardown.
  const res = await fetch(url, { method: 'PUT', keepalive: true, body: JSON.stringify(data) })
  if (!res.ok) throw new Error('presence save ' + res.status)
}

/** Admin-side one-shot fetch of every presence node. */
export async function fbFetchPresence(db) {
  try {
    const url = await nodeUrl('')
    if (!url) return []
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = ctl ? setTimeout(() => ctl.abort(), 10000) : 0
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined)
    clearTimeout(t)
    if (!res.ok) return []
    const map = await res.json()
    if (!map || typeof map !== 'object') return []
    return Object.keys(map).map(id => ({ id, ...map[id] }))
  } catch {
    return []
  }
}

/** Cascade-delete hook: drop a purged student's presence node. Best-effort. */
export async function fbDeletePresence(db, uid) {
  if (!uid) return
  try {
    const url = await nodeUrl(uid)
    if (url) await fetch(url, { method: 'DELETE' })
  } catch { /* best-effort */ }
}
