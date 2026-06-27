// ── Teacher: open a password-reset session for one student ────────────────
// The teacher (verified by their Firebase ID token) authorises a short-lived
// reset window for a specific student. No password is generated here - the
// student's own device claims a fresh temporary password via /api/claim-reset
// while the window is open. This keeps any temporary password off the teacher
// screen and out of long-term storage.
//
// Request body: { idToken: string, studentNumber: string }
// Response: { ok: true, expiresAt: number } | { error: string }

import { guard } from './_guard.js'
import {
  ADMIN_EMAIL, studentEmail, studentDocId,
  loadServiceAccount, getAccessToken, verifyIdToken,
  lookupLocalId, putResetSession,
} from './_fbadmin.js'

const WINDOW_MS = 10 * 60_000 // 10 minutes

export default async function handler(req, res) {
  if (guard(req, res, { max: 15 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Password reset is not configured on the server (missing FB_ADMIN_SERVICE_ACCOUNT).' })

  const { idToken, studentNumber } = req.body || {}
  if (!idToken)       return res.status(401).json({ error: 'Missing admin authentication.' })
  if (!studentNumber) return res.status(400).json({ error: 'Missing student number.' })

  // Authorise the caller (must be the teacher).
  let claims
  try {
    claims = await verifyIdToken(idToken, sa.project_id)
  } catch {
    return res.status(401).json({ error: 'Could not verify your session. Sign out and back in, then try again.' })
  }
  if (String(claims.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Only the teacher account can reset student passwords.' })
  }

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id
  const docId = studentDocId(studentNumber)

  // Confirm the student actually has a login account before opening a window.
  try {
    const localId = await lookupLocalId(projectId, accessToken, studentEmail(studentNumber))
    if (!localId) {
      return res.status(404).json({ error: 'No login account exists for this student yet. They need to register/claim their account first.' })
    }
  } catch (e) {
    return res.status(502).json({ error: 'Lookup error: ' + e.message })
  }

  const expiresAt = Date.now() + WINDOW_MS
  try {
    await putResetSession(projectId, accessToken, docId, expiresAt)
  } catch (e) {
    return res.status(502).json({ error: 'Could not open reset session: ' + e.message })
  }

  return res.status(200).json({ ok: true, expiresAt })
}
