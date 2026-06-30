// ── Shared Firebase Admin helpers (dependency-free) ───────────────────────
// Used by the professor-coordinated password reset endpoints. Builds a Google
// OAuth access token from the project's service account, verifies Firebase ID
// tokens, and talks to the Identity Toolkit Admin API + Firestore REST API.
//
// Setup (one-time): Firebase Console → Project settings → Service accounts →
// Generate new private key. In Vercel → Settings → Environment Variables add
//   FB_ADMIN_SERVICE_ACCOUNT = <the full JSON string>
// (Falls back to FCM_SERVICE_ACCOUNT - the same project service account works
//  for both, so you can reuse the one already set up for push.)

import crypto from 'crypto'

export const ADMIN_EMAIL = 'markgalvez@ucc-caloocan.edu.ph'

// ── Identity helpers (mirror src/constants/auth.js) ───────────────────────
export function studentEmail(snum) {
  return String(snum || '').trim().toLowerCase().replace(/\s+/g, '') + '@acadflow.app'
}
export function studentDocId(snum) {
  return String(snum || '').trim().toUpperCase()
}

// ── Service account + Google OAuth access token ───────────────────────────
function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function loadServiceAccount() {
  const raw = process.env.FB_ADMIN_SERVICE_ACCOUNT || process.env.FCM_SERVICE_ACCOUNT
  if (!raw) return null
  try {
    const sa = JSON.parse(raw)
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null
    return sa
  } catch { return null }
}

let _cachedToken = null // { token, exp }

export async function getAccessToken(sa) {
  if (_cachedToken && Date.now() < _cachedToken.exp - 60_000) return _cachedToken.token

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    // cloud-platform covers both Identity Toolkit (Auth admin) and Firestore.
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const signature = signer.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${header}.${claim}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error_description || 'token exchange failed')
  _cachedToken = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 }
  return _cachedToken.token
}

// Mint a Firebase custom token (RS256, signed by the service account) for a uid.
// signInWithCustomToken() on the client establishes a session WITHOUT touching
// the account password - so a reset never destroys the student's current
// password; it only changes when they deliberately set a new one afterwards.
export function mintCustomToken(sa, uid) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid: String(uid),
  }))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const signature = signer.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${header}.${payload}.${signature}`
}

// ── Firebase ID token verification (RS256 against Google's x509 certs) ─────
function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Buffer.from(s, 'base64')
}

let _certs = null // { keys, exp }
async function getGoogleCerts() {
  if (_certs && Date.now() < _certs.exp) return _certs.keys
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com')
  const keys = await r.json()
  const cc = r.headers.get('cache-control') || ''
  const m = cc.match(/max-age=(\d+)/)
  const ttl = m ? parseInt(m[1], 10) * 1000 : 3_600_000
  _certs = { keys, exp: Date.now() + ttl }
  return keys
}

export async function verifyIdToken(idToken, projectId) {
  const parts = String(idToken || '').split('.')
  if (parts.length !== 3) throw new Error('Malformed token')

  const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'))
  const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'))
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm')

  const certs = await getGoogleCerts()
  const pem = certs[header.kid]
  if (!pem) throw new Error('Unknown signing key')

  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(`${parts[0]}.${parts[1]}`)
  if (!verifier.verify(pem, b64urlDecode(parts[2]))) throw new Error('Invalid token signature')

  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) throw new Error('Token expired')
  if (payload.iat > now + 300) throw new Error('Token issued in the future')
  if (payload.aud !== projectId) throw new Error('Token audience mismatch')
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Token issuer mismatch')
  if (!payload.sub) throw new Error('Token has no subject')
  return payload
}

// ── App-user authentication (any signed-in admin OR student) ──────────────
// The known project id, used as a last-resort fallback so token verification
// never fails open just because an env var or service account is missing.
const FALLBACK_PROJECT_ID = 'collegeportal-d2b98'

// Resolve the Firebase project id from env → service account → hardcoded.
export function resolveProjectId() {
  return process.env.FB_PROJECT_ID
    || loadServiceAccount()?.project_id
    || FALLBACK_PROJECT_ID
}

// Pull the ID token from { idToken } in the body or an Authorization header.
export function extractIdToken(req) {
  const fromBody = req.body && typeof req.body.idToken === 'string' ? req.body.idToken : ''
  if (fromBody) return fromBody
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(String(h))
  return m ? m[1] : ''
}

// Require a valid Firebase session for this project. On failure, writes a 401
// and returns null (caller should `return` immediately). On success returns
// the decoded token payload (contains email, sub, etc.).
export async function requireUser(req, res) {
  const idToken = extractIdToken(req)
  if (!idToken) { res.status(401).json({ error: 'Sign in required' }); return null }
  try {
    return await verifyIdToken(idToken, resolveProjectId())
  } catch {
    res.status(401).json({ error: 'Your session is invalid or has expired. Please sign in again.' })
    return null
  }
}

// ── Identity Toolkit Admin (Auth) ─────────────────────────────────────────
export async function lookupLocalId(projectId, accessToken, email) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email: [email] }),
    }
  )
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Lookup failed')
  return data?.users?.[0]?.localId || null
}

export async function setPassword(projectId, accessToken, localId, password) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ localId, password }),
    }
  )
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Password update failed')
  return true
}

// Permanently delete a Firebase Auth account by its localId. This is what frees
// the synthetic email ({snum}@acadflow.app) so the same student number can be
// re-enrolled from scratch without an "email already in use" collision or the
// old password still working. Idempotent-ish: a missing account is treated as
// already gone (Identity Toolkit returns the deleted ids, never 404 by uid).
export async function deleteAuthUser(projectId, accessToken, localId) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ localId }),
    }
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data?.error?.message || 'Auth account delete failed')
  return true
}

// ── Firestore REST (server-side, bypasses security rules) ─────────────────
function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
}

// Read a resetSessions/{docId} doc → { authorized, expiresAt } or null.
export async function getResetSession(projectId, accessToken, docId) {
  const r = await fetch(`${fsBase(projectId)}/resetSessions/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (r.status === 404) return null
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Session read failed')
  const f = data.fields || {}
  return {
    authorized: f.authorized?.booleanValue === true,
    expiresAt: Number(f.expiresAt?.integerValue || 0),
  }
}

