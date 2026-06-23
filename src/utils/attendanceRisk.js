// ── Consecutive-absence early warning ──────────────────────────────────────
// A session "held" on a date is any date some classmate was present or excused
// for that subject. A student is absent on a held date when they were neither
// present nor excused. We surface the trailing run of absences (most recent
// sessions) so teachers can catch disengagement before it shows up in grades.
import { activeClassIds } from '@/utils/active'

// attendance/excuse are Sets in memory but may be arrays in some code paths.
function has(coll, d) {
  if (!coll) return false
  if (coll instanceof Set) return coll.has(d)
  if (Array.isArray(coll)) return coll.includes(d)
  return false
}
function values(coll) {
  if (!coll) return []
  if (coll instanceof Set) return [...coll]
  if (Array.isArray(coll)) return coll
  return []
}

// Sorted (chronological) list of held session dates for a subject in a class.
// ISO date strings (YYYY-MM-DD) sort lexicographically = chronologically.
export function subjectSessionDates(classId, sub, students) {
  const set = new Set()
  for (const s of students) {
    const inClass = s.classId === classId || s.classIds?.includes(classId)
    if (!inClass) continue
    for (const d of values(s.attendance?.[sub])) set.add(d)
    for (const d of values(s.excuse?.[sub])) set.add(d)
  }
  return [...set].sort()
}

// How many of the most recent held sessions the student missed in a row.
export function trailingAbsenceStreak(student, sub, sessionDatesSorted) {
  let streak = 0
  for (let i = sessionDatesSorted.length - 1; i >= 0; i--) {
    const d = sessionDatesSorted[i]
    if (has(student.attendance?.[sub], d) || has(student.excuse?.[sub], d)) break
    streak += 1
  }
  return streak
}

// Scan all active enrollments and return students whose trailing absence streak
// meets the threshold. One entry per (student, subject), worst streaks first.
export function findAbsenceAlerts(students = [], classes = [], semester, threshold = 3) {
  const alerts = []
  // Cache session dates per (classId, subject) so we compute each once.
  const cache = new Map()
  const sessionsFor = (classId, sub) => {
    const key = `${classId}::${sub}`
    if (!cache.has(key)) cache.set(key, subjectSessionDates(classId, sub, students))
    return cache.get(key)
  }

  for (const s of students) {
    const ids = activeClassIds(s, classes, semester)
    for (const id of ids) {
      const cls = classes.find(c => c.id === id)
      for (const sub of cls?.subjects || []) {
        const dates = sessionsFor(id, sub)
        if (dates.length < threshold) continue
        const streak = trailingAbsenceStreak(s, sub, dates)
        if (streak >= threshold) {
          alerts.push({ student: s, classId: id, subject: sub, streak, lastDate: dates[dates.length - 1] })
        }
      }
    }
  }

  return alerts.sort((a, b) => b.streak - a.streak)
}
