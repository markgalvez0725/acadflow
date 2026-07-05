// ── In-app meeting rooms: Firestore WebRTC signaling ───────────────────────
// AcadFlow's self-owned video classroom. The media itself flows peer-to-peer
// over WebRTC (no third-party video service, $0); Firestore is used ONLY as
// the signaling channel that lets browsers find each other:
//
//   rtcRooms/{meetingId}/participants/{peerId}
//     { peerId, uid, name, role, joinedAt, lastSeen, micOn, camOn, sharing }
//   rtcRooms/{meetingId}/signals/{autoId}
//     { to, from, type: 'offer'|'answer'|'ice', data (JSON string), createdAt }
//
// Everything here is EPHEMERAL: participants delete their docs on leave, each
// signal doc is deleted by its addressee right after it is consumed, and the
// professor's End-class purges whatever stragglers remain. rtcRooms is NOT in
// the global listeners.js set on purpose - only useMeetingRoom attaches these
// scoped listeners, and only while a room is actually open.
//
// NOTE (rules): rtcRooms/{document=**} must be signed-in read/write in
// firestore.rules - students write their own participant + signal docs here,
// unlike onlineMeetings which stays teacher-only.

import {
  doc, setDoc, deleteDoc, updateDoc, addDoc, getDocs,
  collection, query, where, onSnapshot, writeBatch,
} from 'firebase/firestore'
import { fbWithTimeout } from './firebaseInit'

// Mesh topology: every participant uploads their stream to every other one,
// so bandwidth grows with the head count. The room holds a full class (60,
// professor included) by behaving like a lecture hall past BIG_ROOM people:
// students join muted with camera off (they can turn either on to speak),
// and useMeetingRoom scales everyone's outgoing video down as the room
// grows so voice always has bandwidth headroom.
export const ROOM_CAP = 60
export const BIG_ROOM = 12

// Free public STUN (connectivity discovery) plus a free public TURN relay
// (Open Relay) as the LAST-RESORT media path. STUN-only meant a student
// behind carrier-grade NAT - most mobile-data connections - could never
// form a direct pair with anyone: their tile just cycled "Reconnecting"
// forever, which read as "students keep disconnecting". ICE always prefers
// direct host/srflx routes and only falls back to the relay when no direct
// path exists, so the relay costs nothing for the pairs that never needed
// it. A school-owned TURN can replace the public one via env, no code
// change: VITE_TURN_URLS (comma-separated) + VITE_TURN_USER + VITE_TURN_PASS.
const ENV_TURN = String(import.meta.env.VITE_TURN_URLS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const TURN_SERVER = ENV_TURN.length
  ? {
      urls: ENV_TURN,
      username: import.meta.env.VITE_TURN_USER || '',
      credential: import.meta.env.VITE_TURN_PASS || '',
    }
  : {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        // TLS on 443: traverses firewalls that only pass real HTTPS.
        'turns:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    }
export const RTC_CONFIG = {
  iceServers: [
    // Two independent STUN operators: one being unreachable never blocks
    // discovery.
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    TURN_SERVER,
  ],
  // Pre-gathered candidate pool: the first offer leaves with candidates
  // already in hand, shaving seconds off every connect and reconnect.
  iceCandidatePoolSize: 2,
}

// ── Dedicated TURN upgrade (optional, zero-redeploy) ────────────────────────
// Asks the shared API route for dedicated TURN credentials (metered.ca or
// Cloudflare, whichever the deployment configured via env). Absent, 501, or
// slow (capped at 2.5s) = the static config above keeps working. The answer
// is cached for the whole browser session either way.
let _icePromise = null
export function rtcIceConfig(idToken) {
  if (_icePromise) return _icePromise
  _icePromise = (async () => {
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = ctl ? setTimeout(() => ctl.abort(), 2500) : null
      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: 'Bearer ' + idToken } : {}),
        },
        body: JSON.stringify({ turn: 1 }),
        ...(ctl ? { signal: ctl.signal } : {}),
      })
      if (timer) clearTimeout(timer)
      if (res.ok) {
        const j = await res.json()
        if (Array.isArray(j?.iceServers) && j.iceServers.length) {
          // Dedicated relay ahead of the public one; STUN stays first.
          return {
            ...RTC_CONFIG,
            iceServers: [
              ...RTC_CONFIG.iceServers.slice(0, 2),
              ...j.iceServers,
              TURN_SERVER,
            ],
          }
        }
      }
    } catch { /* no endpoint / offline / slow - static config */ }
    return RTC_CONFIG
  })()
  return _icePromise
}

