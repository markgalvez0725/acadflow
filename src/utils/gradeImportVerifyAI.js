// ── On-device grade-import verification ("AI check") ───────────────────────
// Custom, in-browser sanity pass over a filled-in grading sheet - the same
// on-device approach used elsewhere (photoVerifyAI, identityVerify, the student
// import check): nothing leaves the device, runs instantly, $0. It recomputes
// each student's grade the way the app does and flags rows the professor should
// eyeball before committing. Warnings are advisory; only unmatched students are
// excluded from the import.

import { computeTerms, combineEquiv, gradeInfo, getHeldDays, round2 } from '@/utils/grades.js'

const inRange = v => v === null || v === undefined || (v >= 0 && v <= 100)
const avgNonNull = vals => {
  const nums = (vals || []).filter(x => x !== null && x !== undefined && !isNaN(x))
  return nums.length ? round2(nums.reduce((s, x) => s + Number(x), 0) / nums.length) : null
}

/**
 * @param {object[]} entries parsed import records (parseGradingSheetImport)
 * @param {{ students, classes, classId, subject, eqScale, gradeFloor }} ctx
 * @returns {{ rows: object[], summary: { total, matched, flagged, unmatched } }}
 */
export function verifyGradeRows(entries, { students = [], classId, subject, eqScale, gradeFloor = 0 } = {}) {
  const roster = students.filter(s => s.classId === classId || s.classIds?.includes(classId))
  const byId = {}
  roster.forEach(s => { byId[String(s.id).toLowerCase()] = s })

  const seen = {}
  entries.forEach((e, i) => {
    const k = String(e.studentId).toLowerCase()
    if (!(k in seen)) seen[k] = i
  })

  const rows = entries.map((e, i) => {
    const key = String(e.studentId).toLowerCase()
    const stud = byId[key]
    const warnings = []

    if (!stud) {
      return {
        studentId: e.studentId, name: e.studentId, matched: false,
        actAvg: null, qzAvg: null, final: null, equiv: '-',
        level: 'error', warnings: ['Not enrolled in this class - this row will be skipped.'],
      }
    }

    const comp = stud.gradeComponents?.[subject] || {}

    // Range checks on every score in the row.
    const badAct = (e.actScores || []).some(v => !inRange(v))
    const badQz  = (e.qzScores || []).some(v => !inRange(v))
    if (badAct) warnings.push('An activity score is outside 0-100.')
    if (badQz)  warnings.push('A quiz score is outside 0-100.')
    if (!inRange(e.attitude)) warnings.push('Attitude is outside 0-100.')
    if (!inRange(e.mtExam))   warnings.push('Midterm exam is outside 0-100.')
    if (!inRange(e.ftExam))   warnings.push('Finals exam is outside 0-100.')

    // Recompute the grade exactly like the app (attitude + attendance included).
    const actAvg = e.actAvg != null ? e.actAvg : avgNonNull(e.actScores)
    const qzAvg  = e.qzAvg  != null ? e.qzAvg  : avgNonNull(e.qzScores)
    const attitude = e.attitude != null ? e.attitude : (comp.attitude ?? null)
    const mtExam = e.mtExam != null ? e.mtExam : (comp.midtermExam ?? null)
    const ftExam = e.ftExam != null ? e.ftExam : (comp.finalsExam ?? null)
    const attSet = stud.attendance?.[subject] || new Set()
    const held   = getHeldDays(classId, subject, students)
    const attend = held > 0 ? Math.min(100, round2((attSet.size / held) * 100)) : null

    const { midterm, finals, final } = computeTerms({
      activities: actAvg, quizzes: qzAvg, attendance: attend,
      attitude, midtermExam: mtExam, finalsExam: ftExam,
    })

    let equiv = '-'
    if (midterm != null || finals != null) {
      const midEq = midterm != null ? gradeInfo(midterm, eqScale).eq : null
      const finEq = finals  != null ? gradeInfo(finals,  eqScale).eq : null
      if (midEq && finEq) equiv = combineEquiv(midEq, finEq).eq
      else equiv = midEq || finEq || '-'
    }

    const hasAnyData = actAvg != null || qzAvg != null || attitude != null || mtExam != null || ftExam != null
    if (!hasAnyData) warnings.push('No grades found for this student.')
    else if (mtExam == null && ftExam == null) warnings.push('No exam scores - final grade will be incomplete.')

    if (final != null && gradeFloor > 0 && final < gradeFloor) {
      warnings.push(`Final ${final} is below the grade floor (${gradeFloor}).`)
    }
    if (seen[key] !== i) warnings.push('This student appears more than once in the file.')

    return {
      studentId: stud.id, name: stud.name, matched: true,
      actAvg, qzAvg, attend, attitude, mtExam, ftExam,
      final, equiv,
      level: warnings.length ? 'review' : 'ok',
      warnings,
    }
  })

  const summary = {
    total: rows.length,
    matched: rows.filter(r => r.matched).length,
    flagged: rows.filter(r => r.matched && r.level === 'review').length,
    unmatched: rows.filter(r => !r.matched).length,
  }
  return { rows, summary }
}
