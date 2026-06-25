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
  computeTerms, computeFinalGradeFromTerms,
  gradeInfo, combineEquiv, round2, DEFAULT_EQ_SCALE,
} from './grades'

// Rounding policy — the ONE place display precision is decided (2 dp).
const r2 = round2

function enrolledIdsOf(s) {
  return s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
}

// ── Activities component ───────────────────────────────────────────────────
// Mean of each activity's percentage over the live activities. A deleted
// activity never counts (reconciled against live ids). Each item carries its
// final pct + a `missing` flag. Returns { pct, items }.
//
// `floor` (e.g. 50) enables the "minimum component grade" policy: every live
// activity counts, a missing submission scores the floor, and a scored item is
// lifted to the floor if it falls below — all per-item, then averaged.
export function deriveActivities(s, sub, activities = [], enrolledIds = enrolledIdsOf(s), floor = 0) {
  const comp = s.gradeComponents?.[sub] || {}
  const liveActs = (activities || []).filter(a => enrolledIds.includes(a.classId) && a.subject === sub)
  const liveActIds = new Set(liveActs.map(a => a.id))
  const hadScores = !!(comp.activityScores && Object.keys(comp.activityScores).length)
  const fl = floor > 0 ? floor : 0
  const norm = (score, max) => (Number(score) / (Number(max) || 100)) * 100
  const withFloor = p => r2(fl ? Math.max(fl, p) : p)

  let items = []
  if (fl && liveActs.length) {
    // Floor policy: every live activity counts; missing = floor.
    items = liveActs.map(a => {
      const raw = (a.submissions || {})[s.id]?.score
      const has = raw != null
      const max = a.maxScore || 100
      return { id: a.id, title: a.title, score: has ? raw : null, max,
        pct: has ? withFloor(norm(raw, max)) : r2(fl), missing: !has }
    })
  } else {
    items = liveActs
      .map(a => ({ id: a.id, title: a.title, score: (a.submissions || {})[s.id]?.score ?? null, max: a.maxScore || 100 }))
      .filter(a => a.score != null)
      .map(a => ({ ...a, pct: withFloor(norm(a.score, a.max)), missing: false }))

    if (!items.length && hadScores) {
      const entries = Object.entries(comp.activityScores)
      const idKeyed = entries.filter(([k]) => liveActIds.has(k))
      if (idKeyed.length) {
        items = idKeyed.map(([k, v]) => {
          const a = liveActs.find(x => x.id === k)
          const max = a?.maxScore || 100
          return { id: k, title: a?.title || '', score: v, max, pct: withFloor(norm(v, max)), missing: false }
        })
      } else if (!liveActs.length && entries.every(([k]) => /^a\d+$/.test(k))) {
        // Legacy doc-less manual entry (teacher typed scores with no activity docs).
        items = entries
          .sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
          .map(([k, v]) => ({ id: k, title: '', score: v, max: 100, pct: withFloor(v), missing: false }))
      }
    }
  }

  const raw = items.length ? items.reduce((t, i) => t + i.pct, 0) / items.length : null
  // Aggregate fallback ONLY when there was never per-activity data to reconcile.
  const pct = raw != null ? r2(raw)
    : (hadScores ? null : (typeof comp.activities === 'number' ? withFloor(comp.activities) : null))
  return { pct, items }
}

