// ── Which messages a student should see ───────────────────────────────────
// Delivery is computed dynamically from the student's CURRENT enrollment, not a
// frozen recipient list. So a student newly added/registered into a class (or
// section) automatically "joins" any existing group chat (class broadcast or
// current-semester subject group) for that class and can read the whole past
// thread — no backfill needed.
//
// Before joining a group, we verify the student genuinely belongs:
//   • enrolled in one of the message's target classes (current semester), AND
//   • their course & year match that class (when both are known), AND
//   • for a subject group, the matched class actually teaches that subject.
import { activeClassIds } from '@/utils/active'

const norm = v => String(v ?? '').trim().toLowerCase()

// Course/year alignment — lenient: only rejects when both sides have a value and
// they differ, so missing/blank fields never hide a legitimately-enrolled student.
function courseYearMatches(cls, student) {
  if (!cls) return true // class record missing → trust the enrollment link
  const courseOk = !cls.course || !student.course || norm(cls.course) === norm(student.course)
  const yearOk   = !cls.year   || !student.year   || norm(cls.year)   === norm(student.year)
  return courseOk && yearOk
}

export function studentSeesMessage(m, student, classes = [], semester = null) {
  if (!m || !student) return false
  const id = student.id
  if (m.to === 'all') return true
  if (m.to === id) return true
  if (m.from === id && m.to === 'admin') return true
  if (m.type !== 'announcement') return false

  const enrolledIds = activeClassIds(student, classes, semester)

  // Section / class broadcast.
  if (m.classId && enrolledIds.includes(m.classId)) {
    return courseYearMatches(classes.find(c => c.id === m.classId), student)
  }
  // Current-semester subject group (fan-out across classes teaching the subject).
  if (Array.isArray(m.classIds)) {
    return m.classIds.some(cid => {
      if (!enrolledIds.includes(cid)) return false
      const cls = classes.find(c => c.id === cid)
      if (!courseYearMatches(cls, student)) return false
      if (m.targetSubject && cls) return (cls.subjects || []).includes(m.targetSubject)
      return true
    })
  }
  return false
}

export function getStudentMessages(messages, student, classes = [], semester = null) {
  return messages
    .filter(m => studentSeesMessage(m, student, classes, semester))
    .sort((a, b) => b.ts - a.ts)
}
