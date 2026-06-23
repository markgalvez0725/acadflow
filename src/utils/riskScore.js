// ── At-risk student radar ──────────────────────────────────────────────────
// Fuses the signals AcadFlow already computes — failing/borderline grades,
// consecutive absences, overdue missing work, and low attendance — into one
// 0–100 risk score per student with a plain-English breakdown. This is a pure,
// derived view over existing DataContext data: no new Firestore reads/writes.
//
// Each signal contributes a capped number of points; reasons explain the score.
// Weights are intentionally simple and tunable (see WEIGHTS below).

import { getGWA, getAttRate } from '@/utils/grades'
import { activeClassIds } from '@/utils/active'
import { subjectSessionDates, trailingAbsenceStreak } from '@/utils/attendanceRisk'
import { pendingItems } from '@/utils/reminders'

// Max points each signal can add. They sum to 100 at the extremes; a real
// student rarely maxes every axis, so scores cluster well below 100.
export const WEIGHTS = { grade: 40, absence: 30, missing: 20, attendance: 10 }

// Bucket thresholds on the final 0–100 score.
export const RISK_LEVELS = { high: 70, watch: 40 }

export function levelFor(score) {
  if (score >= RISK_LEVELS.high) return 'high'
  if (score >= RISK_LEVELS.watch) return 'watch'
  return 'stable'
}

// Does the student have at least one subject with both terms entered? Mirrors
// the dashboard's "complete grades" gate so we don't flag students whose grades
// simply aren't encoded yet.
function hasCompleteGrade(s, classes) {
  const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const subs = ids.length
    ? [...new Set(ids.flatMap(id => classes.find(c => c.id === id)?.subjects || []))]
    : Object.keys(s.grades || {})
  return subs.some(sub => {
    const comp = s.gradeComponents?.[sub] || {}
    return comp.midterm != null && comp.finals != null
  })
}

// Worst trailing absence streak across the student's active subjects, plus the
// subject it belongs to (for the reason text).
function worstAbsenceStreak(s, classes, semester, allStudents) {
  let best = { streak: 0, subject: null }
  for (const id of activeClassIds(s, classes, semester)) {
    const cls = classes.find(c => c.id === id)
    for (const sub of cls?.subjects || []) {
      const dates = subjectSessionDates(id, sub, allStudents)
      if (dates.length < 2) continue
      const streak = trailingAbsenceStreak(s, sub, dates)
      if (streak > best.streak) best = { streak, subject: sub }
    }
  }
  return best
}

// Score one student. Returns { student, score, level, reasons, signals }.
export function scoreStudent(s, { classes = [], students = [], activities = [], quizzes = [], semester, now = Date.now() } = {}) {
  const reasons = []
  let score = 0

  // ── Grades ────────────────────────────────────────────────────────────────
  const gwa = getGWA(s, classes)
  const gradeComplete = gwa != null && hasCompleteGrade(s, classes)
  let gradePts = 0
  if (gradeComplete) {
    if (gwa < 71)      { gradePts = WEIGHTS.grade;        reasons.push({ sev: 'danger',  icon: 'chart', text: `Failing — GWA ${gwa.toFixed(1)}` }) }
    else if (gwa < 75) { gradePts = WEIGHTS.grade * 0.75; reasons.push({ sev: 'danger',  icon: 'chart', text: `Conditional — GWA ${gwa.toFixed(1)}` }) }
    else if (gwa < 78) { gradePts = WEIGHTS.grade * 0.3;  reasons.push({ sev: 'warning', icon: 'chart', text: `Borderline — GWA ${gwa.toFixed(1)}` }) }
  }
  score += gradePts

  // ── Consecutive absences ───────────────────────────────────────────────────
  const abs = worstAbsenceStreak(s, classes, semester, students)
  let absPts = 0
  if (abs.streak >= 1) {
    absPts = Math.min(WEIGHTS.absence, abs.streak * 6)
    if (abs.streak >= 3) {
      reasons.push({ sev: 'danger', icon: 'calendar', text: `${abs.streak} absences in a row${abs.subject ? ` (${abs.subject})` : ''}` })
    } else {
      reasons.push({ sev: 'warning', icon: 'calendar', text: `${abs.streak} recent absence${abs.streak === 1 ? '' : 's'}${abs.subject ? ` (${abs.subject})` : ''}` })
    }
  }
  score += absPts

  // ── Overdue missing work ────────────────────────────────────────────────────
  const overdue = pendingItems({ student: s, classes, activities, quizzes, semester, now })
    .filter(it => it.when < now)
  let missPts = 0
  if (overdue.length) {
    missPts = Math.min(WEIGHTS.missing, overdue.length * 7)
    reasons.push({ sev: overdue.length >= 3 ? 'danger' : 'warning', icon: 'file', text: `${overdue.length} missing task${overdue.length === 1 ? '' : 's'}` })
  }
  score += missPts

  // ── Low attendance rate ─────────────────────────────────────────────────────
  const rate = getAttRate(s, students, classes)
  let attPts = 0
  if (rate != null) {
    if (rate < 60)      { attPts = WEIGHTS.attendance;       reasons.push({ sev: 'danger',  icon: 'clock', text: `Attendance ${rate.toFixed(0)}%` }) }
    else if (rate < 75) { attPts = WEIGHTS.attendance * 0.7; reasons.push({ sev: 'warning', icon: 'clock', text: `Attendance ${rate.toFixed(0)}%` }) }
    else if (rate < 80) { attPts = WEIGHTS.attendance * 0.4; reasons.push({ sev: 'warning', icon: 'clock', text: `Attendance ${rate.toFixed(0)}%` }) }
  }
  score += attPts

  const rounded = Math.min(100, Math.round(score))
  return {
    student: s,
    score: rounded,
    level: levelFor(rounded),
    reasons,
    signals: { gwa, absStreak: abs.streak, absSubject: abs.subject, missing: overdue.length, attRate: rate },
  }
}

// Score every student and return only those carrying real risk (score > 0),
// worst first. Counts of each bucket come along for summary cards.
export function computeRiskScores(students = [], opts = {}) {
  const scored = students
    .map(s => scoreStudent(s, opts))
    .filter(r => r.score > 0 && r.reasons.length)
    .sort((a, b) => b.score - a.score)

  const counts = { high: 0, watch: 0, stable: 0 }
  for (const r of scored) counts[r.level] += 1
  counts.stable = students.length - scored.length // everyone not flagged is stable

  return { list: scored, counts }
}