// Create/overwrite resetSessions/{docId}.
export async function putResetSession(projectId, accessToken, docId, expiresAt) {
  const r = await fetch(`${fsBase(projectId)}/resetSessions/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      fields: {
        authorized: { booleanValue: true },
        expiresAt: { integerValue: String(expiresAt) },
        createdAt: { integerValue: String(Date.now()) },
      },
    }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Session write failed')
  return true
}

export async function deleteResetSession(projectId, accessToken, docId) {
  const r = await fetch(`${fsBase(projectId)}/resetSessions/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // 200 or 404 both fine (already gone)
  if (!r.ok && r.status !== 404) {
    const data = await r.json().catch(() => ({}))
    throw new Error(data?.error?.message || 'Session delete failed')
  }
  return true
}

// Read a students/{docId} roster doc → { name, course, year, section, account }
// (only the fields the identity scorer needs). null if the doc doesn't exist.
export async function getStudentRoster(projectId, accessToken, docId) {
  const r = await fetch(`${fsBase(projectId)}/students/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (r.status === 404) return null
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Student read failed')
  const f = data.fields || {}
  const str = x => (x && typeof x.stringValue === 'string') ? x.stringValue : null
  const acct = f.account?.mapValue?.fields || {}
  return {
    name: str(f.name), course: str(f.course), year: str(f.year), section: str(f.section),
    account: {
      registered: acct.registered?.booleanValue === true,
      verified: acct.verified?.booleanValue,
    },
  }
}

// Read one string field from the server-only studentSecrets/{docId} doc, or null.
// This collection holds the secrets (pass / securityAnswer) once migrated out of
// the student doc; it is never client-readable (denied by rules).
export async function getSecretField(projectId, accessToken, docId, field) {
  const r = await fetch(`${fsBase(projectId)}/studentSecrets/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) return null // 404 (not migrated yet) or any error → caller falls back
  const data = await r.json()
  const v = data.fields?.[field]
  return (v && typeof v.stringValue === 'string') ? v.stringValue : null
}

// Merge one or more string fields into studentSecrets/{docId} (creates the doc if
// absent). updateMask means only the named fields are touched, so writing the
// security answer never clobbers the password hash and vice-versa.
export async function writeSecretFields(projectId, accessToken, docId, fields) {
  const keys = Object.keys(fields)
  if (!keys.length) return true
  const restFields = {}
  for (const k of keys) restFields[k] = { stringValue: String(fields[k]) }
  const mask = keys.map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&')
  const r = await fetch(`${fsBase(projectId)}/studentSecrets/${encodeURIComponent(docId)}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: restFields }),
  })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error?.message || 'Secret write failed') }
  return true
}

// Read the hashed self-service reset answer for one student, server-side. Prefers
// the server-only studentSecrets doc; falls back to the legacy account.securityAnswer
// on the student doc for accounts not yet migrated. Returns the hash, or null.
export async function getStudentSecurityAnswer(projectId, accessToken, docId) {
  const fromSecret = await getSecretField(projectId, accessToken, docId, 'securityAnswer')
  if (fromSecret) return fromSecret
  const r = await fetch(`${fsBase(projectId)}/students/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (r.status === 404) return null
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Student read failed')
  const acct = data.fields?.account?.mapValue?.fields || {}
  const ans = acct.securityAnswer
  return (ans && typeof ans.stringValue === 'string') ? ans.stringValue : null
}

// Read the fields needed to verify a provisioning claim, server-side: the temp
// password hash (preferring studentSecrets, falling back to the legacy
// account.pass) plus the registered / _tempPass flags (which stay on the student
// doc - they aren't secrets). Lets first sign-in verify WITHOUT the browser
// reading account.pass.
export async function getStudentClaimSecret(projectId, accessToken, docId) {
  const r = await fetch(`${fsBase(projectId)}/students/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (r.status === 404) return null
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Student read failed')
  const acct = data.fields?.account?.mapValue?.fields || {}
  const str = x => (x && typeof x.stringValue === 'string') ? x.stringValue : null
  const secretPass = await getSecretField(projectId, accessToken, docId, 'pass')
  return {
    pass: secretPass || str(acct.pass),
    registered: acct.registered?.booleanValue === true,
    tempPass: acct._tempPass?.booleanValue === true,
  }
}

// Set account.verified + account.verification on a student doc (admin write,
// bypasses rules). Uses field-path masks so the rest of the account map is kept.
export async function patchStudentVerification(projectId, accessToken, docId, { verified, verification }) {
  const vfFields = {}
  for (const k of ['name', 'course', 'year', 'section']) {
    if (verification?.fields && verification.fields[k] != null) {
      vfFields[k] = { integerValue: String(verification.fields[k]) }
    }
  }
  const verificationValue = {
    mapValue: { fields: {
      method: { stringValue: String(verification?.method || 'ai') },
      confidence: { integerValue: String(verification?.confidence ?? 0) },
      at: { integerValue: String(verification?.at ?? Date.now()) },
      fields: { mapValue: { fields: vfFields } },
    } },
  }
  const url = `${fsBase(projectId)}/students/${encodeURIComponent(docId)}`
    + `?updateMask.fieldPaths=account.verified&updateMask.fieldPaths=account.verification`
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: { account: { mapValue: { fields: {
      verified: { booleanValue: !!verified },
      verification: verificationValue,
    } } } } }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Verification write failed')
  return true
}

// ── Face-ID recovery (server-side enrollment + match) ─────────────────────
// The face signature lives in its OWN collection, faceSignatures/{docId}, which
// is unmatched in firestore.rules → DENIED to all clients (only the service
// account, which bypasses rules, can read/write it). This is deliberate:
//   • clients can never READ a descriptor (so it can't be replayed), and
//   • clients can never WRITE one (no forging / account takeover), and
//   • the student doc no longer round-trips a 128-number array through full-doc
//     setDoc saves (which previously risked intermittent rule-denials).
// The student doc keeps only a cheap boolean `account.faceResetEnabled` for UI.

// Read the enrolled signature + recent-attempt timestamps. null if not enrolled.
export async function getFaceSignature(projectId, accessToken, docId) {
  const r = await fetch(`${fsBase(projectId)}/faceSignatures/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (r.status === 404) return null
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Face signature read failed')
  const f = data.fields || {}
  const dv = f.descriptor?.arrayValue?.values
  const descriptor = Array.isArray(dv) ? dv.map(v => Number(v.doubleValue ?? v.integerValue ?? 0)) : null
  const rv = f.rl?.arrayValue?.values
  const rl = Array.isArray(rv) ? rv.map(v => Number(v.integerValue ?? 0)) : []
  return { descriptor, rl, enrolledAt: Number(f.enrolledAt?.integerValue || 0) }
}

// Back-compat: read a descriptor from the LEGACY location (account.face on the
// student doc) used by the very first builds, before signatures were moved to
// the server-only collection. Returns number[]|null. Used only as a fallback so
// students who enrolled early aren't stranded (their attempt is migrated).
export async function getLegacyFaceDescriptor(projectId, accessToken, docId) {
  const r = await fetch(`${fsBase(projectId)}/students/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) return null
  const data = await r.json()
  const acct = data.fields?.account?.mapValue?.fields || {}
  const vals = acct.face?.mapValue?.fields?.descriptor?.arrayValue?.values
  if (!Array.isArray(vals)) return null
  return vals.map(v => Number(v.doubleValue ?? v.integerValue ?? 0))
}

// Permanently delete the server-only face signature for a student. Used by the
// cascade delete so a re-enrolled student number starts with no enrolled face.
export async function deleteFaceSignature(projectId, accessToken, docId) {
  const r = await fetch(`${fsBase(projectId)}/faceSignatures/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok && r.status !== 404) {
    const data = await r.json().catch(() => ({}))
    throw new Error(data?.error?.message || 'Face signature delete failed')
  }
  return true
}

// Write/replace the signature doc (resets the throttle window on re-enroll).
export async function writeFaceSignature(projectId, accessToken, docId, descriptor) {
  const values = descriptor.map(n => ({ doubleValue: Number(n) }))
  const r = await fetch(`${fsBase(projectId)}/faceSignatures/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: {
      descriptor: { arrayValue: { values } },
      enrolledAt: { integerValue: String(Date.now()) },
      version:    { integerValue: '1' },
      rl:         { arrayValue: { values: [] } },
    } }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Face signature write failed')
  return true
}

// Persist the windowed attempt timestamps (cross-instance rate limiting).
export async function patchFaceThrottle(projectId, accessToken, docId, rl) {
  const values = rl.map(t => ({ integerValue: String(t) }))
  const url = `${fsBase(projectId)}/faceSignatures/${encodeURIComponent(docId)}?updateMask.fieldPaths=rl`
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: { rl: { arrayValue: { values } } } }),
  }).catch(() => {}) // best-effort - never block a legitimate reset on a throttle write
  return true
}

// Flip the student doc's UI-only faceResetEnabled flag (server authority).
export async function setFaceResetFlag(projectId, accessToken, docId, on) {
  const url = `${fsBase(projectId)}/students/${encodeURIComponent(docId)}?updateMask.fieldPaths=account.faceResetEnabled`
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: { account: { mapValue: { fields: {
      faceResetEnabled: { booleanValue: !!on },
    } } } } }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'Flag write failed')
  return true
}

// Append a notification to notifications/admin (newest-first, capped). Best-effort
// read-modify-write - existing items are preserved as raw Firestore values.
export async function appendAdminNotification(projectId, accessToken, notif) {
  const url = `${fsBase(projectId)}/notifications/admin`
  let items = []
  const rg = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (rg.ok) {
    const data = await rg.json()
    items = data.fields?.items?.arrayValue?.values || []
  }
  const notifValue = { mapValue: { fields: {
    id:    { stringValue: String(notif.id) },
    type:  { stringValue: String(notif.type) },
    title: { stringValue: String(notif.title) },
    body:  { stringValue: String(notif.body || '') },
    link:  { stringValue: String(notif.link || '') },
    read:  { booleanValue: false },
    ts:    { integerValue: String(notif.ts || Date.now()) },
  } } }
  const next = [notifValue, ...items].slice(0, 200)
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: { items: { arrayValue: { values: next } } } }),
  })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error?.message || 'Notif write failed') }
  return true
}

// Append an append-only audit-log doc (matches the client fbAddAuditLog shape so
// the professor's Audit Log tab renders it). Best-effort.
export async function appendAuditLog(projectId, accessToken, entry) {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const r = await fetch(`${fsBase(projectId)}/auditLog/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: {
      id:      { stringValue: id },
      ts:      { integerValue: String(Date.now()) },
      actor:   { stringValue: String(entry.actor || 'system') },
      action:  { stringValue: String(entry.action || 'unknown') },
      target:  { stringValue: String(entry.target || '') },
      summary: { stringValue: String(entry.summary || '') },
      meta:    { mapValue: { fields: {} } },
    } }),
  })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error?.message || 'Audit write failed') }
  return true
}

// Euclidean distance between two equal-length descriptors (lower = more similar;
// face-api's 128-d descriptors match below ~0.5-0.6).
export function faceDistance(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d }
  return Math.sqrt(sum)
}

// ── Temp password generator (policy: 8 chars, upper + lower + digit) ───────
export function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digit = '23456789'
  const all = upper + lower + digit
  const pick = (set) => set[crypto.randomInt(0, set.length)]
  const chars = [pick(upper), pick(lower), pick(digit)]
  while (chars.length < 8) chars.push(pick(all))
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
