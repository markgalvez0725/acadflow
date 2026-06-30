// ── Student: store the security-question answer in the server-only secret store ─
// The answer hash is sensitive (it gates self-service password reset), so it must
// not live in the broadly-readable student doc. The student sets it while signed
// in, so this endpoint authenticates them by their ID token and writes the hash to
// studentSecrets/{id} (which the client cannot write directly). The non-secret
// QUESTION key stays on the student doc, written by the client.
//
// Request body:  { studentNumber, answer, idToken }   (answer = raw, normalized here)
// Response:      { ok: true } | { error: string }

import { createHash } from 'node:crypto'
import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken,
  verifyIdToken, writeSecretFields,
} from './_fbadmin.js'

// Mirror the client's hashPassword so the answer hashes identically on both sides.
const PASS_SALT = '1MXiaxEkgBLYRSXJRY28Dg=='
function sha256Hex(value) {
  return createHash('sha256').update(PASS_SALT + value).digest('hex')
}

export default async function handler(req, res) {
  if (guard(req, res, { max: 15 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Security questions are not configured on the server.' })

  const { studentNumber, answer, idToken } = req.body || {}
  if (!studentNumber || !answer || !idToken) return res.status(400).json({ error: 'Missing student number, answer, or session.' })

  const projectId = sa.project_id

  // The caller must be the student whose answer they're setting.
  let decoded
  try { decoded = await verifyIdToken(idToken, projectId) }
  catch (e) { return res.status(401).json({ error: 'Invalid session.' }) }
  if (String(decoded.email || '').toLowerCase() !== studentEmail(studentNumber).toLowerCase()) {
    return res.status(403).json({ error: 'Session does not match this student.' })
  }

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const hashed = sha256Hex(String(answer).trim().toLowerCase())
  try { await writeSecretFields(projectId, accessToken, studentDocId(studentNumber), { securityAnswer: hashed }) }
  catch (e) { return res.status(502).json({ error: 'Could not save the security answer: ' + e.message }) }

  return res.status(200).json({ ok: true })
}
