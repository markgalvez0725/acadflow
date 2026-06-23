// ── Semester in Review ("AcadFlow Wrapped") ─────────────────────────────────
// Turns a student's own semester data into a story-ready stat pack: GWA, best
// and most-improved subject, attendance highlights, work submitted/on-time,
// quizzes, and a playful "persona". Pure derived view over existing
// DataContext data — no new Firestore reads/writes, mirroring riskScore.js.

import { getGWA, getAttRate, computeFinalGradeFromTerms } from '@/utils/grades'
import { activeClassIds, activeSubjects } from '@/utils/active'

// Authoritative final grade for one subject: saved value first, else derived
// from the stored midterm/finals terms (matches getGWA's own preference).
function subjectFinal(s, sub) {
  const stored = s.grades?.[sub]
  if (stored != null) return stored
  const comp = s.gradeComponents?.[sub] || {}
  return computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null)
}

// A fun, single "vibe" derived from the strongest signal the student earned.
// Order matters: the most distinctive achievement wins.
function derivePersona(m) {
  if (m.mostImproved && m.mostImproved.delta >= 5)
    return { key: 'comeback', title: 'The Comeback Kid', blurb: `You turned it around in ${m.mostImproved.sub} — up ${m.mostImproved.delta} points from midterms to finals.` }
  if (m.attRate != null && m.attRate >= 98)
    return { key: 'present', title: 'Always There', blurb: `Near-perfect attendance. You showed up — again and again.` }
  if (m.gwa != null && m.gwa >= 90)
    return { key: 'ace', title: 'The High Achiever', blurb: `A GWA in the 90s. Consistently excellent work all semester.` }
  if (m.onTimeRate != null && m.onTimeRate >= 95 && m.actSubmitted >= 3)
    return { key: 'punctual', title: 'Deadline Dominator', blurb: `${m.onTimeRate}% of your work landed on time. Reliable to the core.` }
  if (m.gwa != null && m.gwa >= 85)
    return { key: 'steady', title: 'The Steady Climber', blurb: `Solid, dependable performance across all your subjects.` }
  if (m.qzAvg != null && m.qzAvg >= 85)
    return { key: 'quiz', title: 'Quiz Whiz', blurb: `You aced the quizzes — ${m.qzAvg}% average. Sharp recall.` }
  return { key: 'journey', title: 'The Work in Progress', blurb: `Every semester is a chapter. Here's how yours unfolded.` }
}

export function computeSemesterWrapped(s, { classes = [], students = [], activities = [], quizzes = [], semester } = {}) {
  const subs = activeSubjects(s, classes, semester)
  const enrolledIds = activeClassIds(s, classes, semester)

  const gwa = getGWA(s, classes)
  const attRate = getAttRate(s, students, classes)

  // ── Best subject ──────────────────────────────────────────────────────────
  const graded = subs
    .map(sub => ({ sub, grade: subjectFinal(s, sub) }))
    .filter(x => x.grade != null)
  const bestSubject = graded.length
    ? graded.reduce((a, b) => (b.grade > a.grade ? b : a))
    : null

  // ── Most improved (finals vs midterm) ──────────────────────────────────────
  let mostImproved = null
  for (const sub of subs) {
    const comp = s.gradeComponents?.[sub] || {}
    if (comp.midterm != null && comp.finals != null) {
      const delta = comp.finals - comp.midterm
      if (delta > 0 && (!mostImproved || delta > mostImproved.delta)) {
        mostImproved = { sub, delta: parseFloat(delta.toFixed(1)), from: comp.midterm, to: comp.finals }
      }
    }
  }

  // ── Attendance highlights (per-subject held mirrors getAttRate) ─────────────
  let presentDays = 0, perfectSubjects = 0, attendedSubjects = 0
  for (const sub of subs) {
    const classIdsForSub = enrolledIds.filter(id => classes.find(c => c.id === id)?.subjects?.includes(sub))
    const mates = classIdsForSub.length
      ? students.filter(x => x.id !== s.id && classIdsForSub.some(id => x.classIds?.includes(id) || x.classId === id))
      : []
    const present = (s.attendance?.[sub]?.size) || 0
    const excused = (s.excuse?.[sub]?.size) || 0
    const held = [...mates, s].reduce((mx, x) =>
      Math.max(mx, ((x.attendance?.[sub]?.size) || 0) + ((x.excuse?.[sub]?.size) || 0)), 0)
    presentDays += present
    if (held > 0) {
      attendedSubjects += 1
      if (Math.max(0, held - present - excused) === 0) perfectSubjects += 1
    }
  }

  // ── Activities submitted + on-time ──────────────────────────────────────────
  const myActs = activities.filter(a => enrolledIds.includes(a.classId) && (!a.subject || subs.includes(a.subject)))
  let actSubmitted = 0, actOnTime = 0
  for (const a of myActs) {
    const sub = (a.submissions || {})[s.id]
    if (sub?.link) {
      actSubmitted += 1
      // No deadline → counts as on time; otherwise compare the submission stamp.
      if (!a.deadline || (sub.submittedAt != null && sub.submittedAt <= a.deadline)) actOnTime += 1
    }
  }
  const onTimeRate = actSubmitted ? Math.round((actOnTime / actSubmitted) * 100) : null

  // ── Quizzes taken + average ─────────────────────────────────────────────────
  const myQz = quizzes.filter(q => enrolledIds.includes(q.classId) && (!q.subject || subs.includes(q.subject)))
  let qzTaken = 0
  const qzPcts = []
  for (const q of myQz) {
    const sub = (q.submissions || {})[s.id]
    if (sub && sub.score != null) {
      qzTaken += 1
      const total = q.questions?.length || 0
      if (total > 0) qzPcts.push((sub.score / total) * 100)
    }
  }
  const qzAvg = qzPcts.length ? Math.round(qzPcts.reduce((a, b) => a + b, 0) / qzPcts.length) : null

  const persona = derivePersona({ gwa, attRate, mostImproved, onTimeRate, qzAvg, actSubmitted })

  return {
    student: s,
    semesterLabel: semester?.label || 'This semester',
    subjectCount: subs.length,
    gwa,
    attRate,
    bestSubject,
    mostImproved,
    presentDays,
    perfectSubjects,
    attendedSubjects,
    actSubmitted,
    actOnTime,
    onTimeRate,
    qzTaken,
    qzAvg,
    persona,
    hasData: gwa != null || attRate != null || actSubmitted > 0 || qzTaken > 0,
  }
}
