// ── Student: claim a one-time sign-in token during an open reset window ────
// Called (polled) by the student's own device after they enter their student
// number on the Forgot Password screen. While the professor has an open reset
// window for that student, the FIRST successful claim mints a one-time custom
// sign-in token, closes the window (one-time use), and returns it so the device
// can sign in. IMPORTANT: this does NOT change the student's password - their
// current password stays valid until they deliberately set a new one. A window
// that's opened but never completed therefore changes nothing. If no window is
// open yet, responds { pending }.
//
// Request body: { studentNumber: string }
// Response: { customToken: string } | { pending: true } | { error: string }

import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken,
  lookupLocalId, mintCustomToken,
  getResetSession, deleteResetSession,
} from './_fbadmin.js'

export default async function handler(req, res) {
  if (guard(req, res, { max: 40 })) return // polled, so a higher ceiling
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Password reset is not configured on the server.' })

  const { studentNumber } = req.body || {}
  if (!studentNumber) return res.status(400).json({ error: 'Missing student number.' })

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id
  const docId = studentDocId(studentNumber)

  // Is there an open, unexpired window for this student?
  let session
  try { session = await getResetSession(projectId, accessToken, docId) }
  catch (e) { return res.status(502).json({ error: 'Could not check reset status: ' + e.message }) }

  if (!session || !session.authorized) return res.status(200).json({ pending: true })
  if (Date.now() > session.expiresAt) {
    // Expired - clean up and report no active window.
    try { await deleteResetSession(projectId, accessToken, docId) } catch {}
    return res.status(200).json({ pending: true, expired: true })
  }

  // Close the window first (one-time use) to avoid double-claims.
  try { await deleteResetSession(projectId, accessToken, docId) } catch {}

  // Find the account and mint a one-time sign-in token. The password is NOT
  // changed here - the student keeps their current password until they choose a
  // new one, so a reset window that's opened but never completed is harmless.
  let localId
  try {
    localId = await lookupLocalId(projectId, accessToken, studentEmail(studentNumber))
    if (!localId) return res.status(404).json({ error: 'No login account exists for this student.' })
  } catch (e) {
    return res.status(502).json({ error: 'Lookup error: ' + e.message })
  }

  let customToken
  try {
    customToken = mintCustomToken(sa, localId)
  } catch (e) {
    return res.status(502).json({ error: 'Could not create a sign-in token: ' + e.message })
  }

  return res.status(200).json({ customToken })
}
