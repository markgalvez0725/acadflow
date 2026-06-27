// ── AI identity verification (on-device, deterministic) ────────────────────
//
// Scores how well a self-registering student's details match the roster row for
// their student number - a fuzzy, multi-signal confidence (0-100) that replaces
// the old brittle exact-match. The student NUMBER is the anchor (it locates the
// roster row upstream and must match exactly); this module scores the remaining
// identity signals (name, course, year, section) tolerantly:
//
//   • name    - normalized edit-distance similarity ("José"≈"Jose", spacing)
//   • course  - exact, else edit-distance
//   • year    - leading digit match
//   • section - separator-insensitive, else edit-distance ("2A"≈"2-A")
//
// Weights are renormalized over the fields the roster actually has, so a sparse
// roster (e.g. no course on file) is never penalized. The same algorithm runs on
// the server (api/_identity.js) where it is the authoritative gate; this copy is
// the instant, offline client score used for UX + the teacher's review detail.
//
// Pure + dependency-free. No network, no model download at registration.

export const STRONG = 85   // ≥ this → auto-activate
export const PARTIAL = 60  // ≥ this (but < STRONG) → pending, teacher review
                           // < this → blocked (likely not this student)

const lc = v => (v == null ? '' : String(v)).trim().toLowerCase().replace(/\s+/g, ' ')
export const normName    = v => lc(v).replace(/\s*,\s*/g, ', ')      // forgiving spacing/comma, strict order
export const normSection = v => lc(v).replace(/[\s\-_]/g, '')
export const yearDigit   = v => { const m = String(v ?? '').match(/(\d)/); return m ? m[1] : null }

// Levenshtein-distance similarity ratio in [0,1] (1 = identical).
export function levRatio(a, b) {
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
  const dist = prev[n]
  return 1 - dist / Math.max(m, n)
}

// Score one student's entered identity against their roster row.
// entered/roster: { name, course, year, section }  (name is "SURNAME, FNAME MNAME")
// Returns { confidence:0-100|null, verdict:'auto'|'review'|'block', fields:{}, reasons:[] }.
export function scoreIdentity(entered = {}, roster = {}) {
  const fieldScore = (key) => {
    const rv = roster[key]
    if (rv == null || String(rv).trim() === '') return null // roster has no value → skip
    if (key === 'name')    return levRatio(normName(entered.name), normName(rv))
    if (key === 'course')  return lc(entered.course) === lc(rv) ? 1 : levRatio(lc(entered.course), lc(rv))
    if (key === 'year')    return (yearDigit(roster.year) && yearDigit(entered.year) === yearDigit(roster.year)) ? 1 : 0
    if (key === 'section') return normSection(entered.section) === normSection(rv) ? 1 : levRatio(normSection(entered.section), normSection(rv))
    return null
  }

  const WEIGHTS = { name: 0.45, course: 0.20, year: 0.15, section: 0.20 }
  const fields = {}
  const reasons = []
  let weighted = 0, totalWeight = 0
  for (const key of Object.keys(WEIGHTS)) {
    const sc = fieldScore(key)
    if (sc == null) continue
    fields[key] = Math.round(sc * 100)
    weighted += sc * WEIGHTS[key]
    totalWeight += WEIGHTS[key]
    reasons.push({ field: key, score: fields[key], ok: sc >= 0.85 })
  }

  // No comparable roster details → cannot auto-verify; hand to the teacher.
  if (totalWeight === 0) {
    return { confidence: null, verdict: 'review', fields, reasons: [{ field: 'roster', score: null, ok: false, note: 'No roster details on file to match - needs teacher review.' }] }
  }

  const confidence = Math.round((weighted / totalWeight) * 100)
  const verdict = confidence >= STRONG ? 'auto' : confidence >= PARTIAL ? 'review' : 'block'
  return { confidence, verdict, fields, reasons }
}

// One-line human summary of a per-field breakdown, for teacher/student display.
export function describeFields(fields = {}) {
  const labels = { name: 'name', course: 'course', year: 'year', section: 'section' }
  return Object.keys(labels)
    .filter(k => fields[k] != null)
    .map(k => `${labels[k]} ${fields[k]}%`)
    .join(' · ')
}
