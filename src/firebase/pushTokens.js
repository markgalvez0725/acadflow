// ── FCM token persistence ─────────────────────────────────────────────────
// Tokens live in their own `pushTokens` collection (doc id = token) so they
// are never clobbered by full-document student writes. Server-side send code
// reads this collection to deliver pushes.
import { doc, setDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore'
import { fbWithTimeout, getIdToken } from './firebaseInit'

export async function fbSavePushToken(db, token, ownerId, role) {
  if (!db || !token) return
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || ''
  try {
    await fbWithTimeout(setDoc(doc(db, 'pushTokens', token), {
      token,
      ownerId: ownerId || null,
      role: role || 'student',
      ua,
      updatedAt: Date.now(),
    }, { merge: true }))

    // Prune this owner's older tokens for the SAME device (same user-agent).
    // FCM rotates tokens; without this a device accumulates several live tokens
    // and the server fans out to all of them - so the same push shows several
    // times. Keeping one token per owner+device delivers exactly one push.
    if (ownerId) {
      // Query just this owner's tokens instead of scanning the whole collection.
      const snap = await getDocs(query(collection(db, 'pushTokens'), where('ownerId', '==', ownerId)))
      const stale = []
      snap.forEach((d) => {
        const t = d.data()
        if (t && t.ua === ua && t.token !== token) stale.push(t.token)
      })
      await Promise.all(stale.map((t) => deleteDoc(doc(db, 'pushTokens', t)).catch(() => {})))
    }
  } catch (e) {
    console.warn('[push] save token failed:', e.message)
  }
}

/**
 * Fire-and-forget web push to a set of owners via the /api/send-push endpoint.
 * Reads registered tokens, filters to the target owners, and posts them.
 * Silently no-ops if there are no tokens or the endpoint is not configured -
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
    const tokens = []
    if (ownerIds === 'all') {
      // Genuine broadcast to every device: a full scan is unavoidable here.
      const snap = await getDocs(collection(db, 'pushTokens'))
      snap.forEach((d) => { const t = d.data(); if (t?.token) tokens.push(t.token) })
    } else {
      const ids = [...new Set((ownerIds || []).filter(Boolean))]
      if (!ids.length) return
      // Query by ownerId in chunks of 30 (Firestore 'in' cap) instead of reading
      // the entire pushTokens collection on every push. Most sends target one or
      // a few owners, so this is ~1-2 reads instead of one-per-registered-device.
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30)
        const snap = await getDocs(query(collection(db, 'pushTokens'), where('ownerId', 'in', chunk)))
        snap.forEach((d) => { const t = d.data(); if (t?.token) tokens.push(t.token) })
      }
    }
    if (!tokens.length) return

    const idToken = await getIdToken()
    if (!idToken) return // not signed in - skip (in-app notification still fires)
    await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens, notification, data, idToken }),
    }).catch(() => {})
  } catch (e) {
    // Push is best-effort; never let it affect the calling flow.
    console.warn('[push] sendPushToOwners skipped:', e.message)
  }
}
