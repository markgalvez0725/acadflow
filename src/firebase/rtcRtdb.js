// ── In-app meeting signaling on Firebase REALTIME DATABASE ─────────────────
// Twin implementations of the rtcRooms signaling layer (participants, SDP/ICE
// signals, in-call chat, polls, question queue) on RTDB instead of Firestore.
// Why: RTDB's free tier meters BANDWIDTH, not operations - the heartbeat and
// signaling chatter that once billed tens of thousands of Firestore reads per
// class hour costs nothing here. The room data is byte-tiny and ephemeral.
//
// rtc.js dispatches here when the meeting doc carries `sig: 'rtdb'` (stamped
// by the professor's client at go-live, after rtcProbe() proved a real WRITE
// works - so a missing RTDB instance or unpublished rules automatically keep
// every room on the Firestore path). Semantics are IDENTICAL to the
// Firestore layer: same doc shapes, same heartbeat + stale-window eviction,
// same consume-and-delete signals - only the meter changes.
//
// Connections count against RTDB's 100-simultaneous free cap, so this module
// connects lazily and rtdbRelease() (MeetingRoom unmount / end-class cleanup)
// drops the socket once the room is done - only in-class devices ever hold one.
//
// Data layout:
//   rooms/{roomId}/participants/{peerId} - same fields as the Firestore doc
//   rooms/{roomId}/signals/{toPeerId}/{pushId} - {from, type, data, createdAt}
//   rooms/{roomId}/chat|polls|questions   - same shapes as Firestore
//   probe/{randomId}                       - write-probe scratch (self-deleting)

import {
  getDatabase, ref, get, set, update, remove, push, onValue, onChildAdded,
  goOnline, goOffline,
} from 'firebase/database'
import { getFbApp, getIdToken } from './firebaseInit'

let _rtdb = null
let _active = false

function rtdbUrl() {
  const env = String(import.meta.env.VITE_FB_DATABASE_URL || '').trim()
  if (env) return env.replace(/\/$/, '')
  const pid = getFbApp()?.options?.projectId
  // Default-instance URL for a US (us-central1) database. Other regions must
  // set VITE_FB_DATABASE_URL - the console shows the exact URL either way.
  return pid ? `https://${pid}-default-rtdb.firebaseio.com` : ''
}

function db() {
  if (_rtdb) { try { goOnline(_rtdb) } catch { /* already online */ } return _rtdb }
  const app = getFbApp()
  const url = rtdbUrl()
  if (!app || !url) return null
  try { _rtdb = getDatabase(app, url) } catch { return null }
  return _rtdb
}

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('RTDB timeout')), ms)),
  ])
}

/** Drop the socket once nothing needs it (MeetingRoom unmount, end-class).
 *  Delayed so a quick rejoin never races its own disconnect. */
export function rtdbRelease() {
  _active = false
  const d = _rtdb
  if (!d) return
  setTimeout(() => { if (!_active) { try { goOffline(d) } catch { /* fine */ } } }, 4000)
}

/** Can this deployment actually USE RTDB? Proven with a real write (the
 *  connection alone says nothing about rules). Cached for the session. */
let _probeP = null
export function rtcProbe() {
  if (_probeP) return _probeP
  _probeP = (async () => {
    try {
      const d = db()
      if (!d) return false
      const r = ref(d, 'probe/p' + Math.random().toString(36).slice(2, 10))
      await withTimeout(set(r, Date.now()), 5000)
      remove(r).catch(() => { /* scratch */ })
      return true
    } catch {
      return false
    } finally {
      if (!_active) rtdbRelease()
    }
  })()
  return _probeP
}

const pRef = (roomId, peerId) => ref(db(), `rooms/${roomId}/participants/${peerId}`)

// The SDK retries transport drops on its own, but a listener hit by a
// rules/auth DENIAL (e.g. a token refresh that failed during an outage,
// then a reconnect racing the new token) is cancelled PERMANENTLY - the
// same silent zombie-room hazard resilientSnapshot cures on the Firestore
// path. Same cure here: re-attach with backoff until truly unsubscribed.
function resilientOn(attach) {
  let off = null
  let timer = null
  let stopped = false
  let delay = 1000
  const go = () => {
    if (stopped) return
    off = attach(
      () => { delay = 1000 }, // data arrived - healthy again
      () => {                  // cancelled - re-attach with backoff
        try { if (off) off() } catch { /* already down */ }
        off = null
        if (stopped) return
        timer = setTimeout(go, delay)
        delay = Math.min(15000, delay * 2)
      },
    )
  }
  go()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    try { if (off) off() } catch { /* already down */ }
  }
}

