import React, { useState, useMemo } from 'react'
import { gradeInfo, combineEquiv, computeFinalGradeFromTerms } from '@/utils/grades'
import { computeSubjectGrade, auditSubjectGrade, explainGradeText } from '@/utils/gradeEngine'
import { useData } from '@/context/DataContext'
import { BookOpen, Clock, ChevronDown, ChevronUp, Check, CheckCircle2, RefreshCw, Target, MessageSquare, ShieldCheck, AlertTriangle, Hourglass, ListOrdered } from 'lucide-react'
import { activeSubjects } from '@/utils/active'
import EmptyState from '@/components/ds/EmptyState'
import PageHeader from '@/components/ds/PageHeader'
import { neededFinalsForRemarks, neededFinalsForEq } from '@/utils/whatIf'
import RegradeRequestModal from '@/components/student/modals/RegradeRequestModal'
import StudentMeta from '@/components/primitives/StudentMeta'
import StandingRing from '@/components/primitives/StandingRing'

// This tab's original color semantics: 75 is the passing grade, so ≥75 reads
// green here (unlike utils/grades.pctColor, whose ≥85/≥75 bands would recolor
// passing scores as warnings).
const gcolor = v => (v == null ? 'var(--ink3)' : v >= 75 ? 'var(--green)' : v >= 60 ? 'var(--yellow)' : 'var(--red)')

// Personal target equivalencies a student can pin per subject (1.00 best).
const GOAL_OPTIONS = ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50', '2.75', '3.00']

