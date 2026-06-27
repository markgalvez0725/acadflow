// ── Profile photo ↔ enrolled Face ID identity check (client side) ──────────
// Confirms a chosen profile photo is the SAME person who enrolled Face ID. The
// enrolled descriptor is server-only (clients can neither read nor write it), so
// the actual comparison happens on the server (api/match-face-photo). The browser
// only computes the photo's descriptor with the same on-device engine used for
// enrollment and reset, so a face that enrolls cleanly also matches cleanly.
//
// Returns a small verdict the photo UI folds into its existing check:
//   { noFace: true }                        no face found IN THE PHOTO
//   { enrolled: false }                     account has no Face ID yet (don't gate on identity)
//   { enrolled: true, match, distance }     identity decision
//   { error }                               models/auth/network/server problem (advise, don't hard-block)

import { getIdToken } from '@/firebase/firebaseInit'
import { describeFaceInImage } from '@/utils/faceId'

export async function matchPhotoToEnrolledFace(imgEl) {
  let descriptor = null
  try { descriptor = await describeFaceInImage(imgEl) }
  catch { return { error: 'models' } }
  if (!descriptor) return { noFace: true }

  let idToken = null
  try { idToken = await getIdToken() } catch { /* ignore */ }
  if (!idToken) return { error: 'auth' }

  let r, data
  try {
    r = await fetch('/api/match-face-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, descriptor }),
    })
    data = await r.json().catch(() => ({}))
  } catch { return { error: 'network' } }

  if (!r.ok) return { error: data?.error || 'server' }
  return { enrolled: !!data.enrolled, match: !!data.match, distance: data.distance }
}
