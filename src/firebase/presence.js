// ── Firestore access for Who's online presence ────────────────────────────
// One doc per user at `presence/{userId}`, whole-doc replaced by that user's
// own device on a slow heartbeat (the localStorage accumulator is the truth).
// Only the professor reads the collection back, one-shot, from the System
// reports tab. Like telemetry, writes are NOT wrapped in fbWithTimeout: they
// fire during pagehide/visibility flushes where nothing awaits them.

import { doc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore'

export async function fbSavePresence(db, uid, data) {
  if (!db || !uid || !data) return
  await setDoc(doc(db, 'presence', uid), data)
}

/** Admin-side one-shot fetch of every presence doc. */
export async function fbFetchPresence(db) {
  if (!db) return []
  const snap = await getDocs(collection(db, 'presence'))
  const rows = []
  snap.forEach(d => rows.push({ id: d.id, ...d.data() }))
  return rows
}

/** Cascade-delete hook: drop a purged student's presence doc. Best-effort. */
export async function fbDeletePresence(db, uid) {
  if (!db || !uid) return
  try { await deleteDoc(doc(db, 'presence', uid)) } catch { /* best-effort */ }
}
