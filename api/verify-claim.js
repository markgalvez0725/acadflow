// ── Student: verify a first-login provisioning claim, server-side ──────────
// On first sign-in of a professor-provisioned account, the client creates the
// Firebase Auth user from the entered password, then asks THIS endpoint whether
// that password matches the roster's temp-password hash. Verifying server-side
// means the browser never reads account.pass (closing the firestore.rules C1 gap
// where any signed-in student can read every student's password hash) and avoids
// the auth-token-propagation race a client-side roster read suffers.
//
// Anti-abuse: the caller must present the ID token of the freshly-created account
// and it must match studentEmail(studentNumber), so this can't be used to probe
// another student's hash. Rate-limited on top of that.
//
// Request body:  { studentNumber, password, idToken }
// Response:      { legit: boolean } | { error: string }

import { createHash, timingSafeEqual } from 'node:crypto'
import { guard } from './_guard.js'
import {
  studentEmail, studentDocId,
  loadServiceAccount, getAccessToken,
  verifyIdToken, getStudentClaimSecret,
} from './_fbadmin.js'

// Mirror the client's hashPassword (src/utils/crypto.js): SHA-256 of a fixed
// salt + value. Salt is not a secret; it only has to match.
const PASS_SALT = '1MXiaxEkgBLYRSXJRY28Dg=='
function sha256Hex(value) {
  return createHash('sha256').update(PASS_SALT + value).digest('hex')
}
function verifyHash(input, stored) {
  if (!stored) return false
  if (stored.length === 64 && /^[0-9a-f]{64}$/.test(stored)) {
    const a = Buffer.from(sha256Hex(input), 'utf8')
    const b = Buffer.from(stored, 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  }
  if (stored.includes('=')) return Buffer.from(input, 'utf8').toString('base64') === stored
  return input === stored
}

export default async function handler(req, res) {
  if (guard(req, res, { max: 10 })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sa = loadServiceAccount()
  if (!sa) return res.status(501).json({ error: 'Account verification is not configured on the server.' })

  const { studentNumber, password, idToken } = req.body || {}
  if (!studentNumber || !password || !idToken) return res.status(400).json({ error: 'Missing student number, password, or session.' })

  const projectId = sa.project_id

  // The caller must BE the account they're claiming (they just created the Auth
  // user with this password). Without this the endpoint would be a password
  // oracle for any unclaimed student number.
  let decoded
  try { decoded = await verifyIdToken(idToken, projectId) }
  catch (e) { return res.status(401).json({ error: 'Invalid session.' }) }
  if (String(decoded.email || '').toLowerCase() !== studentEmail(studentNumber).toLowerCase()) {
    return res.status(403).json({ error: 'Session does not match this student.' })
  }

  let accessToken
  try { accessToken = await getAccessToken(sa) }
  catch (e) { return res.status(502).json({ error: 'Server could not authenticate with Firebase: ' + e.message }) }

  let secret
  try { secret = await getStudentClaimSecret(projectId, accessToken, studentDocId(studentNumber)) }
  catch (e) { return res.status(502).json({ error: 'Could not read the account: ' + e.message }) }

  // A claim is legitimate only for a registered, still-on-temp-password account
  // whose stored hash matches the entered password.
  const legit = !!(secret && secret.registered && secret.tempPass && secret.pass && verifyHash(password, secret.pass))
  return res.status(200).json({ legit })
}
