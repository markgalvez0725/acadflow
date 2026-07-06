// ── Who's online presence + activity trail ────────────────────────────────
// Each signed-in device keeps ONE small doc alive at `presence/{userId}`:
// a heartbeat timestamp (drives the online/offline dot on the professor's
// System reports tab), the tab the user is on right now, and a short
// breadcrumb trail of this session's actions (signed in, opened a tab,
// submitted an activity, took a quiz, joined/left a class, sent a message,
// commented). The trail is event NAMES only - never content or keystrokes -
// and only the professor can read it back (Firestore rules).
//
// Cost model mirrors telemetry.js: the trail accumulates in localStorage and
// flushes as one whole-doc setDoc on a ~4 minute heartbeat, on tab-hide, and
// shortly after a meaningful event. Every public fn is try/catch walled so
// presence can never break the app.

import { fbSavePresence } from '@/firebase/presence'

const BUF_KEY = 'acadflow_pres'
const TRAIL_CAP = 12
const HEARTBEAT_MS = 240000

let _getDb = null
let _uid = null
let _role = null
let _dirty = false
let _flushTimer = 0
let _beatTimer = 0
let _listenersOn = false

function loadBuf() {
  try {
    const buf = JSON.parse(localStorage.getItem(BUF_KEY) || 'null')
    return buf && typeof buf === 'object' ? buf : null
  } catch { return null }
}

function storeBuf(buf) {
  try { localStorage.setItem(BUF_KEY, JSON.stringify(buf)) } catch { /* full - memory only */ }
}

function mutate(fn) {
  if (!_uid) return
  const buf = loadBuf() || {}
  fn(buf)
  buf.at = Date.now()
  storeBuf(buf)
  _dirty = true
}

function pushTrail(buf, kind, text) {
  const entry = { k: String(kind || '').slice(0, 12), t: String(text || '').slice(0, 90), at: Date.now() }
  buf.trail = [...(buf.trail || []), entry].slice(-TRAIL_CAP)
}

function scheduleFlush(ms) {
  if (_flushTimer) return
  _flushTimer = setTimeout(() => { _flushTimer = 0; flush() }, ms)
}

async function flush() {
  if (!_uid || !_dirty) return
  const db = _getDb ? _getDb() : null
  if (!db) return
  const buf = loadBuf()
  if (!buf || buf.uid !== _uid) return
  try {
    buf.call = !!window.__acadflowInCall
    await fbSavePresence(db, _uid, buf)
    _dirty = false
  } catch { /* offline or rules not published yet - keep buffering */ }
}

/** Start (or resume) this user's presence session. `fresh` is true on a real
 *  login, false when an existing session is restored after a reload. */
export function presStart(role, uid, { fresh = false, since = 0 } = {}) {
  try {
    if (typeof window === 'undefined' || !role || !uid) return
    _role = role
    _uid = String(uid).slice(0, 80)
    const now = Date.now()
    const prev = loadBuf()
    const sameSession = !fresh && prev && prev.uid === _uid
    const tabKey = (() => {
      try { return localStorage.getItem(role === 'admin' ? 'acadflow_admin_tab' : 'acadflow_student_tab') || '' } catch { return '' }
    })()
    const buf = sameSession ? prev : {
      uid: _uid,
      role,
      since: since || now,
      trail: [],
      tab: '',
      tabAt: now,
      out: 0,
    }
    buf.role = role
    buf.out = 0
    buf.ua = String(navigator.userAgent || '').slice(0, 120)
    if (fresh) pushTrail(buf, 'login', 'Signed in')
    if (tabKey && buf.tab !== tabKey) { buf.tab = tabKey; buf.tabAt = now }
    storeBuf(buf)
    _dirty = true
    scheduleFlush(6000)

    if (!_beatTimer) {
      _beatTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return
        mutate(() => { /* refresh `at` */ })
        flush()
      }, HEARTBEAT_MS)
    }
    if (!_listenersOn) {
      _listenersOn = true
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush()
        else { mutate(() => { /* back - refresh `at` */ }); scheduleFlush(4000) }
      })
      window.addEventListener('pagehide', () => flush())
    }
  } catch { /* presence never breaks the app */ }
}

/** Record a tab change. `side` guards against the other role's tab state. */
export function presTab(side, tabKey) {
  try {
    if (!_uid || side !== _role || !tabKey) return
    const buf = loadBuf()
    if (buf && buf.tab === tabKey) return
    mutate(b => {
      b.tab = String(tabKey).slice(0, 30)
      b.tabAt = Date.now()
      const last = (b.trail || [])[b.trail?.length - 1]
      if (!last || last.k !== 'tab' || last.t !== b.tab) pushTrail(b, 'tab', b.tab)
    })
    scheduleFlush(10000)
  } catch { /* nicety */ }
}

/** Breadcrumb for a meaningful action: 'submit' | 'quiz' | 'join' | 'leave'
 *  | 'msg' | 'comment'. Text is a short human phrase, never content. */
export function presEvent(kind, text) {
  try {
    if (!_uid) return
    mutate(buf => pushTrail(buf, kind, text))
    scheduleFlush(4000)
  } catch { /* nicety */ }
}

/** Logout: stamp the session closed and push one final flush. */
export function presStop() {
  try {
    if (!_uid) return
    mutate(buf => { buf.out = Date.now() })
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = 0 }
    flush()
    _uid = null
    _role = null
  } catch { /* nicety */ }
}

/** DataContext hands over a live db getter once Firebase is up. */
export function presAttach(getDb) {
  _getDb = getDb
  if (_dirty) scheduleFlush(8000)
}
