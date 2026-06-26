// ── Student: self-service password reset by face match (no teacher needed) ─
// The student enters their student number and scans their face on the Forgot
// Password screen. Their device runs a liveness challenge and computes a live
// 128-number descriptor, then posts it here. THE SERVER decides the match — it
// loads the enrolled descriptor and compares distance — so the browser can never
// just claim "it matched". On a match the server issues a one-time temporary
// password (forcing a change on next screen) and notifies the teacher.
//
// Security posture (see the design discussion): on-device face matching has no
// cryptographic liveness, so this is a moderate-assurance convenience. It is
// rate-limited per student number, always forces a new password, and every reset
// is reported to the teacher so a takeover attempt is visible and reversible.
//
// Request body: { studentNumber: string, descriptor: number[128], liveness: { passed: true, type } }
// Response: { tempPassword } | { match: false, error } | { error }

import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken,
  lookupLocalId, setPassword,
  getStudentFace, faceDistance,
  appendAdminNotification, deleteResetSession,
  generateTempPassword,
} from './_fbadmin.js'

// Match threshold for face-api's 128-d descriptors. Lower = stricter. 0.5 is a
// conservative bar (the library's own default is ~0.6).
const THRESHOLD = 0.5

// Per-student-number throttle (in addition to the per-IP guard): cap face-reset
// attempts so a stolen student number can't be brute-forced with many photos.
const SNUM_WINDOW_MS = 10 * 60_000
const SNUM_MAX = 5
const snumHits = new Map()
function snumLimited(docId) {
  const now = Date.now()
  const recent = (snumHits.get(docId) || []).filter(t => now - t < SNUM_WINDOW_MS)
  if (recent.length >= SNUM_MAX) return true
  recent.push(now)
  snumHits.set(docId, recent)
  if (snumHits.size > 5000) {
    for (const [k, v] of snumHits) if (!v.some(t => now - t < SNUM_WINDOW_MS)) snumHits.delete(k)
  }
  return false
}

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
  if (snumLimited(docId)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes, or ask your teacher to reset your password.' })
  }

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Face reset is not configured on the server.' })

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id

  let face
  try { face = await getStudentFace(projectId, accessToken, docId) }
  catch (e) { return res.status(502).json({ error: 'Could not look up your account: ' + e.message }) }

  if (!face) return res.status(404).json({ error: 'No student found with that number.' })
  if (!face.enabled || !Array.isArray(face.descriptor) || face.descriptor.length !== 128) {
    return res.status(400).json({ error: 'Face ID reset is not set up for this account. Ask your teacher to reset your password instead.' })
  }

  const dist = faceDistance(descriptor, face.descriptor)
  if (dist > THRESHOLD) {
    return res.status(401).json({ match: false, error: 'That face did not match. Try again in good lighting, or ask your teacher to reset your password.' })
  }

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

  // Tell the teacher (best-effort — must never block the student's reset).
  try {
    await appendAdminNotification(projectId, accessToken, {
      id: 'fr' + Date.now() + Math.random().toString(36).slice(2, 6),
      type: 'face_reset',
      title: 'Face ID password reset',
      body: `${face.name || docId} reset their password with Face ID`,
      link: 'students',
      ts: Date.now(),
    })
  } catch {}

  return res.status(200).json({ tempPassword, match: true })
}
