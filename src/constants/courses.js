// Canonical list of offered courses/programs. Used as the single source of
// truth for every course dropdown so the values always match exactly — which
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
