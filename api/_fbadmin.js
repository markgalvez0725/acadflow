// ── Shared Firebase Admin helpers (dependency-free) ───────────────────────
// Used by the teacher-coordinated password reset endpoints. Builds a Google
// OAuth access token from the project's service account, verifies Firebase ID
// tokens, and talks to the Identity Toolkit Admin API + Firestore REST API.
//
// Setup (one-time): Firebase Console → Project settings → Service accounts →
// Generate new private key. In Vercel → Settings → Environment Variables add
//   FB_ADMIN_SERVICE_ACCOUNT = <the full JSON string>
// (Falls back to FCM_SERVICE_ACCOUNT — the same project service account works
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
