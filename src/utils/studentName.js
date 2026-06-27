// Student names are stored canonically as "SURNAME, First Middle". These helpers
// split a stored name into parts (for editing + export columns) and rebuild that
// structure on save/import. The middle is an INITIAL by convention, so only a
// trailing single-letter token (e.g. the "G" in "STEPHEN ANDREI G") is treated as
// the middle initial - the rest stays in the first name, keeping multi-word first
// names like "STEPHEN ANDREI" intact. Pure + deterministic.
export function splitStudentName(full) {
  const raw = (full || '').trim()
  if (!raw) return { last: '', first: '', middle: '' }
  if (raw.includes(',')) {
    const [sur, rest = ''] = raw.split(/,(.+)/) // split on the FIRST comma only
    const parts = rest.trim().split(/\s+/).filter(Boolean)
    let firstParts = parts, middle = ''
    const lastTok = parts[parts.length - 1] || ''
    if (parts.length >= 2 && /^[A-Za-z]\.?$/.test(lastTok)) {
      middle = lastTok.replace(/\.$/, '') // trailing single letter → middle initial
      firstParts = parts.slice(0, -1)
    }
    return { last: sur.trim(), first: firstParts.join(' '), middle }
  }
  return { last: '', first: raw, middle: '' } // no comma - keep it in the first-name slot
}

export function buildStudentName(last, first, middle) {
  const l = (last || '').trim(), f = (first || '').trim(), m = (middle || '').trim()
  if (!l && !f) return ''
  return `${l}, ${f}${m ? ` ${m}` : ''}`.toUpperCase()
}