export async function rtcFetchParticipants(roomId) {
  // One-shot REST read, NOT the SDK: the green room calls this while people
  // are still deciding whether to join, and REST requests don't count against
  // the 100-simultaneous-connection cap - the socket now opens only when
  // someone actually joins (rtcJoinRoom / the live listeners set _active).
  // Throws on failure like the SDK version did: the join-time cap check must
  // never mistake "fetch failed" for "room is empty".
  const base = rtdbUrl()
  if (!base) throw new Error('RTDB unavailable')
  const token = await getIdToken()
  const url = base + '/rooms/' + encodeURIComponent(roomId) + '/participants.json'
    + (token ? '?auth=' + encodeURIComponent(token) : '')
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = ctl ? setTimeout(() => ctl.abort(), 10000) : 0
  try {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined)
    if (!res.ok) throw new Error('participants fetch ' + res.status)
    const val = await res.json()
    return val && typeof val === 'object' ? Object.values(val) : []
  } finally {
    clearTimeout(t)
  }
}

export async function rtcJoinRoom(roomId, peer) {
  const data = {
    peerId: peer.peerId,
    uid: peer.uid || '',
    name: peer.name || 'Participant',
    role: peer.role || 'student',
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    micOn: peer.micOn !== false,
    camOn: peer.camOn !== false,
    sharing: false,
  }
  _active = true
  await withTimeout(set(pRef(roomId, peer.peerId), data))
  return data
}

export async function rtcUpdateParticipant(roomId, peerId, patch) {
  try {
    // Plain update, like the Firestore layer. RTDB's update() re-creates a
    // deleted node, so a swept ghost's queued heartbeat CAN briefly leave a
    // half-empty {lastSeen} doc - accepted: the engine's presence tick sees
    // its own doc lacks peerId and runs rejoin() (full set) within ~5s, and
    // a guard read here would be worse (an unbounded get() on the hottest
    // path can hang mid-reconnect and swallow heartbeats, getting a LIVE
    // student swept).
    await update(pRef(roomId, peerId), { lastSeen: Date.now(), ...patch })
    return true
  } catch { return false /* best-effort - may already be gone at teardown */ }
}

export async function rtcLeaveRoom(roomId, peerId) {
  try { await remove(pRef(roomId, peerId)) } catch { /* best-effort */ }
  // Drop any signals still addressed to this peer (one node holds them all).
  try { await remove(ref(db(), `rooms/${roomId}/signals/${peerId}`)) } catch { /* best-effort */ }
}

// Tab-is-dying delete via the RTDB REST endpoint (keepalive fetch survives
// page teardown, the SDK's WebChannel does not).
export function rtcLeaveBeacon(roomId, peerId, idToken) {
  try {
    const base = rtdbUrl()
    if (!base || typeof fetch === 'undefined') return
    const url = base + '/rooms/' + encodeURIComponent(roomId)
      + '/participants/' + encodeURIComponent(peerId) + '.json'
      + (idToken ? '?auth=' + encodeURIComponent(idToken) : '')
    fetch(url, { method: 'DELETE', keepalive: true }).catch(() => { /* best-effort */ })
  } catch { /* best-effort */ }
}

export async function rtcSendSignal(roomId, { to, from, type, data }) {
  const payload = { to, from, type, data: JSON.stringify(data), createdAt: Date.now() }
  let lastErr = null
  for (let i = 0; i < 3; i++) {
    try { return await withTimeout(push(ref(db(), `rooms/${roomId}/signals/${to}`), payload)) }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 400 * (i + 1))) }
  }
  throw lastErr
}

export function rtcListenParticipants(roomId, cb) {
  const d = db()
  if (!d) return () => {}
  _active = true
  return resilientOn((onData, onErr) => onValue(
    ref(d, `rooms/${roomId}/participants`),
    snap => { onData(); cb(Object.values(snap.val() || {})) },
    onErr,
  ))
}

// Signals addressed to me: children arrive in push-key (chronological) order,
// are processed serially, and each is deleted right after its handler resolves
// - the same consume-exactly-once contract as the Firestore layer.
export function rtcListenSignals(roomId, peerId, handler) {
  const d = db()
  if (!d) return () => {}
  _active = true
  // The chain outlives re-attaches; consumed signals were deleted, so a
  // re-attach re-delivers only unconsumed ones - nothing double-processes.
  let chain = Promise.resolve()
  return resilientOn((onData, onErr) => onChildAdded(
    ref(d, `rooms/${roomId}/signals/${peerId}`),
    snap => {
      onData()
      const msg = snap.val()
      if (!msg) return
      chain = chain
        .then(() => handler({ ...msg, data: JSON.parse(msg.data) }))
        .catch(() => {})
        .then(() => remove(snap.ref))
        .catch(() => {})
    },
    onErr,
  ))
}