export default function GradesTab({ student: s, viewClassId, classes }) {
  const { activities, quizzes, students, eqScale, semester, gradeFloor } = useData()
  const [regradeOpen, setRegradeOpen] = useState(false)
  const [watchOpen, setWatchOpen] = useState(false)

  // Current, non-archived classes only - archived/ended/removed subjects drop off.
  const subs = activeSubjects(s, classes, semester)

  // One engine pass per subject, shared by the Grade Watch findings and the
  // cards below, so a finding can never disagree with the card it points at.
  // The engine keeps receiving the same raw enrollment it always has.
  const rows = useMemo(() => {
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const ctx = { activities, quizzes, students, classes, eqScale, enrolledIds, floor: gradeFloor }
    return subs.map(sub => {
      const gr = computeSubjectGrade(s, sub, ctx)
      const audit = gr.published ? auditSubjectGrade(s, sub, ctx) : null
      return { sub, gr, audit }
    })
  }, [subs, s, activities, quizzes, students, classes, eqScale, gradeFloor])

  // GWA equivalency: average of uploaded subject equivalencies (true 1.00-5.00 scale)
  const gwaData = useMemo(() => {
    const equivNums = subs
      .map(sub => {
        const comp = s.gradeComponents?.[sub] || {}
        const midG = comp.midterm ?? null
        const finG = comp.finals  ?? null
        const ts   = s.gradeUploadedAt?.[sub]
        if (midG == null || finG == null || !ts) return null
        const eq = combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq).eq
        return typeof eq === 'number' ? eq : parseFloat(eq)
      })
      .filter(v => v != null && !isNaN(v))
    if (!equivNums.length) return null
    const avg = parseFloat((equivNums.reduce((t, v) => t + v, 0) / equivNums.length).toFixed(2))
    const remarks = avg <= 1.5 ? 'Excellent' : avg <= 2.0 ? 'Very Good' : avg <= 2.5 ? 'Good' : avg <= 3.0 ? 'Passed' : 'Conditional'
    const color   = avg <= 2.0 ? 'var(--green)' : avg <= 3.0 ? 'var(--yellow)' : 'var(--red)'
    return { avg, remarks, color, count: equivNums.length, total: subs.length }
  }, [subs, s, eqScale])

  // Grade Watch: deterministic findings recomputed from the exact engine
  // numbers the cards render. No network, no stored state.
  const watch = useMemo(() => {
    const f = []

    // Unsubmitted activities/quizzes dragging class standing down.
    rows.forEach(({ sub, gr }) => {
      const miss = gr.detail.activityItems.filter(a => a.missing).length
                 + gr.detail.quizItems.filter(q => q.missing).length
      if (miss > 0) {
        f.push({ tone: 'bad', Icon: AlertTriangle, lead: sub, text: ` - ${miss} item${miss !== 1 ? 's' : ''} not submitted, pulling your class standing down.` })
      }
    })

    // Midterm posted, finals still open: surface the pass threshold.
    rows.forEach(({ sub, gr }) => {
      if (gr.midterm == null || gr.finals != null) return
      const needs = neededFinalsForRemarks(gr.midterm, eqScale)
      const pass = needs?.Passed
      if (pass == null) {
        f.push({ tone: 'bad', Icon: AlertTriangle, lead: sub, text: ' - a passing final grade is out of reach from the midterm alone; talk to your professor about your options.' })
      } else if (pass <= 0) {
        f.push({ tone: 'good', Icon: CheckCircle2, lead: sub, text: ' - a passing final grade is already secured before Finals.' })
      } else {
        f.push({ tone: 'warn', Icon: Target, lead: sub, text: ` - finals pending; score at least ${Math.round(pass * 10) / 10}% on the Finals term to pass.` })
      }
    })

    // Personal goals: progress toward the pinned target equivalency.
    rows.forEach(({ sub, gr }) => {
      const goal = s.goals?.[sub]
      if (!goal) return
      if (gr.published && gr.midterm != null && gr.finals != null) {
        const eqN = parseFloat(gr.equiv.eq)
        if (isNaN(eqN)) return
        if (eqN <= parseFloat(goal)) {
          f.push({ tone: 'good', Icon: Target, lead: sub, text: ` - goal reached: your final grade ${gr.equiv.eq} meets your ${goal} target.` })
        } else {
          f.push({ tone: 'info', Icon: Target, lead: sub, text: ` - your final grade ${gr.equiv.eq} landed short of your ${goal} goal.` })
        }
      } else if (gr.midterm != null && gr.finals == null) {
        const need = neededFinalsForEq(gr.midterm, goal, eqScale)
        if (need == null) {
          f.push({ tone: 'warn', Icon: Target, lead: sub, text: ` - your ${goal} goal is out of reach from the midterm alone; focus on the passing threshold below.` })
        } else if (need <= 0) {
          f.push({ tone: 'good', Icon: Target, lead: sub, text: ` - your ${goal} goal is already secured before Finals.` })
        } else {
          f.push({ tone: 'warn', Icon: Target, lead: sub, text: ` - score at least ${Math.round(need * 10) / 10}% on the Finals term to reach your ${goal} goal.` })
        }
      }
    })

    // Posted grades whose source items changed since upload.
    rows.forEach(({ sub, audit }) => {
      if (audit?.drift) {
        f.push({ tone: 'info', Icon: RefreshCw, lead: sub, text: ' - some items changed after the grade was posted; your professor will re-sync it.' })
      }
    })

    // Posted grades that still match the live records.
    const verified = rows.filter(r => r.audit && !r.audit.drift).map(r => r.sub)
    if (verified.length === 1) {
      f.push({ tone: 'good', Icon: ShieldCheck, lead: verified[0], text: ' verified - the posted grade matches your current activities, quizzes, and attendance.' })
    } else if (verified.length > 1) {
      const names = verified.slice(0, 3).join(', ') + (verified.length > 3 ? '…' : '')
      f.push({ tone: 'good', Icon: ShieldCheck, lead: `${verified.length} subjects verified`, text: ` - posted grades match your live records (${names}).` })
    }

    // Subjects with nothing posted at all.
    const blank = rows.filter(r => r.gr.midterm == null && r.gr.finals == null).map(r => r.sub)
    if (blank.length) {
      const names = blank.slice(0, 3).join(', ') + (blank.length > 3 ? '…' : '')
      f.push({ tone: 'info', Icon: Hourglass, lead: `${blank.length} awaiting grades`, text: ` - nothing posted yet for ${names}.` })
    }

    if (!f.length) {
      f.push({ tone: 'good', Icon: CheckCircle2, lead: "You're all caught up", text: ' - nothing needs attention.' })
    }

    const rank = { bad: 0, warn: 1, info: 2, good: 3 }
    f.sort((a, b) => rank[a.tone] - rank[b.tone])
    return { findings: f.slice(0, 6) }
  }, [rows, eqScale, s])

  if (!subs.length) {
    return (
      <EmptyState
        Icon={BookOpen}
        title="No subjects enrolled yet"
        text="Your grades by subject appear here once you're enrolled."
      />
    )
  }

  const postedCount = rows.filter(r => r.gr.published).length
  const pendingCount = subs.length - postedCount
  const ringRate = gwaData ? Math.round(((5 - gwaData.avg) / 4) * 100) : 0

  return (
    <div className="student-grades">
      <PageHeader
        title="Grade Breakdown"
        subtitle={`${subs.length} subject${subs.length !== 1 ? 's' : ''} · ${postedCount} posted${pendingCount ? ` · ${pendingCount} pending` : ''}`}
        actions={
          <button className="btn btn-ghost btn-sm" onClick={() => setRegradeOpen(true)} title="Ask your professor to review a grade">
            <RefreshCw size={14} /> Request regrade
          </button>
        }
      />
      {regradeOpen && (
        <RegradeRequestModal student={s} subjects={subs} onClose={() => setRegradeOpen(false)} />
      )}

      {/* GWA ring + Grade Watch */}
      <div className="sact-top">
        <div className="sact-card sact-ring-card">
          <StandingRing
            rate={ringRate}
            color={gwaData ? gwaData.color : 'var(--ink3)'}
            label="GWA"
            formatValue={() => (gwaData ? gwaData.avg.toFixed(2) : '-')}
          />
          <div className="sact-ring-meta">
            {gwaData
              ? <>
                  <strong style={{ color: gwaData.color }}>{gwaData.remarks}</strong><br />
                  {gwaData.count} of {gwaData.total} subject{gwaData.total !== 1 ? 's' : ''} with uploaded grades<br />
                  <StudentMeta student={s} />
                </>
              : <>
                  <strong>No GWA yet</strong><br />
                  Appears once both terms are posted for a subject.<br />
                  <StudentMeta student={s} />
                </>}
          </div>
        </div>

        <div className="sact-card sact-watch">
          <div className="sact-watch-h">
            <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />
            <span className="sact-watch-title">Grade Watch</span>
            <span className="sact-chip-tag">on-device</span>
          </div>
          <div className="sact-watch-lead">Every finding is recomputed on this device from the same engine numbers the cards below show.</div>
          <div className={`sgw-list${watchOpen ? ' open' : ''}`}>
            {watch.findings.map((fd, i) => (
              <div key={i} className={`sact-find sact-find-${fd.tone}`}>
                <fd.Icon size={16} />
                <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
              </div>
            ))}
          </div>
          {watch.findings.length > 1 && (
            <button className="sgw-more" onClick={() => setWatchOpen(v => !v)} type="button">
              {watchOpen ? <>Show less <ChevronUp size={12} /></> : <>Show all {watch.findings.length} findings <ChevronDown size={12} /></>}
            </button>
          )}
        </div>
      </div>

      {/* Compact subject cards */}
      <div className="sact-grid">
        {rows.map(({ sub, gr, audit }) => (
          <SubjectCard key={sub} sub={sub} student={s} gr={gr} audit={audit} eqScale={eqScale} />
        ))}
      </div>
    </div>
  )
}

