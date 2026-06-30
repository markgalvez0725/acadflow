// ── Message notifications ─────────────────────────────────────────────────
// Cross-side notifications for the messaging system. Every helper writes an
// in-app notification item (the badge source) into notifications/{ownerId},
// then fires a best-effort web push. Push silently no-ops when FCM is not
// configured or the recipient has no registered token - the in-app badge is
// the guaranteed, free behavior and never depends on push.
import { doc, runTransaction, writeBatch, arrayUnion } from 'firebase/firestore'
import { fbWithTimeout } from './firebaseInit'
import { sendPushToOwners } from './pushTokens'

function newId() {
  return 'n' + Date.now() + Math.random().toString(36).slice(2, 6)
}

/**
 * Append an in-app notification to notifications/{ownerId}.
 * Runs inside a transaction so two notifications arriving close together (e.g.
 * a professor sending several messages, or many students messaging the professor)
 * can't overwrite each other - which previously dropped badges silently.
 */
export async function appendNotif(db, ownerId, notif) {
  if (!db || !ownerId) return
  const ref = doc(db, 'notifications', ownerId)
  const item = { id: newId(), read: false, ts: Date.now(), ...notif }
  try {
    await fbWithTimeout(runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref)
      const existing = snap.exists() ? (snap.data().items || []) : []
      transaction.set(ref, { items: [item, ...existing].slice(0, 200) })
    }))
  } catch (e) {
    console.warn('[notify] appendNotif failed:', e.message)
  }
}

// Smart-locked messages must never surface their text in a notification (in-app
// badge OR lock-screen web push). Masking lives HERE, at the single choke point
// every message notification flows through, so no call site can forget it.
const PRIVATE_LABEL = 'Private message'
function notifBody(text, secure, max) {
  if (secure) return PRIVATE_LABEL
  return (text || '').slice(0, max)
}

/** Professor → one student: in-app notif + best-effort web push. */
export async function notifyStudentMessage(db, studentId, body, fromLabel = 'your professor', { secure = false } = {}) {
  if (!studentId) return
  const title = 'New message from ' + fromLabel
  await appendNotif(db, studentId, {
    type: 'msg_out',
    title,
    body: notifBody(body, secure, 80),
    link: 'msgdirect', // opens the 1:1 professor thread (not a single message)
  })
  sendPushToOwners(db, [studentId], {
    title,
    body: notifBody(body, secure, 120) || 'Open AcadFlow to read it.',
  }, { url: '/', tag: 'message' })
}

/** Professor → many students (broadcast / announcement): in-app notif each + one push. */
export async function notifyStudentsBroadcast(db, studentIds, subject, { secure = false, msgId = null } = {}) {
  const ids = [...new Set((studentIds || []).filter(Boolean))]
  if (!ids.length) return
  const title = 'New announcement from your professor'
  const body = notifBody(subject, secure, 80)
  // A broadcast is one message doc; carry its id so the click opens that thread.
  const link = msgId ? `msg:${msgId}` : 'messages'
  // Fan out in BATCHED commits instead of one transaction per recipient. Each op
  // is an arrayUnion append with no per-doc read, so a 200-student broadcast is a
  // couple of round trips (Firestore caps a batch at 500 ops) rather than 200
  // transactional read-modify-writes hammering the backend at once. The 200-item
  // cap that appendNotif enforces is re-applied lazily the next time any single
  // (non-broadcast) notif lands for that student, so arrays stay bounded.
  const CHUNK = 450
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = writeBatch(db)
      ids.slice(i, i + CHUNK).forEach(id => {
        const item = { id: newId(), read: false, ts: Date.now(), type: 'msg_out', title, body, link }
        batch.set(doc(db, 'notifications', id), { items: arrayUnion(item) }, { merge: true })
      })
      await fbWithTimeout(batch.commit())
    }
  } catch (e) {
    console.warn('[notify] broadcast batch failed:', e.message)
  }
  sendPushToOwners(db, ids, {
    title: 'New announcement',
    body: notifBody(subject, secure, 120) || 'Open AcadFlow to read it.',
  }, { url: '/', tag: 'message' })
}

/** Someone mentioned this user in an announcement comment. */
export async function notifyMention(db, ownerId, { fromName, snippet, link = 'stream' } = {}) {
  if (!ownerId) return
  const title = (fromName || 'Someone') + ' mentioned you'
  await appendNotif(db, ownerId, {
    type: 'mention',
    title,
    body: (snippet || '').slice(0, 80),
    link,
  })
  sendPushToOwners(db, [ownerId], {
    title,
    body: (snippet || '').slice(0, 120) || 'Open AcadFlow to see the comment.',
  }, { url: '/', tag: 'mention' })
}

/** New comment on a post the user follows ("Turn on notifications"). */
export async function notifyPostFollowers(db, ownerIds, { fromName, postTitle, snippet } = {}) {
  const ids = [...new Set((ownerIds || []).filter(Boolean))]
  if (!ids.length) return
  const where = postTitle ? `"${postTitle.slice(0, 40)}"` : 'a post you follow'
  const title = 'New comment on ' + where
  const body = ((fromName ? fromName + ': ' : '') + (snippet || '')).slice(0, 100)
  await Promise.all(ids.map(id => appendNotif(db, id, { type: 'comment', title, body: body.slice(0, 80), link: 'stream' })))
  sendPushToOwners(db, ids, { title, body: body || 'Open AcadFlow to read it.' }, { url: '/', tag: 'comment' })
}

/** Student → teacher: in-app admin notif + best-effort web push to admin. */
export async function notifyAdminMessage(db, studentName, body, kind = 'message', { secure = false, studentId = null } = {}) {
  const title = (kind === 'reply' ? 'Reply from ' : 'Message from ') + (studentName || 'a student')
  await appendNotif(db, 'admin', {
    type: 'msg_in',
    title,
    body: notifBody(body, secure, 80),
    // Opens the professor's 1:1 conversation with this student.
    link: studentId ? `conv:${studentId}` : 'messages',
  })
  sendPushToOwners(db, ['admin'], {
    title,
    body: notifBody(body, secure, 120) || 'Open AcadFlow to read it.',
  }, { url: '/', tag: 'message' })
}
