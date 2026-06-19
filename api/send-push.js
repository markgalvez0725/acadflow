// ── Web Push sender (Firebase Cloud Messaging HTTP v1) ────────────────────
// Vercel serverless function. Dependency-free: builds a Google OAuth JWT with
// Node's built-in crypto, exchanges it for an access token, then sends a
// notification to each provided FCM token.
//
// Setup (one-time):
//   1. Firebase Console → Project settings → Service accounts → Generate new
//      private key. Copy the JSON.
//   2. In Vercel → Project → Settings → Environment Variables add
//      FCM_SERVICE_ACCOUNT = <the full JSON string>.
//
// Request body: { tokens: string[], notification: { title, body }, data?: {} }
import crypto from 'crypto'

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

let _cachedToken = null // { token, exp }

async function getAccessToken(sa) {
  if (_cachedToken && Date.now() < _cachedToken.exp - 60000) return _cachedToken.token

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const raw = process.env.FCM_SERVICE_ACCOUNT
  if (!raw) return res.status(501).json({ error: 'Push not configured (FCM_SERVICE_ACCOUNT missing)' })

  let sa
  try { sa = typeof raw === 'string' ? JSON.parse(raw) : raw }
  catch { return res.status(500).json({ error: 'Invalid FCM_SERVICE_ACCOUNT JSON' }) }

  const { tokens = [], notification = {}, data = {} } = req.body || {}
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return res.status(400).json({ error: 'No tokens provided' })
  }

  let accessToken
  try {
    accessToken = await getAccessToken(sa)
  } catch (e) {
    return res.status(502).json({ error: 'Auth failed: ' + e.message })
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`
  const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))

  const results = await Promise.allSettled(
    tokens.slice(0, 500).map((token) =>
      fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: notification.title || 'AcadFlow', body: notification.body || '' },
            data: stringData,
            webpush: {
              notification: { icon: '/icon-192.png', badge: '/icon-192.png' },
              fcmOptions: data.url ? { link: data.url } : undefined,
            },
          },
        }),
      }).then((r) => r.ok)
    )
  )

  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length
  res.status(200).json({ sent, total: tokens.length })
}