// ── What-if calculator: shown when the midterm is in but finals isn't yet ─────
function WhatIfPanel({ midTerm, eqScale, goal }) {
  const [val, setVal] = useState('')
  const needs = useMemo(() => neededFinalsForRemarks(midTerm, eqScale), [midTerm, eqScale])
  const goalNeed = useMemo(() => (goal ? neededFinalsForEq(midTerm, goal, eqScale) : null), [midTerm, goal, eqScale])

  const f = val === '' ? null : Math.max(0, Math.min(100, parseFloat(val)))
  let proj = null
  if (f != null && !isNaN(f)) {
    const finalPct = computeFinalGradeFromTerms(midTerm, f)
    const c = combineEquiv(gradeInfo(midTerm, eqScale).eq, gradeInfo(f, eqScale).eq)
    proj = { finalPct, eq: c.eq, rem: c.rem }
  }

  const passNeed = needs?.Passed
  const condNeed = needs?.Conditional
  const fmtNeed = n => (n == null ? null : (n <= 0 ? 0 : Math.round(n * 10) / 10))

  return (
    <div style={{ border: '1px dashed var(--border2)', borderRadius: 10, padding: '12px 14px', marginTop: 12, background: 'var(--surface2)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Target size={13} /> What do I need on Finals?
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.7 }}>
        {passNeed == null
          ? <div>A passing grade isn't reachable from your midterm alone - talk to your professor about your options.</div>
          : passNeed <= 0
            ? <div style={{ color: 'var(--green)' }}>You've already secured a passing final grade.</div>
            : <div>Score at least <strong style={{ color: 'var(--green)' }}>{fmtNeed(passNeed)}%</strong> on your Finals term to <strong>pass</strong>.</div>}
        {condNeed != null && condNeed > 0 && passNeed > 0 && (
          <div>At least <strong style={{ color: 'var(--yellow)' }}>{fmtNeed(condNeed)}%</strong> to avoid failing.</div>
        )}
        {goal && (
          goalNeed == null
            ? <div>Your <strong>{goal}</strong> goal isn't reachable this term - it stays as motivation for the next one.</div>
            : goalNeed <= 0
              ? <div style={{ color: 'var(--green)' }}>Your <strong>{goal}</strong> goal is already secured.</div>
              : <div>At least <strong style={{ color: 'var(--accent)' }}>{fmtNeed(goalNeed)}%</strong> to reach your <strong>{goal}</strong> goal.</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink2)' }}>Try a finals score:</span>
        <input
          className="input" type="number" min="0" max="100" value={val}
          onChange={e => setVal(e.target.value)} placeholder="0-100"
          style={{ width: 90, fontSize: 13 }}
        />
        {proj && (
          <span style={{ fontSize: 12, color: 'var(--ink)' }}>
            → final <strong>{proj.finalPct}%</strong> · <strong>{proj.eq}</strong>{' '}
            <span className={`badge ${proj.rem === 'Passed' ? 'badge-green' : proj.rem === 'Conditional' ? 'badge-yellow' : 'badge-red'}`}>{proj.rem}</span>
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 8 }}>
        Final grade = average of your Midterm and Finals term grades. Estimate only.
      </div>
    </div>
  )
}

function SubjectCard({ sub, student: s, gr, audit, eqScale }) {
  const { setGradeGoal } = useData()
  const [showTrail, setShowTrail] = useState(false)
  const [showScores, setShowScores] = useState(false)

  const comp = s.gradeComponents?.[sub] || {}
  const goal = s.goals?.[sub] || ''

  // Every number shown comes from the one GradeEngine pass done in the parent,
  // so the card agrees with the professor's gradebook and the exports.
  const explanation = explainGradeText(gr)

  const midG = gr.midterm          // midterm TERM grade %
  const finG = gr.finals           // finals  TERM grade %
  const midExamRaw = comp.midtermExam ?? null  // raw midterm exam score
  const finExamRaw = comp.finalsExam  ?? null  // raw finals  exam score
  const ts = gr.uploadedAt
  const published = gr.published
  const g = gr.final

  const eq  = gr.equiv.eq
  const rem = published ? gr.equiv.rem : 'Pending'
  const remColor = rem === 'Passed' ? 'var(--green)' : rem === 'Conditional' ? 'var(--yellow)' : rem === 'Failed' ? 'var(--red)' : 'var(--ink3)'

  // Class-standing components - all straight from the engine.
  const actVal      = gr.components.activities
  const quizzesAvg  = gr.components.quizzes
  const attRate     = gr.components.attendance
  const attitudeVal = gr.components.attitude
  const cs          = gr.cs
  const midEq = gr.equiv.midEq === '-' ? null : gr.equiv.midEq
  const finEq = gr.equiv.finEq === '-' ? null : gr.equiv.finEq

  // Per-activity / per-quiz detail rows - sourced from the same engine
  // derivation as the averages above, so rows and averages can never disagree.
  const displayActs = gr.detail.activityItems.map(i => ({ title: i.title, score: i.score, max: i.max, pct: i.pct, missing: i.missing }))
  const qzEntries   = gr.detail.quizItems.map((q, i) => [`q${i + 1}`, q.pct, q.title || null, q.missing])

  const compAny = [actVal, quizzesAvg, attRate, attitudeVal].some(v => v != null)
  const hasAny = compAny || midG != null || finG != null
  const hasTrailData = midG != null || finG != null
  const itemCount = displayActs.length + qzEntries.length
  const hasScores = itemCount > 0 || comp.activities != null || quizzesAvg != null

  const gradeColor = g != null ? gcolor(g) : 'var(--ink3)'

  const csParts = [
    actVal      != null && `acts ${actVal}%`,
    quizzesAvg  != null && `quiz ${quizzesAvg}%`,
    attRate     != null && `attnd ${attRate}%`,
    attitudeVal != null && `attitude ${attitudeVal}%`,
  ].filter(Boolean).join(' · ')

  return (
    <div className="sact-card sgc-card">
      {/* ── Header ── */}
      <div className="sgc-head">
        <div className="sgc-title">
          <div className="sg-subject-name">{sub}</div>
          <div className="sg-upload-label">
            {ts
              ? <span className="sg-upload-status sg-upload-status--done">
                  <Check size={13} /> Uploaded {new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              : <span className="sg-upload-status"><Clock size={12} /> Pending upload</span>}
          </div>
        </div>
        <div className="sgc-grade">
          <div className="sgc-eq" style={{ color: published && eq !== '-' ? gradeColor : 'var(--ink3)' }} title={g != null ? `${g}%` : ''}>
            {published && eq !== '-' ? eq : '-'}
          </div>
          {published && eq !== '-'
            ? <div className="sgc-pct">{g != null ? `${g}% · ` : ''}<span style={{ color: remColor, fontWeight: 700 }}>{rem}</span></div>
            : <div className="sgc-pct">Pending</div>}
        </div>
      </div>

      {/* ── Term + audit chips ── */}
      <div className="sgc-chips">
        <span className="sgc-chip">
          Mid {midG != null ? <strong style={{ color: gcolor(midG) }}>{midG}%</strong> : '-'}
          {midG != null && midEq != null && <span style={{ color: 'var(--ink3)' }}> · {midEq}</span>}
        </span>
        <span className="sgc-chip">
          Fin {finG != null ? <strong style={{ color: gcolor(finG) }}>{finG}%</strong> : '-'}
          {finG != null && finEq != null && <span style={{ color: 'var(--ink3)' }}> · {finEq}</span>}
        </span>
        {audit && !audit.drift && <span className="sgc-chip sgc-chip-ok"><ShieldCheck size={11} /> Verified</span>}
        {audit?.drift && <span className="sgc-chip sgc-chip-warn"><RefreshCw size={11} /> Re-sync pending</span>}
        <select
          className="sgc-chip sgc-goal"
          value={goal}
          onChange={e => setGradeGoal(s.id, sub, e.target.value || null)}
          title="Pin a personal target grade - Grade Watch tracks your progress toward it"
          aria-label={`Grade goal for ${sub}`}
          style={{
            cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', fontFamily: 'inherit',
            border: `1px solid ${goal ? 'var(--accent)' : 'var(--border)'}`,
            color: goal ? 'var(--accent)' : 'var(--ink3)',
            background: 'transparent', fontWeight: goal ? 700 : 500,
          }}
        >
          <option value="">Set goal</option>
          {GOAL_OPTIONS.map(g => <option key={g} value={g}>Goal: {g}</option>)}
        </select>
      </div>

      {/* ── Note from professor (plain text, React-escaped) ── */}
      {s.gradeNotes?.[sub]?.text && (
        <div style={{ margin: '10px 0 0', padding: '9px 12px', borderLeft: '3px solid var(--accent)', background: 'var(--accent-l)', borderRadius: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--accent)', marginBottom: 3 }}>
            <MessageSquare size={13} /> Note from {s.gradeNotes[sub].by || 'your professor'}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{s.gradeNotes[sub].text}</div>
        </div>
      )}

      {/* ── Class-standing mini bars ── */}
      {compAny && (
        <div className="sgc-comps">
          {[['Acts', actVal], ['Quiz', quizzesAvg], ['Attnd', attRate], ['Attitude', attitudeVal]].map(([lb, v]) => (
            <div key={lb} title={v != null ? `${lb}: ${v}%` : `${lb}: no data yet`}>
              <div className="sgc-comp-lb" style={v == null ? { opacity: .55 } : undefined}>{lb}{v != null ? ` ${v}%` : ''}</div>
              <div className="sgc-comp-track">
                {v != null && <div className="sgc-comp-fill" style={{ width: `${Math.min(100, Math.max(0, v))}%`, background: gcolor(v) }} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── What-if calculator (midterm in, finals still pending) ── */}
      {midG != null && finG == null && (
        <WhatIfPanel midTerm={midG} eqScale={eqScale} goal={goal} />
      )}

      {!hasAny && (
        <div className="sg-no-data">No grade components uploaded yet.</div>
      )}

      {/* ── In-place expanders ── */}
      {(hasTrailData || hasScores) && (
        <div className="sgc-foot">
          {hasTrailData && (
            <button className="sgc-x" onClick={() => setShowTrail(v => !v)} type="button">
              <ListOrdered size={13} /> How it's computed {showTrail ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          {hasScores && (
            <button className="sgc-x sgc-x-dim" onClick={() => setShowScores(v => !v)} type="button">
              Scores{itemCount ? ` (${itemCount})` : ''} {showScores ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
      )}

      {/* ── Computation trail: plain-language explanation + step strip ── */}
      {showTrail && (
        <div className="sgc-trail">
          {explanation && <p className="sgc-explain">{explanation}</p>}
          {audit && (
            <div className="sgc-audit" style={{ color: audit.drift ? 'var(--gold-var)' : 'var(--green)', background: audit.drift ? 'var(--yellow-l)' : 'var(--green-l)' }}>
              {audit.drift ? <RefreshCw size={14} /> : <Check size={14} />}
              {audit.drift
                ? 'Some items changed after this grade was posted - your professor will re-sync it.'
                : 'Verified - this grade matches your current activities, quizzes, and attendance.'}
            </div>
          )}
          <div className="sgc-strip">
            {(cs != null || compAny) && (
              <div className="sgc-step">
                <div className="sgc-step-lb">① Class standing</div>
                <div className="sgc-step-val">{cs != null ? `${cs}%` : '-'}</div>
                {csParts && <div className="sgc-step-sub">{csParts}</div>}
              </div>
            )}
            {midG != null && (
              <div className="sgc-step">
                <div className="sgc-step-lb">② Midterm term</div>
                <div className="sgc-step-val">{midG}%{midEq != null ? ` · ${midEq}` : ''}</div>
                <div className="sgc-step-sub">{cs != null && midExamRaw != null ? `CS ${cs}% + exam ${midExamRaw}%` : 'class standing + midterm exam'}</div>
              </div>
            )}
            {finG != null && (
              <div className="sgc-step">
                <div className="sgc-step-lb">③ Finals term</div>
                <div className="sgc-step-val">{finG}%{finEq != null ? ` · ${finEq}` : ''}</div>
                <div className="sgc-step-sub">{cs != null && finExamRaw != null ? `CS ${cs}% + exam ${finExamRaw}%` : 'class standing + finals exam'}</div>
              </div>
            )}
            {midG != null && finG != null && eq !== '-' && (
              <div className="sgc-step sgc-step--final">
                <div className="sgc-step-lb">④ Final grade</div>
                <div className="sgc-step-val">{eq}{rem !== 'Pending' ? ` · ${rem}` : ''}</div>
                <div className="sgc-step-sub">school equivalency table{g != null ? ` · ${g}%` : ''}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Per-item scores ── */}
      {showScores && (
        <div className="sgc-scores">
          {displayActs.length > 0 && (
            <div className="sg-score-block">
              <div className="sg-section-label">Activity Scores</div>
              {displayActs.map((a, i) => {
                const col = a.pct == null ? 'var(--ink3)' : gcolor(a.pct)
                const rawPct = a.score != null && a.max ? (a.score / a.max) * 100 : null
                const floored = !a.missing && rawPct != null && Math.abs(a.pct - rawPct) > 0.01
                const label = a.title
                  ? `Activity ${i + 1} - ${a.title.slice(0, 35)}${a.title.length > 35 ? '…' : ''}`
                  : `Activity ${i + 1}`
                return (
                  <div key={i} className="sg-score-row">
                    <span className="sg-score-label">{label}{a.missing && <span style={{ color: 'var(--ink3)', fontWeight: 400 }}> · not submitted</span>}</span>
                    <span className="sg-score-val" style={{ color: col }}>
                      {a.missing
                        ? `${a.pct}%`
                        : a.score != null
                          ? `${a.score}${a.max !== 100 ? `/${a.max}` : '%'}${floored ? ` → ${a.pct}%` : ''}`
                          : `${a.pct}%`}
                    </span>
                  </div>
                )
              })}
              {actVal != null && (
                <div className="sg-score-avg">
                  <span>Average</span>
                  <span style={{ color: 'var(--accent)' }}>{actVal}%</span>
                </div>
              )}
            </div>
          )}
          {displayActs.length === 0 && comp.activities != null && (
            <div className="sg-score-block">
              <div className="sg-section-label">Activity Score</div>
              <div className="sg-score-avg">
                <span>Overall Average</span>
                <span style={{ color: gcolor(comp.activities) }}>{comp.activities}%</span>
              </div>
            </div>
          )}

          {qzEntries.length > 0 && (
            <div className="sg-score-block">
              <div className="sg-section-label">Quiz Scores</div>
              {qzEntries.map(([k, v, title, missing]) => {
                const num = parseInt(k.slice(1))
                const col = v == null ? 'var(--ink3)' : gcolor(v)
                const label = title
                  ? `Quiz ${isNaN(num) ? k : num} - ${title.slice(0, 30)}${title.length > 30 ? '…' : ''}`
                  : `Quiz ${isNaN(num) ? k : num}`
                return (
                  <div key={k} className="sg-score-row">
                    <span className="sg-score-label">{label}{missing && <span style={{ color: 'var(--ink3)', fontWeight: 400 }}> · not taken</span>}</span>
                    <span className="sg-score-val" style={{ color: col }}>{v != null ? `${v}%` : '-'}</span>
                  </div>
                )
              })}
              {quizzesAvg != null && (
                <div className="sg-score-avg">
                  <span>Average</span>
                  <span style={{ color: 'var(--accent)' }}>{quizzesAvg}%</span>
                </div>
              )}
            </div>
          )}
          {qzEntries.length === 0 && quizzesAvg != null && (
            <div className="sg-score-block">
              <div className="sg-section-label">Quiz Score</div>
              <div className="sg-score-avg">
                <span>Overall</span>
                <span style={{ color: gcolor(quizzesAvg) }}>{quizzesAvg}%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
