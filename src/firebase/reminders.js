// ── Reminder notification writer ──────────────────────────────────────────
// Writes a single reminder into notifications/{studentId}.items, matching the
// shape every other notification path uses. Idempotent: a reminder carries a
// stable `remKey`, and we skip the write when an item with that key already
// exists. This keeps the engine safe to run repeatedly and across devices —
// the deadline is reminded once, not once per session or per tab.
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { fbWithTimeout } from './firebaseInit'

// Returns true only when a NEW reminder was written (so the caller can fire a
// matching web push exactly once), false when it already existed or on failure.
export async function fbPushReminderNotif(db, studentId, rem) {
  if (!db || !studentId || !rem?.remKey) return false
  const ref = doc(db, 'notifications', studentId)

  let existing = []
  try {
    const snap = await getDoc(ref)
    if (snap.exists()) existing = snap.data().items || []
  } catch (e) {
    return false // can't confirm idempotency — don't risk a duplicate
  }

  if (existing.some(i => i.remKey === rem.remKey)) return false

  const item = {
    id: 'n_' + Date.now() + Math.random().toString(36).slice(2, 6),
    remKey: rem.remKey,
    type: rem.type || 'reminder',
    read: false,
    ts: Date.now(),
    title: rem.title || 'Reminder',
    body: rem.body || '',
    link: rem.link || 'overview',
  }

  try {
    await fbWithTimeout(setDoc(ref, { items: [item, ...existing].slice(0, 200) }, { merge: false }))
    return true
  } catch (e) {
    return false
  }
}
