// ── Class schedule parsing & conflict detection ───────────────────────────
// Class schedules are free text (e.g. "MWF 8:00–9:30 AM", "TTh 1:00-2:30 PM").
// We best-effort parse them into day + time-range blocks so we can warn a
// student when a class they're about to enroll in overlaps one they're already
// in. Anything we can't confidently parse returns null and is simply skipped —
// we never raise a false conflict on an unrecognized format.


// Day codes → 0=Sun … 6=Sat. "Th" and "Su" are checked before single letters
// so "TTh" reads as Tue+Thu (not Tue+Tue+H).
function parseDays(seg) {
  const u = (seg || '').toUpperCase().replace(/[^A-Z]/g, '')
  const map = { M: 1, T: 2, W: 3, F: 5, S: 6, U: 0 }
  const days = []
  for (let i = 0; i < u.length;) {
    if (u.startsWith('TH', i)) { days.push(4); i += 2; continue }
    if (u.startsWith('SU', i)) { days.push(0); i += 2; continue }
    const ch = u[i]; i += 1
    if (ch in map) days.push(map[ch])
  }
  return [...new Set(days)]
}

// Parse a "start-end" time range into minutes-from-midnight. Handles a meridiem
// on either or both ends, en/em dashes, and the common "10:00-1:30 PM" case
// where only the end carries AM/PM.
function parseTimes(seg) {
  const s = (seg || '').replace(/[–—]/g, '-')
  const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/g
  const found = []
  let m
  while ((m = re.exec(s)) && found.length < 2) {
    if (!m[0].trim()) { re.lastIndex++; continue }
    found.push({ h: parseInt(m[1], 10), min: m[2] ? parseInt(m[2], 10) : 0, mer: m[3] ? m[3].toUpperCase() : null })
  }
  if (found.length < 2) return null

  const toMin = (t, fallbackMer) => {
    let h = t.h
    const mer = t.mer || fallbackMer
    if (mer === 'PM' && h < 12) h += 12
    if (mer === 'AM' && h === 12) h = 0
    return h * 60 + t.min
  }

  let start = toMin(found[0], found[1].mer)
  const end = toMin(found[1], found[1].mer)
  // "10:00-1:30 PM" — applying PM to the start made it later than the end, so
  // the start is really the AM of the same clock face.
  if (start >= end && found[1].mer === 'PM' && !found[0].mer) start -= 12 * 60
  if (!(end > start)) return null
  return { start, end }
}

// Parse a free-text schedule into { days:[0-6], start, end, raw }, or null when
// it can't be confidently understood (TBA, async, malformed, etc.).
export function parseSchedule(str) {
  if (!str) return null
  const t = String(str).trim()
  if (!t) return null
  if (!/\d/.test(t)) return null // no time at all (e.g. "TBA", "Async")
  const firstDigit = t.search(/\d/)
  if (firstDigit <= 0) return null // need a day segment before the time
  const days = parseDays(t.slice(0, firstDigit))
  const time = parseTimes(t.slice(firstDigit))
  if (!days.length || !time) return null
  return { days, start: time.start, end: time.end, raw: t }
}

// True when two parsed schedules share a day and their time ranges intersect.
export function schedulesOverlap(a, b) {
  if (!a || !b) return false
  if (!a.days.some(d => b.days.includes(d))) return false
  return a.start < b.end && b.start < a.end
}

// Enrolled classes whose schedule overlaps the target class. Best-effort:
// classes with unparseable schedules (or none) are skipped.
export function findScheduleConflicts(targetCls, enrolledClasses = []) {
  const target = parseSchedule(targetCls?.schedule)
  if (!target) return []
  const out = []
  for (const c of enrolledClasses) {
    if (!c || c.id === targetCls.id) continue
    const sched = parseSchedule(c.schedule)
    if (sched && schedulesOverlap(target, sched)) out.push(c)
  }
  return out
}

