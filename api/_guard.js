// ── Lightweight endpoint guard: CORS allowlist + per-IP rate limiting ──────
// Files prefixed with "_" are not treated as routes by Vercel, so this is a
// shared helper. No external dependencies. The rate-limit store is in-memory
// (per serverless instance) — best-effort throttling that meaningfully caps
// abuse without needing Redis. Same-origin client requests are unaffected.

const WINDOW_MS = 60_000
const hits = new Map() // ip -> number[] (recent request timestamps)

// Exact origins always allowed; plus any *.vercel.app preview/prod domain.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
]

function isAllowedOrigin(origin) {
  if (!origin) return false
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    return /\.vercel\.app$/.test(new URL(origin).hostname)
  } catch {
    return false
  }
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

// Sets CORS headers and answers preflight. Returns true if the request was a
// handled OPTIONS preflight (caller should return immediately).
export function applyCors(req, res) {
  const origin = req.headers.origin
  if (isAllowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return true }
  return false
}

// Per-IP rate limit. Returns true if the request should be BLOCKED.
export function rateLimited(req, res, max = 20) {
  const ip = clientIp(req)
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS)
  if (recent.length >= max) {
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: 'Too many requests. Please slow down and try again in a minute.' })
    return true
  }
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k)
  }
  return false
}

// Combined guard. Returns true when the request is fully handled (preflight) or
// blocked (rate limit); the caller should `return` immediately in that case.
export function guard(req, res, { max = 20 } = {}) {
  if (applyCors(req, res)) return true
  if (rateLimited(req, res, max)) return true
  return false
}