// A participant is considered gone when their heartbeat has been quiet this
// long (covers closed laptops / killed tabs that never ran the leave
// cleanup). STALE_FAST_MS applies when their WebRTC connection ALSO died -
// a dead link plus a quiet heartbeat means gone, no need to wait out the
// full window. IMPORTANT: age must be measured on the OBSERVER's clock
// (when did *I* last see their heartbeat value change), never by comparing
// Date.now() against their lastSeen - device clock skew made crashed peers
// look alive forever ("left but still in the meeting" ghosts).
export const HEARTBEAT_MS = 20000
export const STALE_MS = 50000
export const STALE_FAST_MS = 35000

const roomCol = (db, roomId, sub) => collection(db, 'rtcRooms', roomId, sub)

// One-shot roster read used for the join-time cap check and the initiator
// decision (who was already in the room when I arrived).
export async function rtcFetchParticipants(db, roomId) {
  const snap = await fbWithTimeout(getDocs(roomCol(db, roomId, 'participants')))
  return snap.docs.map(d => d.data())
}

export async function rtcJoinRoom(db, roomId, peer) {
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
  await fbWithTimeout(setDoc(doc(db, 'rtcRooms', roomId, 'participants', peer.peerId), data))
  return data
}

// Heartbeat + mic/cam/sharing state ride on the same participant doc, so one
// cheap update covers presence and the remote status badges together.
// Returns true on success so callers that CARE (the heartbeat) can retry;
// state-badge callers ignore the result as before.
export async function rtcUpdateParticipant(db, roomId, peerId, patch) {
  try {
    await updateDoc(doc(db, 'rtcRooms', roomId, 'participants', peerId), {
      lastSeen: Date.now(),
      ...patch,
    })
    return true
  } catch { return false /* best-effort - the doc may already be gone at teardown */ }
}

export async function rtcLeaveRoom(db, roomId, peerId) {
  try { await deleteDoc(doc(db, 'rtcRooms', roomId, 'participants', peerId)) } catch { /* best-effort */ }
  // Drop any signals still addressed to me so the room stays clean.
  try {
    const snap = await getDocs(query(roomCol(db, roomId, 'signals'), where('to', '==', peerId)))
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  } catch { /* best-effort */ }
}

// Tab-is-dying variant: the SDK's delete rides a WebChannel the browser kills
// before it flushes, so a closed tab used to leave its participant doc behind
// (Firestore has no onDisconnect). A keepalive fetch against the Firestore
// REST endpoint survives page teardown, so the doc usually IS deleted and
// everyone sees the person leave immediately instead of waiting out the
// stale window. Best-effort on top of rtcLeaveRoom, never instead of it.
export function rtcLeaveBeacon(db, roomId, peerId, idToken) {
  try {
    const pid = db?.app?.options?.projectId
    if (!pid || typeof fetch === 'undefined') return
    const url = 'https://firestore.googleapis.com/v1/projects/' + pid
      + '/databases/(default)/documents/rtcRooms/' + encodeURIComponent(roomId)
      + '/participants/' + encodeURIComponent(peerId)
    fetch(url, {
      method: 'DELETE',
      keepalive: true,
      headers: idToken ? { Authorization: 'Bearer ' + idToken } : {},
    }).catch(() => { /* best-effort */ })
  } catch { /* best-effort */ }
}

