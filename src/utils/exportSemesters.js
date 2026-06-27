// ── On-device semester check for student exports ───────────────────────────
// A report card / student report aggregates every class the student is on,
// which can mix the current term with a past one. This deterministic (no
// network) analyzer groups the student's enrolled classes by their tagged
// semester so the professor can pick which term to export. Same on-device
// "AI" pattern as verificationGuide.js.

import { enrolledClassIds, isClassCurrent } from '@/utils/active'

function currentSemLabel(semester) {
  if (!semester) return ''
  if (semester.label) return semester.label
  if (semester.term && semester.year) return `${semester.term} AY ${semester.year}`
  return ''
}

// First 4-digit year in a label ("1st Sem AY 2025-2026" -> 2025) for sorting.
// (Plain \d{4} avoids any dash character class - immune to a future dash sweep.)
function ayYear(label) {
  const m = String(label || '').match(/\d{4}/)
  return m ? parseInt(m[0], 10) : 0
}

// A subject is "graded" for this student when a midterm/finals component or a
// final grade has been posted - that's what makes a term worth exporting.
function hasGrade(student, sub) {
  const c = student?.gradeComponents?.[sub]
  if (c && (c.midterm != null || c.finals != null)) return true
  return student?.grades?.[sub] != null
}

/**
 * Group a student's enrolled classes by semester. Each group tracks its enrolled
 * subjects (used to SCOPE the export) and how many of those have posted grades
 * (used for the recommendation, the count badge, and disabling empty terms).
 * @returns {{
 *   groups: {label,isCurrent,subjects:string[],gradedCount:number}[],
 *   currentLabel: string, hasMultiple: boolean, currentHasGrades: boolean,
 *   recommended: string, narration: string,
 * }}
 */
export function analyzeStudentSemesters(student, classes = [], semester = null) {
  const currentLabel = currentSemLabel(semester)
  const map = new Map()

  for (const id of enrolledClassIds(student)) {
    const cls = classes.find(c => c.id === id)
    if (!cls) continue
    const isCur = isClassCurrent(cls, semester)
    const label = cls.activeSemester || (isCur ? currentLabel : '') || 'Earlier term'
    if (!map.has(label)) map.set(label, { label, isCurrent: isCur, subjects: new Set() })
    const g = map.get(label)
    ;(cls.subjects || []).forEach(s => g.subjects.add(s))
    if (isCur) g.isCurrent = true
  }

  let groups = [...map.values()].map(g => {
    const subjects = [...g.subjects]
    return { label: g.label, isCurrent: g.isCurrent, subjects, gradedCount: subjects.filter(s => hasGrade(student, s)).length }
  })
  groups.sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || ayYear(b.label) - ayYear(a.label) || a.label.localeCompare(b.label))

  const current = groups.find(g => g.isCurrent)
  const currentHasGrades = !!(current && current.gradedCount)
  const firstGraded = groups.find(g => g.gradedCount > 0)
  const recommended = currentHasGrades ? current.label : (firstGraded?.label || groups[0]?.label || 'all')
  const hasMultiple = groups.length > 1

  let narration = ''
  if (hasMultiple) {
    narration = currentHasGrades
      ? `These grades span ${groups.length} semesters. Choose the current term or a past one to export.`
      : `These grades span ${groups.length} semesters. The current term${currentLabel ? ` (${currentLabel})` : ''} has no posted grades for this student yet, so the grades on record are from a past semester. Pick what to export.`
  }

  return { groups, currentLabel, hasMultiple, currentHasGrades, recommended, narration }
}

// Enrolled subjects to include for a chosen key ('all' or a semester label).
export function subjectsForKey(analysis, key) {
  if (!analysis) return []
  if (key === 'all') return [...new Set(analysis.groups.flatMap(g => g.subjects))]
  const g = analysis.groups.find(x => x.label === key)
  return g ? g.subjects.slice() : []
}

// Human label for the chosen term, used in the export header.
export function labelForKey(key) {
  return key === 'all' ? 'All semesters' : String(key || '')
}