// ── Quizzes component ──────────────────────────────────────────────────────
// Mean of each quiz percentage. Prefers the student's own per-quiz results
// cache (reconciled against live quiz ids so a deleted quiz drops out), then
// the teacher's quizScores map, then the stored numeric aggregate. Each item
// carries its pct + a `missing` flag.
//
// `floor` enables the "minimum component grade" policy: every quiz that exists
// for the subject counts, a not-taken quiz scores the floor, and a taken quiz
// is lifted to the floor if below.
export function deriveQuizzes(s, sub, quizzes = [], enrolledIds = enrolledIdsOf(s), floor = 0) {
  const comp = s.gradeComponents?.[sub] || {}
  const liveQuizIds = new Set((quizzes || []).map(q => q.id))
  const subjectQuizzes = (quizzes || []).filter(q => q.subject === sub && (q.classIds || []).some(id => enrolledIds.includes(id)))
  const hadResults = (s.quizResults?.[sub] || []).length > 0
  const hadScores = !!(comp.quizScores && Object.keys(comp.quizScores).length)
  const fl = floor > 0 ? floor : 0
  const withFloor = p => r2(fl ? Math.max(fl, p) : p)
  const resultPct = e => e == null ? null : (e.pct ?? (e.score != null && e.total ? Math.round((e.score / e.total) * 100) : null))

  let items = []
  if (fl && subjectQuizzes.length) {
    // Floor policy: every quiz for the subject counts; not taken = floor.
    const by = {}
    for (const e of (s.quizResults?.[sub] || [])) if (e?.quizId) by[e.quizId] = e
    items = subjectQuizzes.map(q => {
      const p = resultPct(by[q.id])
      return { id: q.id, title: q.title || '', pct: p != null ? withFloor(p) : r2(fl), missing: p == null }
    })
  } else {
    const cached = (s.quizResults?.[sub] || []).filter(e => !e?.quizId || liveQuizIds.has(e.quizId))
    if (cached.length) {
      items = cached.map(q => ({ id: q.quizId || null, title: q.title || '', pct: resultPct(q) }))
        .filter(q => q.pct != null)
        .map(q => ({ ...q, pct: withFloor(q.pct), missing: false }))
    } else if (hadScores) {
      const hasLive = liveQuizIds.size > 0
      const entries = Object.entries(comp.quizScores)
        .filter(([k]) => /^q\d+$/.test(k) ? !hasLive : liveQuizIds.has(k))
      items = entries.map(([k, v]) => ({ id: /^q\d+$/.test(k) ? null : k, title: '', pct: withFloor(v), missing: false }))
    }
  }

  const raw = items.length ? items.reduce((t, q) => t + q.pct, 0) / items.length : null
  // Aggregate fallback ONLY when there was never per-quiz data to reconcile.
  const pct = raw != null ? r2(raw)
    : ((hadResults || hadScores) ? null : (typeof comp.quizzes === 'number' ? withFloor(comp.quizzes) : null))
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
    eqScale = DEFAULT_EQ_SCALE, floor = 0,
  } = ctx
  const enrolledIds = ctx.enrolledIds || enrolledIdsOf(s)
  const mode = opts.mode || 'published'
  const comp = s.gradeComponents?.[sub] || {}

  const act = deriveActivities(s, sub, activities, enrolledIds, floor)
  const qz  = deriveQuizzes(s, sub, quizzes, enrolledIds, floor)
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
    trace: buildTrace({ act, qz, att, attitude, midtermExam, finalsExam, live, midterm, finals, final, equiv, overridden, floor }),
  }
}

