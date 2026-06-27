// ── Grade "what-if" / target calculator ───────────────────────────────────
// Given a known midterm TERM grade and a hypothetical finals TERM grade, the
// final grade is the mean of the two terms (computeFinalGradeFromTerms), and
// the remark (Passed / Conditional / Failed) comes from combineEquiv on the two
// term equivalents. Rather than re-derive the school's pass rule, we scan finals
// values and ask combineEquiv - so this always matches the live grade display.
import { gradeInfo, combineEquiv } from '@/utils/grades'

// Smallest finals TERM grade that pushes the combined remark to each target.
// Returns { Passed, Conditional } where each value is the threshold finals % or
// null when even a perfect 100 can't reach that remark. Equivalence is
// monotonic in the term grade, so the first hit is the minimum.
export function neededFinalsForRemarks(midTerm, eqScale) {
  if (midTerm == null) return null
  const midEq = gradeInfo(midTerm, eqScale).eq
  const out = { Passed: null, Conditional: null }
  for (let f = 0; f <= 100; f += 0.5) {
    const { rem } = combineEquiv(midEq, gradeInfo(f, eqScale).eq)
    if (out.Conditional === null && (rem === 'Conditional' || rem === 'Passed')) out.Conditional = f
    if (out.Passed === null && rem === 'Passed') { out.Passed = f; break }
  }
  return out
}