export async function rtcSendSignal(db, roomId, { to, from, type, data }) {
  const payload = { to, from, type, data: JSON.stringify(data), createdAt: Date.now() }
  // A dropped offer/answer/ICE stalls that link until the next heal cycle,
  // and network flaps are exactly when these messages matter - worth three
  // tries with a short breather between them.
  let lastErr = null
  for (let i = 0; i < 3; i++) {
    try { return await fbWithTimeout(addDoc(roomCol(db, roomId, 'signals'), payload)) }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 400 * (i + 1))) }
  }
  throw lastErr
}

// A Firestore listener that errors out (expired auth stream mid-class, a
// transport failure the SDK cannot retry) used to STAY dead: the device
// looked fine but heard no roster changes and no signals - a zombie only a
// manual rejoin fixed. Every room listener now re-attaches itself with
// backoff until it is unsubscribed for real.
function resilientSnapshot(makeQuery, onData) {
  let unsub = null
  let timer = null
  let stopped = false
  let delay = 1000
  const attach = () => {
    if (stopped) return
    unsub = onSnapshot(makeQuery(), snap => { delay = 1000; onData(snap) }, () => {
      try { if (unsub) unsub() } catch { /* already down */ }
      unsub = null
      if (stopped) return
      timer = setTimeout(attach, delay)
      delay = Math.min(15000, delay * 2)
    })
  }
  attach()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    try { if (unsub) unsub() } catch { /* already down */ }
  }
}

export function rtcListenParticipants(db, roomId, cb) {
  return resilientSnapshot(
    () => roomCol(db, roomId, 'participants'),
    snap => cb(snap.docs.map(d => d.data())),
  )
}

// Signals addressed to me, delivered in arrival order and deleted right after
// the handler resolves (each SDP/ICE message is consumed exactly once). On a
// re-attach after a listener error, unconsumed signals re-deliver as 'added'
// - consumed ones were already deleted, so nothing double-processes.
export function rtcListenSignals(db, roomId, peerId, handler) {
  let chain = Promise.resolve()
  return resilientSnapshot(
    () => query(roomCol(db, roomId, 'signals'), where('to', '==', peerId)),
    snap => {
      const added = snap.docChanges().filter(c => c.type === 'added')
        .map(c => ({ ref: c.doc.ref, msg: c.doc.data() }))
        .sort((a, b) => (a.msg.createdAt || 0) - (b.msg.createdAt || 0))
      for (const { ref, msg } of added) {
        // Serialize processing: an ICE candidate must never overtake the offer
        // it belongs to just because its snapshot callback won the race.
        chain = chain
          .then(() => handler({ ...msg, data: JSON.parse(msg.data) }))
          .catch(() => {})
          .then(() => deleteDoc(ref))
          .catch(() => {})
      }
    },
  )
}

// ── In-call chat ────────────────────────────────────────────────────────────
// Meet-style "In-call messages": visible only to people in the call, and
// deleted when the call ends (rtcCleanupRoom purges the subcollection). The
// professor's send-lock rides their PARTICIPANT doc (chatLock), like the
// recording flag, so it needs no extra document.
export async function rtcSendChat(db, roomId, msg) {
  await fbWithTimeout(addDoc(roomCol(db, roomId, 'chat'), {
    at: Date.now(),
    uid: msg.uid || '',
    name: msg.name || 'Participant',
    role: msg.role || 'student',
    text: String(msg.text || '').slice(0, 500),
  }))
}

export function rtcListenChat(db, roomId, cb) {
  return resilientSnapshot(
    () => roomCol(db, roomId, 'chat'),
    snap => cb(snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.at || 0) - (b.at || 0))),
  )
}

