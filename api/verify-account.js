// ── Student: AI identity verification at self-registration ────────────────
// Called by the student's own device right after it creates the account. The
// server re-looks-up the roster row, scores the entered identity DETERMINISTICALLY
// (so the browser can't forge it), and - only on a strong match - flips
// account.verified=true (auto-activate). Otherwise the account stays Pending for
// the professor to approve. Always records account.verification for the professor.
//
// Request body: { idToken, studentNumber, name, course, year, section }
// Response: { verified: boolean, confidence: number|null, verdict, fields } | { error }
//
// Degrades gracefully: with no service account configured it returns 501 and the
// client simply leaves the account Pending (professor approves) - never blocked.

import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken, requireUser,
  getStudentRoster, patchStudentVerification,
} from './_fbadmin.js'
import { scoreIdentity } from './_identity.js'

export default async function handler(req, res) {
  if (guard(req, res, { max: 20 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Verification is not configured on the server.' })

  // Must be a valid Firebase session (the account it just created).
  const user = await requireUser(req, res)
  if (!user) return

  const { studentNumber, name, course, year, section } = req.body || {}
  if (!studentNumber) return res.status(400).json({ error: 'Missing student number.' })

  // A student may only verify their OWN number.
  if (String(user.email || '').toLowerCase() !== studentEmail(studentNumber)) {
    return res.status(403).json({ error: 'You can only verify your own account.' })
  }

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id
  const docId = studentDocId(studentNumber)

  let roster
  try { roster = await getStudentRoster(projectId, accessToken, docId) }
  catch (e) { return res.status(502).json({ error: 'Could not read the roster: ' + e.message }) }
  if (!roster) return res.status(404).json({ error: 'Student not found on the roster.' })

  const score = scoreIdentity({ name, course, year, section }, roster)
  const verified = score.verdict === 'auto'
  const verification = { method: 'ai', confidence: score.confidence, fields: score.fields, at: Date.now() }

  try { await patchStudentVerification(projectId, accessToken, docId, { verified, verification }) }
  catch (e) { return res.status(502).json({ error: 'Could not save verification: ' + e.message }) }

  return res.status(200).json({ verified, confidence: score.confidence, verdict: score.verdict, fields: score.fields })
}
