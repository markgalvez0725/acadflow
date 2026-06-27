// ── FCM token persistence ─────────────────────────────────────────────────
// Tokens live in their own `pushTokens` collection (doc id = token) so they
// are never clobbered by full-document student writes. Server-side send code
// reads this collection to deliver pushes.
import { doc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore'
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
      const snap = await getDocs(collection(db, 'pushTokens'))
      const stale = []
      snap.forEach((d) => {
        const t = d.data()
        if (t && t.ownerId === ownerId && t.ua === ua && t.token !== token) stale.push(t.token)
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
