import React, { useState, useMemo } from 'react'
import { gradeInfo, combineEquiv } from '@/utils/grades'
import { computeSubjectGrade, auditSubjectGrade, explainGradeText } from '@/utils/gradeEngine'
import { useData } from '@/context/DataContext'
import { BookOpen, Clock, ChevronDown, ChevronUp, Award, Check, RefreshCw, Target, MessageSquare } from 'lucide-react'
import { activeClassIds, activeSubjects } from '@/utils/active'
import EmptyState from '@/components/ds/EmptyState'
import { neededFinalsForRemarks } from '@/utils/whatIf'
import RegradeRequestModal from '@/components/student/modals/RegradeRequestModal'

export default function GradesTab({ student: s, viewClassId, classes }) {
  const { activities, quizzes, students, eqScale, semester, gradeFloor } = useData()
  const [regradeOpen, setRegradeOpen] = useState(false)

  // Current, non-archived classes only - archived/ended/removed subjects drop off.
  const enrolledIds = activeClassIds(s, classes, semester)
  const subs = activeSubjects(s, classes, semester)

  // GWA equivalency banner: average of uploaded subject equivalencies (true 1.00-5.00 scale)
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

  if (!subs.length) {
    return (
      <EmptyState
        Icon={BookOpen}
        title="No subjects enrolled yet"
        text="Your grades by subject appear here once you're enrolled."
      />
    )
  }

  return (
    <div className="student-grades">
      {gwaData && (
        <div className="sg-gwa-banner">
          <div className="sg-gwa-left">
            <Award size={20} style={{ color: gwaData.color, flexShrink: 0 }} />
            <div>
              <div className="sg-gwa-title">Grade Weighted Average</div>
              <div className="sg-gwa-sub">{gwaData.count} of {gwaData.total} subject{gwaData.total !== 1 ? 's' : ''} with uploaded grades</div>
            </div>
          </div>
          <div className="sg-gwa-right">
            <div className="sg-gwa-eq" style={{ color: gwaData.color }}>{gwaData.avg.toFixed(2)}</div>
            <div className="sg-gwa-remarks" style={{ color: gwaData.color }}>{gwaData.remarks}</div>
          </div>
        </div>
      )}
      <div className="sec-hdr mb-3">
        <div className="sec-title">Grade Breakdown</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setRegradeOpen(true)} title="Ask your professor to review a grade">
          <RefreshCw size={14} /> Request regrade
        </button>
      </div>
      {regradeOpen && (
        <RegradeRequestModal student={s} subjects={subs} onClose={() => setRegradeOpen(false)} />
      )}
      {subs.map(sub => (
        <SubjectCard
          key={sub}
          sub={sub}
          student={s}
          classes={classes}
          activities={activities}
          quizzes={quizzes}
          students={students}
          eqScale={eqScale}
          gradeFloor={gradeFloor}
        />
      ))}
    </div>
  )
}