// Human-readable, step-by-step trace — the data the student "How is this
// computed?" panel and the AI explainer render. Numbers come straight from the
// engine; nothing is re-derived downstream.
function buildTrace({ act, qz, att, attitude, midtermExam, finalsExam, live, midterm, finals, final, equiv, overridden, floor }) {
  const floorNote = floor > 0 ? `, minimum ${floor}` : ''
  const steps = []
  steps.push({ key: 'activities', label: 'Activities', value: act.pct,
    detail: act.items.map(i => ({ title: i.title, score: i.score, max: i.max, pct: i.pct, missing: i.missing })),
    formula: `average of each activity %${floorNote}` })
  steps.push({ key: 'quizzes', label: 'Quizzes', value: qz.pct,
    detail: qz.items.map(i => ({ title: i.title, pct: i.pct, missing: i.missing })),
    formula: `average of each quiz %${floorNote}` })
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

// ── Integrity auditor ──────────────────────────────────────────────────────
// Compare the teacher's PUBLISHED grade against a fresh LIVE recompute. Drift
// means the saved grade no longer matches the current inputs (e.g. a quiz was
// deleted, an activity graded, attendance recorded) — the teacher should
// recompute & re-publish. Only meaningful for already-published subjects.
export function auditSubjectGrade(s, sub, ctx = {}) {
  const published = computeSubjectGrade(s, sub, ctx, { mode: 'published' })
  const live = computeSubjectGrade(s, sub, ctx, { mode: 'live' })
  const stored = published.final
  const fresh = live.final
  const drift = published.published && stored != null && fresh != null
    && Math.abs(stored - fresh) > 0.01

  // Explain which component moved (stored teacher value vs live recompute).
  const comp = s.gradeComponents?.[sub] || {}
  const reasons = []
  const cmp = (label, was, now) => {
    if (was != null && now != null && Math.abs(was - now) > 0.01) reasons.push(`${label} changed (${was}% → ${now}%)`)
    else if (was != null && now == null) reasons.push(`${label} removed`)
    else if (was == null && now != null) reasons.push(`${label} now graded (${now}%)`)
  }
  cmp('Activities', comp.activities, live.components.activities)
  cmp('Quizzes', comp.quizzes, live.components.quizzes)
  cmp('Attendance', comp.attendance, live.components.attendance)

  return {
    drift,
    published: published.published,
    stored, live: fresh,
    delta: (stored != null && fresh != null) ? r2(Math.abs(stored - fresh)) : null,
    reasons,
    publishedResult: published,
    liveResult: live,
  }
}

// Stable hash of the inputs that produced a grade — lets a published snapshot
// detect when its inputs later changed (drift), and proves reproducibility.
export function gradeInputHash(result) {
  const c = result?.components || {}
  const norm = v => (v == null ? '∅' : Number(v).toFixed(4))
  const base = [c.activities, c.quizzes, c.attendance, c.attitude, result?.midterm, result?.finals, result?.final]
    .map(norm).join(',')
  let h = 0
  for (let k = 0; k < base.length; k++) { h = (h * 31 + base.charCodeAt(k)) | 0 }
  return 'g_' + (h >>> 0).toString(36)
}

// Deterministic, plain-language summary of a computed grade — grounded strictly
// in the engine's numbers (no model, no invented values), so it can never
// disagree with the figures shown. Powers the student "explain my grade" view.
export function explainGradeText(result) {
  if (!result) return ''
  const c = result.components
  const parts = []
  if (c.activities != null) parts.push(`activities ${c.activities}%`)
  if (c.quizzes != null)    parts.push(`quizzes ${c.quizzes}%`)
  if (c.attendance != null) parts.push(`attendance ${c.attendance}%`)
  if (c.attitude != null)   parts.push(`attitude ${c.attitude}%`)
  let txt = ''
  if (parts.length && result.cs != null) {
    txt += `Your Class Standing is the average of ${parts.join(', ')} — that comes to ${result.cs}%. `
  }
  if (result.midterm != null && result.finals != null) {
    txt += `Your Midterm Term (${result.midterm}%) and Finals Term (${result.finals}%) each average that Class Standing with the matching exam, and your Final Grade (${result.final}%) is the average of those two terms`
  } else if (result.midterm != null) {
    txt += `So far only the midterm is in: your Midterm Term is ${result.midterm}%`
  } else if (result.final != null) {
    txt += `Your current standing is ${result.final}%`
  } else {
    return 'Your grade has not been computed yet — no components have been recorded.'
  }
  if (result.equiv?.eq && result.equiv.eq !== '—') {
    txt += `, equivalent to ${result.equiv.eq}${result.equiv.rem && result.equiv.rem !== 'No Grade' ? ` (${result.equiv.rem})` : ''}.`
  } else {
    txt += '.'
  }
  return txt
}
