import { gradeInfo, combineEquiv } from '@/utils/grades'

// Subjects this student has officially PASSED — both terms uploaded and the
// combined remark is "Passed". Returns [{ subject, eq }]. Used to celebrate.
export function computePassedSubjects(student, subjects = [], eqScale) {
  const out = []
  for (const sub of subjects) {
    const comp = student?.gradeComponents?.[sub]
    if (!comp || comp.midterm == null || comp.finals == null) continue
    const { rem, eq } = combineEquiv(gradeInfo(comp.midterm, eqScale).eq, gradeInfo(comp.finals, eqScale).eq)
    if (rem === 'Passed') out.push({ subject: sub, eq })
  }
  return out
}