function Bar({ val, label, weight }) {
  if (val == null) return null
  const pct = Math.min(100, Math.max(0, val))
  const color = pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div className="sg-bar-row">
      <div className="sg-bar-meta">
        <span className="sg-bar-label">{label} <span className="sg-bar-weight">({weight})</span></span>
        <span className="sg-bar-val" style={{ color }}>{val}%</span>
      </div>
      <div className="sg-bar-track">
        <div className="sg-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// ── What-if calculator: shown when the midterm is in but finals isn't yet ─────
function WhatIfPanel({ midTerm, eqScale }) {
  const [val, setVal] = useState('')
  const needs = useMemo(() => neededFinalsForRemarks(midTerm, eqScale), [midTerm, eqScale])

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

// ── Trail Step: one row in the computation trail ──────────────────────────────
function TrailRow({ label, value, sub, isResult, isFinal }) {
  return (
    <div className={`sg-trail-row${isResult ? ' sg-trail-row--result' : ''}${isFinal ? ' sg-trail-row--final' : ''}`}>
      <span className="sg-trail-lbl">{label}</span>
      <span className="sg-trail-val">{value}</span>
      {sub && <span className="sg-trail-sub">{sub}</span>}
    </div>
  )
}

function SubjectCard({ sub, student: s, classes, activities, quizzes = [], students, eqScale, gradeFloor = 0 }) {
  const [showTrail, setShowTrail] = useState(false)

  const comp = s.gradeComponents?.[sub] || {}
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])

  // Single source of truth: every number shown for this subject comes from the
  // one GradeEngine, so the student page agrees with the professor's gradebook and
  // the exports to the last decimal. Components are reconciled against the live
  // activities/quizzes/attendance, so a deleted item never lingers.
  const engineCtx = { activities, quizzes, students, classes, eqScale, enrolledIds, floor: gradeFloor }
  const gr = computeSubjectGrade(s, sub, engineCtx)
  // Plain-language summary + live verified status (grounded in engine numbers).
  const explanation = explainGradeText(gr)
  const audit = gr.published ? auditSubjectGrade(s, sub, engineCtx) : null

  const midG = gr.midterm          // midterm TERM grade %
  const finG = gr.finals           // finals  TERM grade %
  const midExamRaw = comp.midtermExam ?? null  // raw midterm exam score
  const finExamRaw = comp.finalsExam  ?? null  // raw finals  exam score
  const ts   = gr.uploadedAt
  const gradeFullyUploaded = gr.published
  const g = gr.final

  const tsLabel = ts
    ? <span className="sg-upload-status sg-upload-status--done">
        <Check size={14} /> Uploaded {new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    : <span className="sg-upload-status">Pending upload</span>

  const eq  = gr.equiv.eq
  const ltr = gr.equiv.ltr
  const rem = gradeFullyUploaded ? gr.equiv.rem : 'Pending'
  const remarksColor = rem === 'Passed' ? 'badge-green' : rem === 'Conditional' ? 'badge-yellow' : rem === 'Failed' ? 'badge-red' : 'badge-gray'

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

  const hasAny = actVal != null || quizzesAvg != null || attitudeVal != null || midG != null || finG != null
  const hasTrailData = (midG != null || finG != null)

  const gradeColor = g != null ? (g >= 75 ? 'var(--green)' : g >= 60 ? 'var(--yellow)' : 'var(--red)') : 'var(--ink3)'

  return (
    <div className="sg-card">
      {/* ── Header ── */}
      <div className="sg-card-header">
        <div className="sg-card-title">
          <div className="sg-subject-name">{sub}</div>
          <div className="sg-upload-label">{tsLabel}</div>
        </div>
        <div className="sg-card-grade">
          {rem === 'Pending'
            ? <>
                <div className="sg-grade-num" style={{ color: 'var(--ink3)' }}>-</div>
                <div className="sg-grade-badges">
                  <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <Clock size={11} />Pending
                  </span>
                  {midG != null && (
                    <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ink3)' }}>
                      Midterm: <strong style={{ color: midG >= 75 ? 'var(--green)' : 'var(--yellow)' }}>{gradeInfo(midG, eqScale).eq}</strong>
                    </div>
                  )}
                </div>
              </>
            : <>
                <div className="sg-grade-num" style={{ color: gradeColor }} title={g != null ? `${g}%` : ''}>
                  {eq !== '-' ? eq : '-'}
                </div>
                {g != null && <div className="sg-grade-pct">{g}%</div>}
                <div className="sg-grade-badges">
                  <span className={`badge ${remarksColor}`}>{rem}</span>
                </div>
              </>
          }
        </div>
      </div>

      {/* ── Note from professor (plain text, React-escaped) ── */}
      {s.gradeNotes?.[sub]?.text && (
        <div style={{ margin: '0 0 14px', padding: '9px 12px', borderLeft: '3px solid var(--accent)', background: 'var(--accent-l)', borderRadius: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--accent)', marginBottom: 3 }}>
            <MessageSquare size={13} /> Note from {s.gradeNotes[sub].by || 'your professor'}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{s.gradeNotes[sub].text}</div>
        </div>
      )}

      {/* ── Term Summary Grid ── */}
      {(midG != null || finG != null) && (
        <div className="sg-term-grid">
          <div className="sg-term-item">
            <div className="sg-term-label">Midterm Term</div>
            {midG != null
              ? <>
                  <div className="sg-term-val" style={{ color: midG >= 75 ? 'var(--green)' : midG >= 60 ? 'var(--yellow)' : 'var(--red)' }}>{midG}%</div>
                  <div className="sg-term-eq">{midEq}</div>
                </>
              : <div className="sg-term-val" style={{ color: 'var(--ink3)' }}>-</div>
            }
          </div>
          <div className="sg-term-divider" />
          <div className="sg-term-item">
            <div className="sg-term-label">Finals Term</div>
            {finG != null
              ? <>
                  <div className="sg-term-val" style={{ color: finG >= 75 ? 'var(--green)' : finG >= 60 ? 'var(--yellow)' : 'var(--red)' }}>{finG}%</div>
                  <div className="sg-term-eq">{finEq}</div>
                </>
              : <div className="sg-term-val" style={{ color: 'var(--ink3)' }}>-</div>
            }
          </div>
          <div className="sg-term-divider" />
          <div className="sg-term-item">
            <div className="sg-term-label">Final Grade</div>
            {eq !== '-'
              ? <>
                  <div className="sg-term-val sg-term-val--final" style={{ color: gradeColor }}>{eq}</div>
                  <div className="sg-term-eq">{g != null ? `${g}%` : ''}</div>
                </>
              : <div className="sg-term-val" style={{ color: 'var(--ink3)' }}>-</div>
            }
          </div>
        </div>
      )}

      {/* ── Grade Breakdown Bars ── */}
      {hasAny && (
        <div className="sg-breakdown">
          <div className="sg-section-label">Class Standing Components</div>
          <Bar val={actVal}      label="Activities"          weight="CS" />
          <Bar val={quizzesAvg}  label="Quizzes"             weight="CS" />
          <Bar val={attRate}     label="Attendance"          weight="CS" />
          <Bar val={attitudeVal} label="Attitude / Character" weight="CS" />
        </div>
      )}

      {/* ── What-if calculator (midterm in, finals still pending) ── */}
      {midG != null && finG == null && (
        <WhatIfPanel midTerm={midG} eqScale={eqScale} />
      )}

      {/* ── Grade Computation Trail (Best Feature) ── */}
      {hasTrailData && (
        <div className="sg-trail">
          <button
            className="sg-trail-toggle"
            onClick={() => setShowTrail(v => !v)}
            type="button"
          >
            <span className="sg-trail-toggle-label">How was this grade computed?</span>
            {showTrail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showTrail && (
            <div className="sg-trail-body">
              {/* Plain-language explanation - generated from the engine's exact
                  numbers, so it can never disagree with the figures below. */}
              {explanation && (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink2)', background: 'var(--bg2)', borderRadius: 12, padding: '10px 12px', margin: '0 0 12px' }}>
                  {explanation}
                </p>
              )}
              {audit && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600,
                  borderRadius: 10, padding: '8px 11px', margin: '0 0 12px',
                  color: audit.drift ? 'var(--yellow)' : 'var(--green)',
                  background: audit.drift ? 'rgba(234,179,8,.12)' : 'rgba(34,197,94,.10)',
                }}>
                  {audit.drift ? <RefreshCw size={14} /> : <Check size={14} />}
                  {audit.drift
                    ? 'Some items changed after this grade was posted - your professor will re-sync it.'
                    : 'Verified - this grade matches your current activities, quizzes, and attendance.'}
                </div>
              )}
              {/* Step 1: Class Standing */}
              {(actVal != null || quizzesAvg != null || attitudeVal != null) && (
                <div className="sg-trail-step">
                  <div className="sg-trail-step-title">① Class Standing (CS)</div>
                  {actVal      != null && <TrailRow label="Activities"          value={`${actVal}%`} />}
                  {quizzesAvg  != null && <TrailRow label="Quizzes"             value={`${quizzesAvg}%`} />}
                  {attRate     != null && <TrailRow label="Attendance"          value={`${attRate}%`} />}
                  {attitudeVal != null && <TrailRow label="Attitude / Character" value={`${attitudeVal}%`} />}
                  {cs          != null && <TrailRow label="→ CS Average"        value={`${cs}%`} isResult />}
                </div>
              )}

              {/* Step 2: Midterm Term */}
              {midG != null && (
                <div className="sg-trail-step">
                  <div className="sg-trail-step-title">② Midterm Term Grade</div>
                  {cs          != null && <TrailRow label="Class Standing (CS)" value={`${cs}%`} />}
                  {midExamRaw  != null && <TrailRow label="Midterm Exam"        value={`${midExamRaw}%`} />}
                  <TrailRow
                    label="→ Midterm Term"
                    value={`${midG}%`}
                    sub={`Equivalency: ${midEq}`}
                    isResult
                  />
                </div>
              )}

              {/* Step 3: Finals Term */}
              {finG != null && (
                <div className="sg-trail-step">
                  <div className="sg-trail-step-title">③ Finals Term Grade</div>
                  {cs         != null && <TrailRow label="Class Standing (CS)" value={`${cs}%`} />}
                  {finExamRaw != null && <TrailRow label="Finals Exam"         value={`${finExamRaw}%`} />}
                  <TrailRow
                    label="→ Finals Term"
                    value={`${finG}%`}
                    sub={`Equivalency: ${finEq}`}
                    isResult
                  />
                </div>
              )}

              {/* Step 4: Final Grade */}
              {midG != null && finG != null && eq !== '-' && (
                <div className="sg-trail-step">
                  <div className="sg-trail-step-title">④ Final Grade (School Equivalency Table)</div>
                  <TrailRow label={`Midterm equiv`} value={String(midEq)} />
                  <TrailRow label={`Finals equiv`}  value={String(finEq)} />
                  <TrailRow
                    label="→ Final Grade"
                    value={`${eq}`}
                    sub={rem !== 'Pending' ? rem : undefined}
                    isFinal
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Activity Scores ── */}
      {displayActs.length > 0 && (
        <div className="sg-score-block">
          <div className="sg-section-label">Activity Scores</div>
          {displayActs.map((a, i) => {
            const col = a.pct == null ? 'var(--ink3)' : a.pct >= 75 ? 'var(--green)' : a.pct >= 60 ? 'var(--yellow)' : 'var(--red)'
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
            <span style={{ color: comp.activities >= 75 ? 'var(--green)' : comp.activities >= 60 ? 'var(--yellow)' : 'var(--red)' }}>{comp.activities}%</span>
          </div>
        </div>
      )}

      {/* ── Quiz Scores ── */}
      {qzEntries.length > 0 && (
        <div className="sg-score-block">
          <div className="sg-section-label">Quiz Scores</div>
          {qzEntries.map(([k, v, title, missing]) => {
            const num = parseInt(k.slice(1))
            const col = v == null ? 'var(--ink3)' : v >= 75 ? 'var(--green)' : v >= 60 ? 'var(--yellow)' : 'var(--red)'
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
            <span style={{ color: quizzesAvg >= 75 ? 'var(--green)' : quizzesAvg >= 60 ? 'var(--yellow)' : 'var(--red)' }}>{quizzesAvg}%</span>
          </div>
        </div>
      )}

      {!hasAny && (
        <div className="sg-no-data">No grade components uploaded yet.</div>
      )}
    </div>
  )
}
