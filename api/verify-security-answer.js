// ── Student: self-service password reset via the security question ─────────
// Verifies the student's security answer SERVER-SIDE (so the stored answer hash
// never has to be read in the browser) and, on a match, resets the real Firebase
// Auth password directly via the Admin SDK. The student then signs in with their
// new password.
//
// This replaces the old on-device flow, which read account.securityAnswer in the
// browser and only wrote account.pass (a bootstrap-only field that never changed
// the actual Auth credential, so the "reset" did nothing for claimed accounts).
//
// Request body:  { studentNumber: string, answer: string, newPassword: string }
// Response:      { ok: true } | { error: string }

import { createHash, timingSafeEqual } from 'node:crypto'
import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken,
  lookupLocalId, setPassword,
  getStudentSecurityAnswer,
} from './_fbadmin.js'

// Mirror the client's hashPassword (src/utils/crypto.js): SHA-256 of a fixed
// salt + value. The salt is not a secret (it ships in the client bundle); it
// only has to match so the same answer hashes identically on both sides.
const PASS_SALT = '1MXiaxEkgBLYRSXJRY28Dg=='
function sha256Hex(value) {
  return createHash('sha256').update(PASS_SALT + value).digest('hex')
}

// Mirror verifyPassword's three storage formats (SHA-256 hex, btoa legacy,
// plaintext) so older stored answers still verify.
function verifyAnswer(input, stored) {
  if (!stored) return false
  if (stored.length === 64 && /^[0-9a-f]{64}$/.test(stored)) {
    const a = Buffer.from(sha256Hex(input), 'utf8')
    const b = Buffer.from(stored, 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  }
  if (stored.includes('=')) return Buffer.from(input, 'utf8').toString('base64') === stored
  return input === stored
}

function validPassword(p) {
  return typeof p === 'string' && p.length >= 8 && /[A-Z]/.test(p) && /[0-9]/.test(p)
}

export default async function handler(req, res) {
  if (guard(req, res, { max: 8 })) return // tight ceiling: each call is an answer guess
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Self-service reset is not configured on the server.' })

  const { studentNumber, answer, newPassword } = req.body || {}
  if (!studentNumber || !answer) return res.status(400).json({ error: 'Missing student number or answer.' })
  if (!validPassword(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter and a number.' })
  }

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  const projectId = sa.project_id
  const docId = studentDocId(studentNumber)

  // Stored answer hash (server-side read; bypasses rules).
  let stored
  try { stored = await getStudentSecurityAnswer(projectId, accessToken, docId) }
  catch (e) { return res.status(502).json({ error: 'Could not read the account: ' + e.message }) }
  if (!stored) {
    return res.status(400).json({ error: 'This account has no security question set. Ask your professor to reset your password.' })
  }

  const normalized = String(answer).trim().toLowerCase()
  if (!verifyAnswer(normalized, stored)) {
    return res.status(403).json({ error: 'Incorrect answer.' })
  }

  // Answer is correct: find the Auth account and reset its password directly.
  let localId
  try { localId = await lookupLocalId(projectId, accessToken, studentEmail(studentNumber)) }
  catch (e) { return res.status(502).json({ error: 'Lookup error: ' + e.message }) }
  if (!localId) {
    return res.status(404).json({ error: 'No login account exists yet. Use the temporary password from your professor.' })
  }

  try { await setPassword(projectId, accessToken, localId, newPassword) }
  catch (e) { return res.status(502).json({ error: 'Could not set the new password: ' + e.message }) }

  return res.status(200).json({ ok: true })
}
