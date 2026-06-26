// ── Student: self-service password reset by face match (no teacher needed) ─
// The student enters their student number and scans their face on the Forgot
// Password screen. Their device runs a liveness challenge and computes a live
// 128-number descriptor, then posts it here. THE SERVER decides the match — it
// loads the enrolled descriptor (from the server-only faceSignatures collection,
// which clients can neither read nor write) and compares distance — so the
// browser can never just claim "it matched", and the stored descriptor can never
// be read back and replayed by another student. On a match the server issues a
// one-time temporary password (forcing a change next screen) and notifies the
// teacher.
//
// Rate-limited per student number via a Firestore-backed window (so it holds
// across serverless instances), requires a passed liveness flag, and always
// forces a new password.
//
// Request body: { studentNumber, descriptor: number[128], liveness: { passed: true, type } }
// Response: { tempPassword } | { match: false, error } | { error }

import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken,
  lookupLocalId, setPassword,
  getFaceSignature, getStudentRoster, faceDistance, patchFaceThrottle,
  appendAdminNotification, appendAuditLog, deleteResetSession,
  generateTempPassword,
} from './_fbadmin.js'

// Match threshold for face-api's 128-d descriptors. Lower = stricter (the
// library's own default is ~0.6); 0.5 is conservative.
const THRESHOLD = 0.5

// Per-student-number throttle window (persisted in faceSignatures.rl).
const WINDOW_MS = 10 * 60_000
const MAX_ATTEMPTS = 5

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

  if (!sig || !Array.isArray(sig.descriptor) || sig.descriptor.length !== 128) {
    return res.status(400).json({ error: 'Face ID reset is not set up for this account. Ask your teacher to reset your password instead.' })
  }

  // Throttle (cross-instance): count attempts in the window, then record this one.
  const now = Date.now()
  const recent = (sig.rl || []).filter(t => now - t < WINDOW_MS)
  if (recent.length >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes, or ask your teacher to reset your password.' })
  }
  await patchFaceThrottle(projectId, accessToken, docId, [...recent, now].slice(-20))

  const dist = faceDistance(descriptor, sig.descriptor)
  if (dist > THRESHOLD) {
    return res.status(401).json({ match: false, error: 'That face did not match. Try again in good lighting, or ask your teacher to reset your password.' })
  }

  // Resolve a display name for the teacher notice (best-effort).
  let name = docId
  try { const roster = await getStudentRoster(projectId, accessToken, docId); if (roster?.name) name = roster.name } catch {}

  // Matched — issue a one-time temporary password (student is forced to change it).
  let localId
  try {
    localId = await lookupLocalId(projectId, accessToken, studentEmail(studentNumber))
    if (!localId) return res.status(404).json({ error: 'No login account exists for this student.' })
  } catch (e) {
    return res.status(502).json({ error: 'Lookup error: ' + e.message })
  }

  const tempPassword = generateTempPassword()
  try { await setPassword(projectId, accessToken, localId, tempPassword) }
  catch (e) { return res.status(502).json({ error: 'Could not set the new password: ' + e.message }) }

  // Close any open teacher reset window too (harmless if none).
  try { await deleteResetSession(projectId, accessToken, docId) } catch {}

  // Tell the teacher + audit (best-effort — must never block the student's reset).
  try {
    await appendAdminNotification(projectId, accessToken, {
      id: 'fr' + Date.now() + Math.random().toString(36).slice(2, 6),
      type: 'face_reset',
      title: 'Face ID password reset',
      body: `${name} reset their password with Face ID`,
      link: 'students',
      ts: Date.now(),
    })
  } catch {}
  try {
    await appendAuditLog(projectId, accessToken, {
      actor: 'face-reset',
      action: 'account.face_reset',
      target: name,
      summary: `${name} reset their password with Face ID`,
    })
  } catch {}

  return res.status(200).json({ tempPassword, match: true })
}
