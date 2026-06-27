// ── Late-submission penalty ───────────────────────────────────────────────
// Pure helpers - no Firebase, no React. The policy is global (stored in
// portal/settings as `latePolicy`) and applied when grading an activity:
// a submission whose submittedAt is past the deadline (plus an optional grace
// window) loses `percentPerDay` of its earned score per day late, capped at
// `maxPercent`. The professor can waive the penalty per submission.

export const DEFAULT_LATE_POLICY = {
  enabled: false,      // off by default - opt-in
  percentPerDay: 10,   // % of earned score deducted per day late
  maxPercent: 100,     // cap on total deduction
  graceMins: 0,        // minutes after the deadline before "late" applies
}

const DAY_MS = 86400000

export function normalizeLatePolicy(p) {
  const m = { ...DEFAULT_LATE_POLICY, ...(p || {}) }
  return {
    enabled: !!m.enabled,
    percentPerDay: Math.max(0, Number(m.percentPerDay) || 0),
    maxPercent: Math.min(100, Math.max(0, Number(m.maxPercent) || 0)),
    graceMins: Math.max(0, Number(m.graceMins) || 0),
  }
}

/**
 * How late a submission is and the resulting deduction percentage.
 * @returns {{ late: boolean, days: number, percent: number }}
 */
export function lateInfo(sub, act, policy) {
  const p = normalizeLatePolicy(policy)
  if (!p.enabled || !act?.deadline || !sub?.submittedAt) return { late: false, days: 0, percent: 0 }
  const over = sub.submittedAt - (act.deadline + p.graceMins * 60000)
  if (over <= 0) return { late: false, days: 0, percent: 0 }
  const days = Math.ceil(over / DAY_MS)
  const percent = Math.min(p.maxPercent, p.percentPerDay * days)
  return { late: true, days, percent }
}

/**
 * Effective score after the late penalty. `waived` skips the deduction.
 * Deducts `percent` of the earned score; never goes below 0.
 */
export function applyLatePenalty(score, sub, act, policy, waived = false) {
  const n = Number(score)
  if (isNaN(n)) return score
  if (waived) return n
  const { late, percent } = lateInfo(sub, act, policy)
  if (!late || !percent) return n
  return parseFloat(Math.max(0, n * (1 - percent / 100)).toFixed(2))
}
