// ── Enrollment eligibility (course + year + section matching) ──────────────
// A class is a course `name` + a `section` (whose leading digit encodes the year
// level, e.g. "2-A" → 2nd year) + a list of `subjects`, gated by `courseReq` (the
// course a student must be in to enroll). These pure matchers are the single
// source of truth shared by the student EnrollmentTab (self-enroll eligibility)
// and the admin Add-Student modal (filtering classes to the student's course/year).

export function courseMatches(studentCourse, clsCourseReq) {
  if (!clsCourseReq) return true // no requirement = open to all
  return (studentCourse || '').trim().toLowerCase() === clsCourseReq.trim().toLowerCase()
}

// Leading year digit of a section string (e.g. "2A", "2-A", "3B" → 2, 3).
export function extractSectionYear(section) {
  if (!section) return null
  const m = String(section).match(/^(\d)/)
  return m ? parseInt(m[1], 10) : null
}

// Year number from a student year-level string (e.g. "2nd Year" → 2).
export function extractStudentYear(yearStr) {
  if (!yearStr) return null
  const m = String(yearStr).match(/(\d)/)
  return m ? parseInt(m[1], 10) : null
}

// True when the class section year matches the student's year level. If either
// side can't be determined, allow the class through.
export function yearLevelMatches(studentYear, clsSection) {
  const stuYear = extractStudentYear(studentYear)
  const clsYear = extractSectionYear(clsSection)
  if (!stuYear || !clsYear) return true
  return stuYear === clsYear
}

// The student's section: explicit field, else inherited from their primary class.
export function getStudentSection(student, classes) {
  if (student.section) return student.section
  const primary = classes.find(c => c.id === (student.classId || student.classIds?.[0]))
  return primary?.section || ''
}

// Exact section match (ignores spacing/dashes/case: "2 - A" === "2A").
export function sectionMatches(student, cls, classes) {
  if (!cls.section) return true // class has no section requirement
  const stuSec = getStudentSection(student, classes)
  if (!stuSec) return false     // student's section unknown → cannot verify
  const normalize = v => String(v).trim().toLowerCase().replace(/[\s\-_]/g, '')
  return normalize(stuSec) === normalize(cls.section)
}

// An IRREGULAR student may enroll in any subject across year levels, so neither
// the year nor the section (which encodes the year) gates their eligibility -
// only the course/program still applies. REGULAR students keep year-locked
// matching. Defaults to regular when the field is unset (every existing student).
export function isIrregular(student) {
  return (student?.studentType || 'regular') === 'irregular'
}

// Full self-enroll eligibility: course always required; year + exact section
// required only for regular students (irregular students bypass both).
export function eligibleForClass(student, cls, classes) {
  if (!courseMatches(student.course, cls.courseReq)) return false
  if (isIrregular(student)) return true
  return yearLevelMatches(student.year, cls.section) &&
         sectionMatches(student, cls, classes)
}

// Lighter filter for the admin Add-Student flow: a class is offered to a student
// of `course` + `year` when the course requirement and the section's year line up.
// Section itself is chosen by picking the class, so it is NOT required here.
// `irregular` students drop the year filter so every course class is offered.
export function classMatchesCourseYear(course, year, cls, irregular = false) {
  return courseMatches(course, cls.courseReq) && (irregular || yearLevelMatches(year, cls.section))
}
