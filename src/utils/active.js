// ── Active (current-semester) class/subject helpers ───────────────────────
// A class is shown in the student's "current / ongoing" views only when it is
// NOT archived and belongs to the active semester. Archived classes are already
// stripped from student.classIds on archive; this also hides classes from a
// past semester or a semester that has ended (by status or end date), plus any
// subjects that were removed from a class.

function semesterLabel(semester) {
  if (!semester) return null
  if (semester.label) return semester.label
  if (semester.term && semester.year) return `${semester.term} AY ${semester.year}`
  return null
}

// Normalize a semester label so trivial formatting differences (extra spaces,
// hyphen vs en-dash, casing) don't cause a false "different semester" match.
function normLabel(v) {
  return String(v || '')
    .replace(/[‐--]/g, '-')   // any dash variant → hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// True when the class is part of the current, ongoing semester.
export function isClassCurrent(cls, semester) {
  if (!cls || cls.archived) return false
  if (!semester) return true
  const label = semesterLabel(semester)
  // Class tagged to a different (older) semester → not current.
  if (cls.activeSemester && label && normLabel(cls.activeSemester) !== normLabel(label)) return false
  // The current semester itself is over (ended or end date passed).
  const ended = semester.status === 'ended' ||
    (semester.endDate && new Date(semester.endDate) < new Date())
  if (ended) return false
  return true
}

// Raw enrolled class IDs (may include archived/past - used as a fallback only).
export function enrolledClassIds(student) {
  if (!student) return []
  return student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
}

// The student's currently-active class IDs (archived + past-semester excluded).
export function activeClassIds(student, classes, semester) {
  return enrolledClassIds(student).filter(id => {
    const cls = classes.find(c => c.id === id)
    return cls && isClassCurrent(cls, semester)
  })
}

// The student's currently-active classes.
export function activeClasses(student, classes, semester) {
  return activeClassIds(student, classes, semester)
    .map(id => classes.find(c => c.id === id))
    .filter(Boolean)
}

// Subjects belonging to the student's active classes (removed subjects drop off).
export function activeSubjects(student, classes, semester) {
  const ids = activeClassIds(student, classes, semester)
  return [...new Set(ids.flatMap(id => classes.find(c => c.id === id)?.subjects || []))]
}
