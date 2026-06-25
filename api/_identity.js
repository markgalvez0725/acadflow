// ── Server-side identity scorer (authoritative gate) ──────────────────────
// Dependency-free mirror of src/utils/identityVerify.js. This is the version
// that actually decides whether a self-registration is auto-verified — it runs
// on the server with the Admin SDK so a student's browser can never forge the
// result. Keep the algorithm in sync with the client copy (the client one is
// advisory: instant UX + the teacher's review detail).

export const STRONG = 85
export const PARTIAL = 60

const lc = v => (v == null ? '' : String(v)).trim().toLowerCase().replace(/\s+/g, ' ')
const normName    = v => lc(v).replace(/\s*,\s*/g, ', ')
const normSection = v => lc(v).replace(/[\s\-_]/g, '')
const yearDigit   = v => { const m = String(v ?? '').match(/(\d)/); return m ? m[1] : null }

function levRatio(a, b) {
  a = a || ''; b = b || ''
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const m = a.length, n = b.length
  let prev = new Array(n + 1)
  let cur = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const t = prev; prev = cur; cur = t
  }
  return 1 - prev[n] / Math.max(m, n)
}

export function scoreIdentity(entered = {}, roster = {}) {
  const fieldScore = (key) => {
    const rv = roster[key]
    if (rv == null || String(rv).trim() === '') return null
    if (key === 'name')    return levRatio(normName(entered.name), normName(rv))
    if (key === 'course')  return lc(entered.course) === lc(rv) ? 1 : levRatio(lc(entered.course), lc(rv))
    if (key === 'year')    return (yearDigit(roster.year) && yearDigit(entered.year) === yearDigit(roster.year)) ? 1 : 0
    if (key === 'section') return normSection(entered.section) === normSection(rv) ? 1 : levRatio(normSection(entered.section), normSection(rv))
    return null
  }
  const WEIGHTS = { name: 0.45, course: 0.20, year: 0.15, section: 0.20 }
  const fields = {}
  let weighted = 0, totalWeight = 0
  for (const key of Object.keys(WEIGHTS)) {
    const sc = fieldScore(key)
    if (sc == null) continue
    fields[key] = Math.round(sc * 100)
    weighted += sc * WEIGHTS[key]
    totalWeight += WEIGHTS[key]
  }
  if (totalWeight === 0) return { confidence: null, verdict: 'review', fields }
  const confidence = Math.round((weighted / totalWeight) * 100)
  const verdict = confidence >= STRONG ? 'auto' : confidence >= PARTIAL ? 'review' : 'block'
  return { confidence, verdict, fields }
}