// ── Quick poll ───────────────────────────────────────────────────────────────
// One live poll per room at rtcRooms/{id}/polls/current: the professor
// overwrites it to ask, students write only their own votes.{uid} slot, and
// everyone renders the same doc. Votes are keyed by uid but never shown with
// names - anonymous to the class by design. The doc is transient like chat
// (purged by rtcCleanupRoom at End class).
export async function rtcSetPoll(db, roomId, poll) {
  await fbWithTimeout(setDoc(doc(db, 'rtcRooms', roomId, 'polls', 'current'), {
    id: poll.id,
    q: String(poll.q || '').slice(0, 140),
    opts: (poll.opts || []).slice(0, 4).map(o => String(o).slice(0, 40)),
    at: Date.now(),
    endsAt: poll.endsAt || 0,
    closed: false,
    votes: {},
  }))
}

export async function rtcVotePoll(db, roomId, uid, idx) {
  if (!uid) return
  await fbWithTimeout(updateDoc(doc(db, 'rtcRooms', roomId, 'polls', 'current'), {
    ['votes.' + uid]: idx,
  }))
}

export async function rtcClosePoll(db, roomId) {
  await fbWithTimeout(updateDoc(doc(db, 'rtcRooms', roomId, 'polls', 'current'), { closed: true }))
}

export function rtcListenPoll(db, roomId, cb) {
  return resilientSnapshot(
    () => doc(db, 'rtcRooms', roomId, 'polls', 'current'),
    snap => cb(snap.exists() ? snap.data() : null),
  )
}

// ── Meeting transcript (LEGACY READ) ────────────────────────────────────────
// Live in-meeting transcription was removed (2026-07-02); classes recorded
// before that still have `rtcRooms/{id}/transcript` docs, and this fetch is
// what lets their saved Recap/Transcript panels keep working. rtcCleanupRoom
// deliberately does NOT purge the subcollection for the same reason.
export async function rtcFetchTranscript(db, roomId) {
  const snap = await fbWithTimeout(getDocs(roomCol(db, roomId, 'transcript')), 30000)
  return snap.docs.map(d => d.data()).sort((a, b) => (a.at || 0) - (b.at || 0))
}

// Batched write of an on-device Whisper transcript: {at, name, text} docs
// under rtcRooms/{id}/transcript - the EXACT shape the legacy live engine
// wrote, so RecapModal and generateMeetingRecap read it unchanged. Any
// previous lines are wiped first (regenerating never duplicates).
export async function rtcSaveTranscript(db, roomId, lines) {
  if (!db || !roomId || !lines?.length) return
  const col = roomCol(db, roomId, 'transcript')
  const old = await getDocs(col)
  const ops = [
    ...old.docs.map(d => ({ del: d.ref })),
    ...lines.map(l => ({ ref: doc(col), data: { at: l.at || 0, name: l.name || 'Class', text: String(l.text || '').slice(0, 2000) } })),
  ]
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + 400)) {
      if (op.del) batch.delete(op.del)
      else batch.set(op.ref, op.data)
    }
    await batch.commit()
  }
}

// Best-effort purge of everything under rtcRooms/{roomId}. Called when the
// professor ends the class; anyone still connected also deletes their own
// docs on leave, so this only needs to catch stragglers.
export async function rtcCleanupRoom(db, roomId) {
  if (!db || !roomId) return
  try {
    const [parts, signals, chat, polls] = await Promise.all([
      getDocs(roomCol(db, roomId, 'participants')),
      getDocs(roomCol(db, roomId, 'signals')),
      getDocs(roomCol(db, roomId, 'chat')),
      getDocs(roomCol(db, roomId, 'polls')),
    ])
    const refs = [...parts.docs, ...signals.docs, ...chat.docs, ...polls.docs].map(d => d.ref)
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db)
      refs.slice(i, i + 400).forEach(r => batch.delete(r))
      await batch.commit()
    }
  } catch { /* best-effort */ }
}
