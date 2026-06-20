// ── Message notifications ─────────────────────────────────────────────────
// Cross-side notifications for the messaging system. Every helper writes an
// in-app notification item (the badge source) into notifications/{ownerId},
// then fires a best-effort web push. Push silently no-ops when FCM is not
// configured or the recipient has no registered token — the in-app badge is
// the guaranteed, free behavior and never depends on push.
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { fbWithTimeout } from './firebaseInit'
import { sendPushToOwners } from './pushTokens'

function newId() {
  return 'n' + Date.now() + Math.random().toString(36).slice(2, 6)
}

/**
 * Append an in-app notification to notifications/{ownerId} (read-modify-write).
 * Mirrors the pattern used for activity/grade notifications.
 */
export async function appendNotif(db, ownerId, notif) {
  if (!db || !ownerId) return
  try {
    const ref = doc(db, 'notifications', ownerId)
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().items || []) : []
    const item = { id: newId(), read: false, ts: Date.now(), ...notif }
    await fbWithTimeout(setDoc(ref, { items: [item, ...existing].slice(0, 200) }, { merge: false }))
  } catch (e) {
    console.warn('[notify] appendNotif failed:', e.message)
  }
}

/** Teacher → one student: in-app notif + best-effort web push. */
export async function notifyStudentMessage(db, studentId, body, fromLabel = 'your teacher') {
  if (!studentId) return
  const title = 'New message from ' + fromLabel
  await appendNotif(db, studentId, {
    type: 'msg_out',
    title,
    body: (body || '').slice(0, 80),
    link: 'messages',
  })
  sendPushToOwners(db, [studentId], {
    title,
    body: (body || '').slice(0, 120) || 'Open AcadFlow to read it.',
  }, { url: '/', tag: 'message' })
}

/** Teacher → many students (broadcast / announcement): in-app notif each + one push. */
export async function notifyStudentsBroadcast(db, studentIds, subject) {
  const ids = [...new Set((studentIds || []).filter(Boolean))]
  if (!ids.length) return
  await Promise.all(ids.map(id => appendNotif(db, id, {
    type: 'msg_out',
    title: 'New announcement from your teacher',
    body: (subject || '').slice(0, 80),
    link: 'messages',
  })))
  sendPushToOwners(db, ids, {
    title: 'New announcement',
    body: (subject || '').slice(0, 120) || 'Open AcadFlow to read it.',
  }, { url: '/', tag: 'message' })
}

/** Student → teacher: in-app admin notif + best-effort web push to admin. */
export async function notifyAdminMessage(db, studentName, body, kind = 'message') {
  const title = (kind === 'reply' ? 'Reply from ' : 'Message from ') + (studentName || 'a student')
  await appendNotif(db, 'admin', {
    type: 'msg_in',
    title,
    body: (body || '').slice(0, 80),
    link: 'messages',
  })
  sendPushToOwners(db, ['admin'], {
    title,
    body: (body || '').slice(0, 120) || 'Open AcadFlow to read it.',
  }, { url: '/', tag: 'message' })
}
