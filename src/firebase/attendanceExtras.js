// ── Attendance extras: self check-in sessions + excuse requests ───────────
// Two small Firestore collections that coordinate the live check-in code and
// student excuse requests. Student present/excused marks are still written to
// the student documents through the existing persistence path (in DataContext).
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from 'firebase/firestore'
import { fbWithTimeout } from './firebaseInit'

// ── Notifications (match the existing notifications/{id}.items shape) ──────
async function pushNotifItem(db, docId, { title, body, link, type = 'excuse' }) {
  if (!db) return
  try {
    const ref = doc(db, 'notifications', docId)
    let existing = []
    try { const snap = await getDoc(ref); if (snap.exists()) existing = snap.data().items || [] } catch (e) {}
    const item = {
      id: 'n_' + Date.now() + Math.random().toString(36).slice(2, 6),
      type, read: false, ts: Date.now(),
      title, body: body || '', link: link || 'attendance',
    }
    await fbWithTimeout(setDoc(ref, { items: [item, ...existing].slice(0, 200) }, { merge: false }))
  } catch (e) { /* notifications are best-effort */ }
}

export function fbNotifyAdmin(db, payload) {
  return pushNotifItem(db, 'admin', payload)
}
export function fbNotifyStudent(db, studentId, payload) {
  return pushNotifItem(db, studentId, payload)
}

// Unambiguous code alphabet (no 0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function genSessionCode(len = 6) {
  let c = ''
  for (let i = 0; i < len; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return c
}

export function todayKey() {
  // Local calendar date (YYYY-MM-DD), not UTC — a school in UTC+8 must stamp the
  // session under the day the teacher/student actually sees, or early-morning
  // sessions land on the previous date. en-CA yields ISO-style YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA')
}

// ── Check-in sessions ─────────────────────────────────────────────────────
export async function fbOpenAttendanceSession(db, { classId, subject, openedBy = 'admin' }) {
  if (!db) throw new Error('Not connected.')
  const id = 'as_' + Date.now() + Math.random().toString(36).slice(2, 6)
  const session = {
    id,
    code: genSessionCode(),
    classId,
    subject,
    date: todayKey(),
    status: 'open',
    openedAt: Date.now(),
    closedAt: null,
    openedBy,
    checkedIn: {}, // studentId -> timestamp
  }
  await fbWithTimeout(setDoc(doc(db, 'attendanceSessions', id), session))
  return session
}

export async function fbMarkCheckedIn(db, sessionId, studentId) {
  if (!db) throw new Error('Not connected.')
  await fbWithTimeout(updateDoc(doc(db, 'attendanceSessions', sessionId), {
    [`checkedIn.${studentId}`]: Date.now(),
  }))
}

export async function fbCloseAttendanceSession(db, sessionId) {
  if (!db) return
  await fbWithTimeout(updateDoc(doc(db, 'attendanceSessions', sessionId), {
    status: 'closed',
    closedAt: Date.now(),
  }))
}

export async function fbDeleteAttendanceSession(db, sessionId) {
  if (!db) return
  try { await deleteDoc(doc(db, 'attendanceSessions', sessionId)) } catch (e) {}
}

// ── Excuse requests ───────────────────────────────────────────────────────
export async function fbSubmitExcuseRequest(db, req) {
  if (!db) throw new Error('Not connected.')
  const id = req.id || ('ex_' + Date.now() + Math.random().toString(36).slice(2, 6))
  const doc_ = { ...req, id, status: 'pending', createdAt: Date.now(), decidedAt: null }
  await fbWithTimeout(setDoc(doc(db, 'excuseRequests', id), doc_))
  return doc_
}

export async function fbDecideExcuseRequest(db, id, status) {
  if (!db) throw new Error('Not connected.')
  await fbWithTimeout(updateDoc(doc(db, 'excuseRequests', id), {
    status, // 'approved' | 'denied'
    decidedAt: Date.now(),
  }))
}
