// ── Admin: permanent student deletion (server-only purge) ───────────────────
// The client already wipes every Firestore collection it can reach (grades live
// on the student doc, plus quizzes/activities/announcements/attendance/messages/
// feedback/excuses/pushTokens - see fbPurgeStudentData). This endpoint handles
// only what the browser CANNOT touch, so a re-enrolled student number starts with
// a truly clean slate:
//   1. the Firebase Auth account ({snum}@acadflow.app) - else the old login still
//      works and createUserWithEmailAndPassword collides on re-create,
//   2. the server-only faceSignatures/{snum} descriptor,
//   3. a backstop delete of students/{snum} + notifications/{snum}.
// It also appends an audit entry.
//
// Request body: { idToken, studentNumber }
// Response: { ok, auth, face } | { error }
//
// Degrades gracefully: with no service account configured it returns 501 and the
// client keeps the (best-effort) Firestore purge it already did, warning the
// professor that the sign-in account and Face ID data still need the server.

import { guard } from './_guard.js'
import {
  ADMIN_EMAIL, studentEmail, studentDocId,
  loadServiceAccount, getAccessToken, requireUser,
  lookupLocalId, deleteAuthUser, deleteFaceSignature,
} from './_fbadmin.js'

function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
}

// Best-effort DELETE of a Firestore doc by path. A missing doc (404) is success.
async function deleteDocPath(projectId, accessToken, path) {
  const r = await fetch(`${fsBase(projectId)}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok && r.status !== 404) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d?.error?.message || `Delete ${path} failed`)
  }
  return true
}

export default async function handler(req, res) {
  if (guard(req, res, { max: 30 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Student deletion is not configured on the server.' })

  // Must be a valid Firebase session, AND it must be the professor (admin).
  const user = await requireUser(req, res)
  if (!user) return
  if (String(user.email || '').toLowerCase() !== String(ADMIN_EMAIL).toLowerCase()) {
    return res.status(403).json({ error: 'Only the professor can delete a student.' })
  }

  const { studentNumber } = req.body || {}
  if (!studentNumber) return res.status(400).json({ error: 'Missing student number.' })

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id
  const docId = studentDocId(studentNumber)

  // Each step is independent and best-effort; we report what landed so the client
  // can warn precisely rather than failing the whole delete on one sub-error.
  let auth = false, face = false
  const errors = []

  // 1. Firebase Auth account (the critical "email already in use" / stale-login fix).
  try {
    const localId = await lookupLocalId(projectId, accessToken, studentEmail(studentNumber))
    if (localId) { await deleteAuthUser(projectId, accessToken, localId); auth = true }
    else { auth = true } // no account existed - nothing to free
  } catch (e) { errors.push('auth: ' + e.message) }

  // 2. Server-only face signature.
  try { await deleteFaceSignature(projectId, accessToken, docId); face = true }
  catch (e) { errors.push('face: ' + e.message) }

  // 3. Backstop the two id-keyed docs the client should also have removed.
  try { await deleteDocPath(projectId, accessToken, `students/${encodeURIComponent(docId)}`) }
  catch (e) { errors.push('student: ' + e.message) }
  try { await deleteDocPath(projectId, accessToken, `notifications/${encodeURIComponent(docId)}`) }
  catch (e) { errors.push('notifications: ' + e.message) }

  return res.status(200).json({ ok: true, auth, face, errors })
}
