// ── Student: confirm a profile photo is the SAME face enrolled for Face ID ──
// The browser computes a 128-number descriptor from the chosen profile photo
// (face-api, on-device) and posts it here. THE SERVER decides the match: it
// loads the enrolled descriptor from the server-only faceSignatures collection
// (clients can neither read nor write it) and compares Euclidean distance at the
// SAME threshold as password reset. The photo image itself never leaves the
// device; only the math vector does, and only to be compared, never stored.
//
// This is what makes a profile photo trustworthy: it can only be saved if it is
// the same person who enrolled Face ID (with liveness), so a student cannot set
// someone else's face (or a stock image) as their identity.
//
// Request body: { idToken: string, descriptor: number[128] }
// Response:
//   { enrolled: false }                          no Face ID signature yet (caller falls back)
//   { enrolled: true, match: boolean, distance } identity decision
//   { error: string }

import { guard } from './_guard.js'
import {
  requireUser, studentDocId,
  loadServiceAccount, getAccessToken,
  getFaceSignature, getLegacyFaceDescriptor, faceDistance,
} from './_fbadmin.js'

// Same number as face-reset.js and the client FACE_POLICY.MATCH.THRESHOLD (0.6).
// The enroll spread (0.45) is < this, so a clean enrolled signature lands inside
// the match window and a genuine student is never falsely rejected. Keep in sync.
const THRESHOLD = 0.6

export default async function handler(req, res) {
  if (guard(req, res, { max: 30 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Must be a signed-in student; we only ever check the caller's own record.
  const user = await requireUser(req, res)
  if (!user) return
  const email = String(user.email || '').toLowerCase()
  if (!email.endsWith('@acadflow.app')) {
    return res.status(403).json({ error: 'Only student accounts can verify a photo.' })
  }
  const snum = email.slice(0, -'@acadflow.app'.length)
  const docId = studentDocId(snum)

  const { descriptor } = req.body || {}
  if (!Array.isArray(descriptor) || descriptor.length !== 128
      || !descriptor.every(n => Number.isFinite(n) && Math.abs(n) < 10)) {
    return res.status(400).json({ error: 'Invalid face data. Please retake the photo.' })
  }

  const sa = loadServiceAccount()
  // Face matching not configured on the server (no service account): the caller
  // falls back to the on-device photo checks only, so onboarding never dead-ends.
  if (!sa) return res.status(200).json({ enrolled: false, configured: false })

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id

  let sig
  try { sig = await getFaceSignature(projectId, accessToken, docId) }
  catch (e) { return res.status(502).json({ error: 'Could not look up your account: ' + e.message }) }

  let stored = (sig && Array.isArray(sig.descriptor) && sig.descriptor.length === 128) ? sig.descriptor : null

  // Back-compat: a descriptor enrolled before signatures moved to the server-only
  // collection still counts, so early adopters aren't blocked on their own photo.
  if (!stored) {
    let legacy = null
    try { legacy = await getLegacyFaceDescriptor(projectId, accessToken, docId) } catch { /* ignore */ }
    if (legacy && legacy.length === 128) stored = legacy
  }

  if (!stored) return res.status(200).json({ enrolled: false })

  const dist = faceDistance(descriptor, stored)
  return res.status(200).json({ enrolled: true, match: dist <= THRESHOLD, distance: dist })
}
