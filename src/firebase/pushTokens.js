// ── FCM token persistence ─────────────────────────────────────────────────
// Tokens live in their own `pushTokens` collection (doc id = token) so they
// are never clobbered by full-document student writes. Server-side send code
// reads this collection to deliver pushes.
import { doc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore'
import { fbWithTimeout } from './firebaseInit'

export async function fbSavePushToken(db, token, ownerId, role) {
  if (!db || !token) return
  try {
    await fbWithTimeout(setDoc(doc(db, 'pushTokens', token), {
      token,
      ownerId: ownerId || null,
      role: role || 'student',
      ua: (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '',
      updatedAt: Date.now(),
    }, { merge: true }))
  } catch (e) {
    console.warn('[push] save token failed:', e.message)
  }
}

export async function fbDeletePushToken(db, token) {
  if (!db || !token) return
  try {
    await deleteDoc(doc(db, 'pushTokens', token))
  } catch (e) {
    console.warn('[push] delete token failed:', e.message)
  }
}

/**
 * Fire-and-forget web push to a set of owners via the /api/send-push endpoint.
 * Reads registered tokens, filters to the target owners, and posts them.
 * Silently no-ops if there are no tokens or the endpoint is not configured —
 * the in-app Firestore notification (the existing behavior) is unaffected.
 *
 * @param {*} db Firestore instance
 * @param {string[]|'all'} ownerIds target student ids, or 'all'
 * @param {{title:string, body:string}} notification
 * @param {object} [data] extra data (e.g. { url, tag })
 */
export async function sendPushToOwners(db, ownerIds, notification, data = {}) {
  if (!db) return
  try {
    const snap = await getDocs(collection(db, 'pushTokens'))
    if (snap.empty) return
    const all = ownerIds === 'all'
    const targetSet = all ? null : new Set(ownerIds || [])
    const tokens = []
    snap.forEach((d) => {
      const t = d.data()
      if (!t?.token) return
      if (all || targetSet.has(t.ownerId)) tokens.push(t.token)
    })
    if (!tokens.length) return

    await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens, notification, data }),
    }).catch(() => {})
  } catch (e) {
    // Push is best-effort; never let it affect the calling flow.
    console.warn('[push] sendPushToOwners skipped:', e.message)
  }
}
