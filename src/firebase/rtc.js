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

// Free public STUN (connectivity discovery only - no media ever relays
// through Google). Without a TURN server some strict-NAT pairs cannot
// connect; the UI surfaces that per-tile instead of failing the whole room.
export const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
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
export async function rtcUpdateParticipant(db, roomId, peerId, patch) {
  try {
    await updateDoc(doc(db, 'rtcRooms', roomId, 'participants', peerId), {
      lastSeen: Date.now(),
      ...patch,
    })
  } catch { /* best-effort - the doc may already be gone at teardown */ }
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
  await fbWithTimeout(addDoc(roomCol(db, roomId, 'signals'), {
    to, from, type,
    data: JSON.stringify(data),
    createdAt: Date.now(),
  }))
}

export function rtcListenParticipants(db, roomId, cb) {
  return onSnapshot(roomCol(db, roomId, 'participants'), snap => {
    cb(snap.docs.map(d => d.data()))
  }, () => { /* listener error - the room UI shows the connection state */ })
}

// Signals addressed to me, delivered in arrival order and deleted right after
// the handler resolves (each SDP/ICE message is consumed exactly once).
export function rtcListenSignals(db, roomId, peerId, handler) {
  const q = query(roomCol(db, roomId, 'signals'), where('to', '==', peerId))
  let chain = Promise.resolve()
  return onSnapshot(q, snap => {
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
  }, () => {})
}

// ── Silent meeting transcript ───────────────────────────────────────────────
// Each participant's device transcribes its OWN speech (utils/transcribe.js)
// and appends segments here. Never displayed during class; assembled into the
// Smart Recap when the professor ends the meeting. NOTE: rtcCleanupRoom
// deliberately does NOT purge this subcollection - the transcript must
// survive the room teardown so the recap can be (re)generated later.
export async function rtcAddTranscript(db, roomId, segment) {
  await fbWithTimeout(addDoc(roomCol(db, roomId, 'transcript'), {
    at: segment.at || Date.now(),
    uid: segment.uid || '',
    name: segment.name || 'Participant',
    role: segment.role || 'student',
    lang: segment.lang || '',
    text: String(segment.text || '').slice(0, 2000),
  }))
}

export async function rtcFetchTranscript(db, roomId) {
  const snap = await fbWithTimeout(getDocs(roomCol(db, roomId, 'transcript')), 30000)
  return snap.docs.map(d => d.data()).sort((a, b) => (a.at || 0) - (b.at || 0))
}

// Best-effort purge of everything under rtcRooms/{roomId}. Called when the
// professor ends the class; anyone still connected also deletes their own
// docs on leave, so this only needs to catch stragglers.
export async function rtcCleanupRoom(db, roomId) {
  if (!db || !roomId) return
  try {
    const [parts, signals] = await Promise.all([
      getDocs(roomCol(db, roomId, 'participants')),
      getDocs(roomCol(db, roomId, 'signals')),
    ])
    const refs = [...parts.docs, ...signals.docs].map(d => d.ref)
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db)
      refs.slice(i, i + 400).forEach(r => batch.delete(r))
      await batch.commit()
    }
  } catch { /* best-effort */ }
}
