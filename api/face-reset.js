// ── Student: self-service password reset by face match (no professor needed) ─
// The student enters their student number and scans their face on the Forgot
// Password screen. Their device runs a liveness challenge and computes a live
// 128-number descriptor, then posts it here. THE SERVER decides the match - it
// loads the enrolled descriptor (from the server-only faceSignatures collection,
// which clients can neither read nor write) and compares distance - so the
// browser can never just claim "it matched", and the stored descriptor can never
// be read back and replayed by another student.
//
// Fully self-service: it does NOT notify the professor and writes NO record - a
// student resetting their own password leaves no professor-facing footprint.
// Rate-limited per student number via a Firestore-backed window (holds across
// serverless instances) and requires a passed liveness flag.
//
// Two-call, non-destructive design (no temp password, no custom token):
//   1) { studentNumber, descriptor, liveness }              → verifies the match,
//      returns { match: true }. Nothing is changed.
//   2) { studentNumber, descriptor, liveness, newPassword }  → re-verifies the
//      match AND sets the student's chosen new password directly. The current
//      password is only ever replaced by the one the student deliberately picks.
//
// Request body: { studentNumber, descriptor: number[128], liveness:{passed,type}, newPassword? }
// Response: { match: true } | { ok: true } | { match: false, error } | { error }

import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken,
  lookupLocalId, setPassword,
  getFaceSignature, getLegacyFaceDescriptor, writeFaceSignature, setFaceResetFlag,
  faceDistance, patchFaceThrottle, deleteResetSession,
} from './_fbadmin.js'

// Match threshold for face-api's 128-d descriptors. SINGLE SOURCE OF TRUTH lives
// in the client policy (src/utils/faceId.js → FACE_POLICY.MATCH.THRESHOLD = 0.6);
// the server keeps its own copy because it must decide the match independently
// (never trust a client "matched" claim) - but it is the SAME number. Keep the
// two in sync. The client enroll spread (0.45) is < this, so a clean enrolled
// signature always lands inside the match window and a real student isn't gated.
const THRESHOLD = 0.6

// Per-student-number throttle window (persisted in faceSignatures.rl). Two calls
// per successful reset, so the ceiling is generous.
const WINDOW_MS = 10 * 60_000
const MAX_ATTEMPTS = 12

export default async function handler(req, res) {
  if (guard(req, res, { max: 15 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { studentNumber, descriptor, liveness } = req.body || {}
  if (!studentNumber) return res.status(400).json({ error: 'Missing student number.' })
  if (!Array.isArray(descriptor) || descriptor.length !== 128 || !descriptor.every(n => Number.isFinite(n))) {
    return res.status(400).json({ error: 'Invalid face scan. Please try again.' })
  }
  if (!liveness || liveness.passed !== true) {
    return res.status(400).json({ error: 'Liveness check was not completed.' })
  }

  const docId = studentDocId(studentNumber)

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Face reset is not configured on the server.' })

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id

  let sig
  try { sig = await getFaceSignature(projectId, accessToken, docId) }
  catch (e) { return res.status(502).json({ error: 'Could not look up your account: ' + e.message }) }

  let stored = (sig && Array.isArray(sig.descriptor) && sig.descriptor.length === 128) ? sig.descriptor : null

  // Back-compat: recover (and migrate) a descriptor enrolled before signatures
  // moved to the server-only collection, so early adopters aren't stranded.
  if (!stored) {
    let legacy = null
    try { legacy = await getLegacyFaceDescriptor(projectId, accessToken, docId) } catch {}
    if (legacy && legacy.length === 128) {
      stored = legacy
      try {
        await writeFaceSignature(projectId, accessToken, docId, legacy)
        await setFaceResetFlag(projectId, accessToken, docId, true)
        sig = { descriptor: legacy, rl: [] }
      } catch {}
    }
  }

  if (!stored) {
    return res.status(400).json({ error: 'Face ID reset isn’t set up on this account yet. Sign in, then set it up under Settings → “Set up Face ID reset” - or ask your professor to reset your password.' })
  }

  // Throttle (cross-instance): count attempts in the window, then record this one.
  const now = Date.now()
  const recent = ((sig && sig.rl) || []).filter(t => now - t < WINDOW_MS)
  if (recent.length >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes, or ask your professor to reset your password.' })
  }
  await patchFaceThrottle(projectId, accessToken, docId, [...recent, now].slice(-20))

  const dist = faceDistance(descriptor, stored)
  if (dist > THRESHOLD) {
    return res.status(401).json({ match: false, error: 'That face did not match. Try again in good lighting, or ask your professor to reset your password.' })
  }

  // ── Step 1 (verify only): no new password yet → confirm the match, change
  // nothing. The student's current password is left completely untouched. ──
  const newPassword = (req.body && req.body.newPassword) || ''
  if (!newPassword) {
    return res.status(200).json({ match: true })
  }

  // ── Step 2 (set): the student picked a new password (and we re-verified the
  // face above). Validate, then set it directly - no temp password ever. ──
  if (typeof newPassword !== 'string' || newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter and a number.' })
  }

  let localId
  try {
    localId = await lookupLocalId(projectId, accessToken, studentEmail(studentNumber))
    if (!localId) return res.status(404).json({ error: 'No login account exists for this student.' })
  } catch (e) {
    return res.status(502).json({ error: 'Lookup error: ' + e.message })
  }

  try { await setPassword(projectId, accessToken, localId, newPassword) }
  catch (e) { return res.status(502).json({ error: 'Could not set your new password: ' + e.message }) }

  // Close any open professor reset window too (harmless if none).
  try { await deleteResetSession(projectId, accessToken, docId) } catch {}

  // Fully self-service: the professor is NOT notified and NO record is written -
  // a student resetting their own password leaves no professor-facing footprint.

  return res.status(200).json({ ok: true })
}
