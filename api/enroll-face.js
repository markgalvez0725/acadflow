// ── Student: enroll a face signature for self-service password reset ───────
// The student's own device computes a 128-number face descriptor on-device
// (face-api.js) and posts it here. This endpoint verifies the caller IS that
// student (their Firebase ID token), then writes the signature to the student
// doc via the Admin API. The descriptor field is server-only by Firestore rule,
// so it can't be forged from the browser. Only the math vector is stored — never
// the face image, which never leaves the device.
//
// Request body: { idToken: string, descriptor: number[128] }
// Response: { ok: true } | { error: string }

import { guard } from './_guard.js'
import {
  requireUser, studentDocId,
  loadServiceAccount, getAccessToken,
  getStudentFace, patchStudentFace,
} from './_fbadmin.js'

export default async function handler(req, res) {
  if (guard(req, res, { max: 15 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Must be a signed-in student. We enroll only for THE CALLER'S own record,
  // derived from their token email (<studentNumber>@acadflow.app).
  const user = await requireUser(req, res)
  if (!user) return
  const email = String(user.email || '').toLowerCase()
  if (!email.endsWith('@acadflow.app')) {
    return res.status(403).json({ error: 'Only student accounts can enroll a face.' })
  }
  const snum = email.slice(0, -'@acadflow.app'.length)
  const docId = studentDocId(snum)

  const { descriptor } = req.body || {}
  if (!Array.isArray(descriptor) || descriptor.length !== 128
      || !descriptor.every(n => Number.isFinite(n) && Math.abs(n) < 10)) {
    return res.status(400).json({ error: 'Invalid face data. Please try the scan again.' })
  }

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Face enrollment is not configured on the server.' })

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id

  // Confirm the student record exists before writing.
  let existing
  try { existing = await getStudentFace(projectId, accessToken, docId) }
  catch (e) { return res.status(502).json({ error: 'Lookup error: ' + e.message }) }
  if (!existing) return res.status(404).json({ error: 'Student record not found.' })

  try { await patchStudentFace(projectId, accessToken, docId, { descriptor }) }
  catch (e) { return res.status(502).json({ error: 'Could not save your face signature: ' + e.message }) }

  return res.status(200).json({ ok: true })
}
