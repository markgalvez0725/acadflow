// ── AcadFlow Verified Grading — single source of truth ─────────────────────
//
// One deterministic engine that EVERY screen and export calls, so the same
// inputs always produce the same number — to the last decimal — on the student
// page, the teacher gradebook, and the Excel/report-card exports. There must be
// exactly one implementation of each formula; do not re-derive grades inline
// anywhere else.
//
// The pure math (CS / term / final / equivalency) lives in `grades.js`; this
// module owns (a) deriving the four class-standing components from the *live*
// activities/quizzes/attendance data (deletion-safe, reconciled against what
// still exists) and (b) assembling a full, student-readable computation trace.
//
// Reliability rules:
//   • Components are derived from LIVE data, then fall back to the teacher's
//     stored aggregate only when there is nothing live to reconcile against.
//   • One rounding policy: components & terms display at 2 dp; intermediate
//     means stay full-precision (see grades.js). Never round twice.
//   • Two modes — 'published' (what the student sees: final from the teacher's
//     saved term grades) and 'live' (recompute everything from raw inputs, used
//     by the gradebook).

import {
  scoredPercent, computeTerms, computeFinalGradeFromTerms,
  gradeInfo, combineEquiv, round2, DEFAULT_EQ_SCALE,
} from './grades'

// Rounding policy — the ONE place display precision is decided (2 dp).
const r2 = round2

function enrolledIdsOf(s) {
  return s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
}

// ── Activities component ───────────────────────────────────────────────────
// Mean of (score ÷ maxScore × 100) over the live activities the student was
// graded on. Cached gradeComponents.activityScores are only used to backfill
// when there are no live submissions, and only for activities that still exist
// (id-keyed) — a deleted activity never counts. Returns { pct, items }.
export function deriveActivities(s, sub, activities = [], enrolledIds = enrolledIdsOf(s)) {
  const comp = s.gradeComponents?.[sub] || {}
  const liveActs = (activities || []).filter(a => enrolledIds.includes(a.classId) && a.subject === sub)
  const liveActIds = new Set(liveActs.map(a => a.id))

  const panel = liveActs.map(a => ({
    id: a.id, title: a.title,
    score: (a.submissions || {})[s.id]?.score ?? null,
    max: a.maxScore || 100,
  }))
  let items = panel.filter(a => a.score != null)

  if (!items.length && comp.activityScores && Object.keys(comp.activityScores).length) {
    const entries = Object.entries(comp.activityScores)
    const idKeyed = entries.filter(([k]) => liveActIds.has(k))
    if (idKeyed.length) {
      items = idKeyed.map(([k, v]) => {
        const a = liveActs.find(x => x.id === k)
        return { id: k, title: a?.title || '', score: v, max: a?.maxScore || 100 }
      })
    } else if (!liveActs.length && entries.every(([k]) => /^a\d+$/.test(k))) {
      // Legacy doc-less manual entry (teacher typed scores with no activity docs).
      items = entries
        .sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
        .map(([k, v]) => ({ id: k, title: '', score: v, max: 100 }))
    }
  }

  const raw = items.length ? scoredPercent(items.map(i => ({ score: i.score, maxScore: i.max }))) : null
  // Fall back to the teacher's stored aggregate only when nothing is derivable.
  const pct = raw != null ? r2(raw) : (typeof comp.activities === 'number' ? comp.activities : null)
  return { pct, items }
}

// ── Quizzes component ──────────────────────────────────────────────────────
// Mean of each quiz percentage. Prefers the student's own per-quiz results
// cache (reconciled against live quiz ids so a deleted quiz drops out), then
// the teacher's quizScores map, then the stored numeric aggregate.
export function deriveQuizzes(s, sub, quizzes = []) {
  const comp = s.gradeComponents?.[sub] || {}
  const liveQuizIds = new Set((quizzes || []).map(q => q.id))

  const cached = (s.quizResults?.[sub] || [])
    .filter(e => !e?.quizId || liveQuizIds.has(e.quizId))
  let items = []

  if (cached.length) {
    items = cached.map(q => ({
      id: q.quizId || null, title: q.title || '',
      pct: q.pct ?? (q.score != null && q.total ? Math.round((q.score / q.total) * 100) : null),
    })).filter(q => q.pct != null)
  } else if (comp.quizScores && Object.keys(comp.quizScores).length) {
    const hasLive = liveQuizIds.size > 0
    const entries = Object.entries(comp.quizScores)
      .filter(([k]) => /^q\d+$/.test(k) ? !hasLive : liveQuizIds.has(k))
    items = entries.map(([k, v]) => ({ id: /^q\d+$/.test(k) ? null : k, title: '', pct: v }))
  }

  const raw = items.length
    ? items.reduce((t, q) => t + q.pct, 0) / items.length
    : null
  const pct = raw != null ? r2(raw) : (typeof comp.quizzes === 'number' ? comp.quizzes : null)
  return { pct, items }
}

// ── Attendance component ───────────────────────────────────────────────────
// present ÷ sessions-held × 100 for the subject. "Held" is the most attendance+
// excuse records any enrolled classmate has (handles cross-enrolled sections).
export function deriveAttendance(s, sub, students = [], classes = [], enrolledIds = enrolledIdsOf(s)) {
  const attSet = s.attendance?.[sub] || new Set()
  const classIdsForSub = enrolledIds.filter(id => classes.find(c => c.id === id)?.subjects?.includes(sub))
  const classMates = classIdsForSub.length
    ? students.filter(x => (x.classIds?.some(id => classIdsForSub.includes(id))) || classIdsForSub.includes(x.classId))
    : [s]
  const held = [...classMates, s].reduce((mx, x) => {
    const sz = (x.attendance?.[sub] || new Set()).size + (x.excuse?.[sub] || new Set()).size
    return Math.max(mx, sz)
  }, 0)
  const pct = held > 0 ? r2((attSet.size / held) * 100) : null
  return { pct, present: attSet.size, held }
}

