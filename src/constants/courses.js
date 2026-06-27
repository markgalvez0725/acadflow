// Canonical list of offered courses/programs. Used as the single source of
// truth for every course dropdown so the values always match exactly - which
// is what enrollment and registration verification (course + year + section)
// rely on. Add or edit programs here and every dropdown updates.
export const COURSES = [
  'BS Entertainment and Multimedia Computing',
  'BS Information Technology',
  'BS Information System',
  'BS Computer Science',
]

// The four short course codes, in the order they map below.
const COURSE_SHORTS = ['BSEMC', 'BSIS', 'BSCS', 'BSIT']

// Map a course (full name OR an already-short code) to its short code:
// BSEMC / BSIS / BSCS / BSIT. This is the single source of truth for how a
// course is DISPLAYED everywhere (roster, dropdowns, headers, exports). The
// stored student.course / class.courseReq stay full names (enrollment matching
// relies on them); only the on-screen label is shortened. An unknown/legacy
// value is returned unchanged so nothing ever renders blank. Mirrors
// courseFromShort(), which expands a code back to the full canonical name.
export function courseShort(course) {
  const raw = String(course || '').trim()
  if (!raw) return ''
  const compact = raw.toUpperCase().replace(/[^A-Z]/g, '')
  for (const code of COURSE_SHORTS) if (compact.includes(code)) return code
  const c = raw.toLowerCase()
  if (c.includes('entertainment') || c.includes('multimedia')) return 'BSEMC'
  if (c.includes('information system')) return 'BSIS'
  if (c.includes('computer science')) return 'BSCS'
  if (c.includes('information technology')) return 'BSIT'
  return raw
}

// Returns the option list, prepending any existing/legacy value that isn't in
// the canonical list so editing an older record never silently drops its course.
export function courseOptions(current) {
  const list = [...COURSES]
  const cur = (current || '').trim()
  if (cur && !list.some(c => c.toLowerCase() === cur.toLowerCase())) {
    list.unshift(cur)
  }
  return list
}

// Expand a short course code (BSEMC / BSIT / BSIS / BSCS) back to its full
// canonical name. Used on import so a roster exported with short codes round-trips
// to the real course name (enrollment matching needs the full name). A value that
// is already a full/unknown course is returned unchanged. Mirrors courseShort().
export function courseFromShort(value) {
  const v = String(value || '').trim()
  if (!v) return ''
  const exact = COURSES.find(c => c.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  const up = v.toUpperCase().replace(/[^A-Z]/g, '')
  const SHORTS = { BSEMC: 'entertainment', BSIS: 'information system', BSCS: 'computer science', BSIT: 'information technology' }
  const needle = SHORTS[up]
  if (needle) {
    const match = COURSES.find(c => c.toLowerCase().includes(needle))
    if (match) return match
  }
  return v
}