// ── In-call chat ────────────────────────────────────────────────────────────
export async function rtcSendChat(roomId, msg) {
  await withTimeout(push(ref(db(), `rooms/${roomId}/chat`), {
    at: Date.now(),
    uid: msg.uid || '',
    name: msg.name || 'Participant',
    role: msg.role || 'student',
    text: String(msg.text || '').slice(0, 500),
  }))
}

export function rtcListenChat(roomId, cb) {
  const d = db()
  if (!d) return () => {}
  _active = true
  return resilientOn((onData, onErr) => onValue(ref(d, `rooms/${roomId}/chat`), snap => {
    onData()
    const val = snap.val() || {}
    cb(Object.keys(val)
      .map(k => ({ id: k, ...val[k] }))
      .sort((a, b) => (a.at || 0) - (b.at || 0)))
  }, onErr))
}

// ── Quick poll ───────────────────────────────────────────────────────────────
export async function rtcSetPoll(roomId, poll) {
  await withTimeout(set(ref(db(), `rooms/${roomId}/polls/current`), {
    id: poll.id,
    q: String(poll.q || '').slice(0, 140),
    opts: (poll.opts || []).slice(0, 4).map(o => String(o).slice(0, 40)),
    at: Date.now(),
    endsAt: poll.endsAt || 0,
    closed: false,
    // NOTE: no `votes: {}` seed - RTDB prunes empty objects; the listener
    // below re-normalizes so consumers always see a votes map.
  }))
}

export async function rtcVotePoll(roomId, uid, idx) {
  if (!uid) return
  // Only vote on a poll that still exists - a bare vote write would
  // re-create an orphan poll node with no question (RTDB update-creates).
  const cur = await withTimeout(get(ref(db(), `rooms/${roomId}/polls/current`)))
  if (!cur.exists()) return
  await withTimeout(set(ref(db(), `rooms/${roomId}/polls/current/votes/${uid}`), idx))
}

export async function rtcClosePoll(roomId) {
  await withTimeout(update(ref(db(), `rooms/${roomId}/polls/current`), { closed: true }))
}

export function rtcListenPoll(roomId, cb) {
  const d = db()
  if (!d) return () => {}
  _active = true
  return resilientOn((onData, onErr) => onValue(ref(d, `rooms/${roomId}/polls/current`), snap => {
    onData()
    const v = snap.val()
    // Require an id: an orphan node (votes-only leftovers) renders as no poll.
    cb(v && v.id ? { ...v, opts: v.opts || [], votes: v.votes || {} } : null)
  }, onErr))
}

// ── Question queue ───────────────────────────────────────────────────────────
export async function rtcAskQuestion(roomId, { uid, name, text, anon }) {
  await withTimeout(push(ref(db(), `rooms/${roomId}/questions`), {
    at: Date.now(),
    uid: uid || '',
    name: anon ? '' : (name || 'Student'),
    anon: !!anon,
    text: String(text || '').slice(0, 200),
    answered: false,
  }))
}

export async function rtcPlusQuestion(roomId, qId, uid) {
  if (!uid) return
  // Same orphan guard: +1 only lands on a question that still exists.
  const q = await withTimeout(get(ref(db(), `rooms/${roomId}/questions/${qId}`)))
  if (!q.exists()) return
  await withTimeout(set(ref(db(), `rooms/${roomId}/questions/${qId}/plus/${uid}`), 1))
}

export async function rtcAnswerQuestion(roomId, qId) {
  await withTimeout(update(ref(db(), `rooms/${roomId}/questions/${qId}`), { answered: true }))
}

export async function rtcDeleteQuestion(roomId, qId) {
  await withTimeout(remove(ref(db(), `rooms/${roomId}/questions/${qId}`)))
}

export function rtcListenQuestions(roomId, cb) {
  const d = db()
  if (!d) return () => {}
  _active = true
  return resilientOn((onData, onErr) => onValue(ref(d, `rooms/${roomId}/questions`), snap => {
    onData()
    const val = snap.val() || {}
    cb(Object.keys(val)
      .map(k => ({ id: k, plus: {}, ...val[k] }))
      .filter(q => q.text)) // drop orphan leftovers (answered/plus-only nodes)
  }, onErr))
}

// One call removes the whole room subtree (participants, signals, chat,
// polls, questions) - the RTDB equivalent of the Firestore batch purge.
export async function rtcCleanupRoom(roomId) {
  try {
    const d = db()
    if (!d) return
    await withTimeout(remove(ref(d, `rooms/${roomId}`)))
  } catch { /* best-effort */ }
  finally { if (!_active) rtdbRelease() }
}