// ── Full subject computation + trace ───────────────────────────────────────
// ctx: { activities, quizzes, students, classes, eqScale, enrolledIds }
// opts.mode: 'published' (default — final from the teacher's saved terms) or
//            'live' (recompute terms from the live components).
export function computeSubjectGrade(s, sub, ctx = {}, opts = {}) {
  const {
    activities = [], quizzes = [], students = [], classes = [],
    eqScale = DEFAULT_EQ_SCALE,
  } = ctx
  const enrolledIds = ctx.enrolledIds || enrolledIdsOf(s)
  const mode = opts.mode || 'published'
  const comp = s.gradeComponents?.[sub] || {}

  const act = deriveActivities(s, sub, activities, enrolledIds)
  const qz  = deriveQuizzes(s, sub, quizzes)
  const att = deriveAttendance(s, sub, students, classes, enrolledIds)
  const attitude = comp.attitude ?? null
  const midtermExam = comp.midtermExam ?? null
  const finalsExam  = comp.finalsExam ?? null

  const components = { activities: act.pct, quizzes: qz.pct, attendance: att.pct, attitude }

  // Live recompute of CS / terms / final from the components above.
  const live = computeTerms({
    activities: act.pct, quizzes: qz.pct, attendance: att.pct, attitude,
    midtermExam, finalsExam,
  })

  // Published view: the student's grade is the teacher's saved term grades.
  const midterm = mode === 'live' ? live.midterm : (comp.midterm ?? live.midterm)
  const finals  = mode === 'live' ? live.finals  : (comp.finals  ?? live.finals)
  const ts = s.gradeUploadedAt?.[sub]

  // Final %: in published mode the authoritative grade is the teacher's SAVED
  // final (computed at full precision on save, or a manual override) — show that
  // verbatim so the student matches the gradebook exactly; fall back to deriving
  // from the term grades. In live mode, always the fresh recompute.
  const derived = computeFinalGradeFromTerms(midterm, finals)
  const saved = s.grades?.[sub]
  const final = mode === 'live'
    ? live.final
    : (saved != null ? r2(saved) : derived)
  // Flag a genuine manual override (saved far from the computed value) so the
  // trace can say so; rounding-level gaps are not overrides.
  const overridden = mode === 'published' && saved != null && derived != null
    && Math.abs(saved - derived) > 0.5

  const midEq = midterm != null ? gradeInfo(midterm, eqScale).eq : '—'
  const finEq = finals  != null ? gradeInfo(finals,  eqScale).eq : '—'
  const equiv = combineEquiv(midEq, finEq)

  const published = !!(comp.midterm != null && comp.finals != null && ts)

  return {
    components,
    cs: r2(live.cs),
    midterm: midterm != null ? r2(midterm) : null,
    finals:  finals  != null ? r2(finals)  : null,
    final,
    equiv: { midEq, finEq, ...equiv },
    published,
    uploadedAt: ts || null,
    detail: { activityItems: act.items, quizItems: qz.items, attendance: att },
    trace: buildTrace({ act, qz, att, attitude, midtermExam, finalsExam, live, midterm, finals, final, equiv, overridden }),
  }
}

// Human-readable, step-by-step trace — the data the student "How is this
// computed?" panel and the AI explainer render. Numbers come straight from the
// engine; nothing is re-derived downstream.
function buildTrace({ act, qz, att, attitude, midtermExam, finalsExam, live, midterm, finals, final, equiv, overridden }) {
  const steps = []
  steps.push({ key: 'activities', label: 'Activities', value: act.pct,
    detail: act.items.map(i => ({ title: i.title, score: i.score, max: i.max, pct: i.max ? round2((i.score / i.max) * 100) : null })),
    formula: 'average of (score ÷ max × 100)' })
  steps.push({ key: 'quizzes', label: 'Quizzes', value: qz.pct,
    detail: qz.items.map(i => ({ title: i.title, pct: i.pct })),
    formula: 'average of each quiz %' })
  steps.push({ key: 'attendance', label: 'Attendance', value: att.pct,
    detail: { present: att.present, held: att.held },
    formula: 'present ÷ sessions held × 100' })
  steps.push({ key: 'attitude', label: 'Attitude / Character', value: attitude, formula: 'teacher input' })
  steps.push({ key: 'cs', label: 'Class Standing', value: round2(live.cs),
    formula: 'average of activities, quizzes, attendance, attitude' })
  if (midtermExam != null) steps.push({ key: 'midterm', label: 'Midterm Term', value: round2(midterm),
    formula: 'average of Class Standing and Midterm Exam (' + midtermExam + ')' })
  if (finalsExam != null) steps.push({ key: 'finals', label: 'Finals Term', value: round2(finals),
    formula: 'average of Class Standing and Finals Exam (' + finalsExam + ')' })
  steps.push({ key: 'final', label: 'Final Grade', value: final,
    formula: overridden ? 'manual grade set by teacher' : 'average of Midterm Term and Finals Term' })
  steps.push({ key: 'equiv', label: 'Equivalent', value: equiv.eq, remark: equiv.rem })
  return steps
}
