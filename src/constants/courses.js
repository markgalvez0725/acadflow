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
