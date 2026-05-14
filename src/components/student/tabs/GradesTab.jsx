import React, { useState, useMemo } from 'react'
import {
  gradeInfo, combineEquiv, computeFinalGradeFromTerms,
} from '@/utils/grades'
import { useData } from '@/context/DataContext'
import { BookOpen, Clock, ChevronDown, ChevronUp, Award } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'

export default function GradesTab({ student: s, viewClassId, classes }) {
  const { activities, students, eqScale } = useData()

  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allEnrolledSubs = enrolledIds.length
    ? [...new Set(enrolledIds.flatMap(id => classes.find(c => c.id === id)?.subjects || []))]
    : Object.keys(s.grades || {})

  // Always show all enrolled subjects, regardless of viewClassId selector
  let subs = allEnrolledSubs
  if (!subs.length) {
    subs = [...new Set([
      ...Object.keys(s.grades || {}),
      ...Object.keys(s.gradeComponents || {}),
    ])]
  }

  // GWA equivalency banner: average of uploaded subject equivalencies (true 1.00–5.00 scale)
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
      <div className="empty"><div className="empty-icon"><BookOpen size={40} /></div>No subjects enrolled yet.</div>
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
      </div>
      {subs.map(sub => (
        <SubjectCard
          key={sub}
          sub={sub}
          student={s}
          classes={classes}
          activities={activities}
          students={students}
          eqScale={eqScale}
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

function SubjectCard({ sub, student: s, classes, activities, students, eqScale }) {
  const [showTrail, setShowTrail] = useState(false)

  const comp = s.gradeComponents?.[sub] || {}
  const midG = comp.midterm ?? null      // midterm TERM grade %
  const finG = comp.finals  ?? null      // finals  TERM grade %
  const midExamRaw = comp.midtermExam ?? null  // raw midterm exam score
  const finExamRaw = comp.finalsExam  ?? null  // raw finals  exam score
  const ts   = s.gradeUploadedAt?.[sub]

  const gradeFullyUploaded = midG != null && finG != null && ts
  const derivedFinalPct = computeFinalGradeFromTerms(midG, finG)
  const g = derivedFinalPct ?? s.grades?.[sub] ?? null

  const tsLabel = ts
    ? <span className="sg-upload-status sg-upload-status--done">
        ✓ Uploaded {new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    : <span className="sg-upload-status">Pending upload</span>

  const { eq, ltr, rem } = gradeFullyUploaded
    ? combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq)
    : (midG != null && finG != null)
      ? { ...combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq), rem: 'Pending' }
      : { eq: '—', ltr: '—', rem: 'Pending' }

  const remarksColor = rem === 'Passed' ? 'badge-green' : rem === 'Conditional' ? 'badge-yellow' : rem === 'Failed' ? 'badge-red' : 'badge-gray'

  // Get all enrolled class IDs for multi-subject support
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])

  // Activity display
  const panelActs = activities
    .filter(a => enrolledIds.includes(a.classId) && a.subject === sub)
    .map(a => ({ title: a.title, score: (a.submissions || {})[s.id]?.score ?? null, max: a.maxScore || 100 }))
  const hasGradedPanelActs = panelActs.some(a => a.score != null)

  let displayActs = []
  if (hasGradedPanelActs) {
    displayActs = panelActs.filter(a => a.score != null)
  } else if (comp.activityScores && Object.keys(comp.activityScores).length) {
    const entries = Object.entries(comp.activityScores)
    const isNumbered = entries.every(([k]) => /^a\d+$/.test(k))
    if (isNumbered) {
      displayActs = entries
        .sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
        .map(([k, v]) => ({ title: '', score: v, max: 100 }))
    } else {
      const actList = activities.filter(a => enrolledIds.includes(a.classId) && a.subject === sub)
      if (actList.length) {
        displayActs = actList
          .filter(a => comp.activityScores[a.id] != null)
          .map(a => ({ title: a.title, score: comp.activityScores[a.id], max: a.maxScore || 100 }))
      } else {
        displayActs = entries
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
          .map(([k, v]) => ({ title: '', score: v, max: 100 }))
      }
    }
  }

  const panelActAvg = displayActs.filter(a => a.score != null).length
    ? parseFloat((displayActs.filter(a => a.score != null).reduce((t, a) => t + a.score, 0)
        / displayActs.filter(a => a.score != null).length).toFixed(2))
    : null
  const actVal = panelActAvg ?? comp.activities ?? null

  // Attitude / Character grade
  const attitudeVal = comp.attitude ?? null

  // Quiz display
  const quizzesRaw = comp.quizzes
  const quizzesIsArray = Array.isArray(quizzesRaw)
  const quizzesAvg = quizzesIsArray
    ? (quizzesRaw.length
        ? parseFloat((quizzesRaw.reduce((t, q) => t + (q.pct ?? (q.score != null && q.total ? Math.round(q.score / q.total * 100) : 0)), 0) / quizzesRaw.length).toFixed(2))
        : null)
    : (typeof quizzesRaw === 'number' ? quizzesRaw : null)

  let qzEntries = []
  if (quizzesIsArray && quizzesRaw.length) {
    qzEntries = quizzesRaw.map((q, i) => [`q${i + 1}`, q.pct ?? (q.score != null && q.total ? Math.round(q.score / q.total * 100) : null), q.title ?? null])
  } else if (comp.quizScores && Object.keys(comp.quizScores).length) {
    const qzRaw = Object.entries(comp.quizScores)
    const isNumbered = qzRaw.every(([k]) => /^q\d+$/.test(k))
    const sorted = isNumbered
      ? qzRaw.sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
      : qzRaw.sort(([a], [b]) => String(a).localeCompare(String(b)))
    qzEntries = sorted.map(([k, v]) => [k, v, null])
  }

  // Subject attendance rate
  const attSet = s.attendance?.[sub] || new Set()
  const excSet = s.excuse?.[sub] || new Set()
  const classMates = enrolledIds.length ? students.filter(x => {
    const xEnrolledIds = x.classIds?.length ? x.classIds : (x.classId ? [x.classId] : [])
    return xEnrolledIds.some(id => enrolledIds.includes(id))
  }) : []
  const held = [...classMates, s].reduce((mx, x) => {
    const sz = (x.attendance?.[sub] || new Set()).size + (x.excuse?.[sub] || new Set()).size
    return Math.max(mx, sz)
  }, 0)
  const attRate = held > 0 ? parseFloat(((attSet.size / held) * 100).toFixed(1)) : 0

  // Compute class standing (CS) for the computation trail
  const csParts = [actVal, quizzesAvg, attRate, attitudeVal].filter(x => x != null)
  const cs = csParts.length
    ? parseFloat((csParts.reduce((t, x) => t + x, 0) / csParts.length).toFixed(2))
    : comp.midtermCS ?? null

  const midEq = midG != null ? gradeInfo(midG, eqScale).eq : null
  const finEq = finG != null ? gradeInfo(finG, eqScale).eq : null

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
                <div className="sg-grade-num" style={{ color: 'var(--ink3)' }}>—</div>
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
                  {eq !== '—' ? eq : '—'}
                </div>
                {g != null && <div className="sg-grade-pct">{g}%</div>}
                <div className="sg-grade-badges">
                  <span className={`badge ${remarksColor}`}>{rem}</span>
                </div>
              </>
          }
        </div>
      </div>

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
              : <div className="sg-term-val" style={{ color: 'var(--ink3)' }}>—</div>
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
              : <div className="sg-term-val" style={{ color: 'var(--ink3)' }}>—</div>
            }
          </div>
          <div className="sg-term-divider" />
          <div className="sg-term-item">
            <div className="sg-term-label">Final Grade</div>
            {eq !== '—'
              ? <>
                  <div className="sg-term-val sg-term-val--final" style={{ color: gradeColor }}>{eq}</div>
                  <div className="sg-term-eq">{g != null ? `${g}%` : ''}</div>
                </>
              : <div className="sg-term-val" style={{ color: 'var(--ink3)' }}>—</div>
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
              {midG != null && finG != null && eq !== '—' && (
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
            const pct = a.score != null ? Math.round(a.score / a.max * 100) : null
            const col = pct == null ? 'var(--ink3)' : pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'
            const label = a.title
              ? `Activity ${i + 1} — ${a.title.slice(0, 35)}${a.title.length > 35 ? '…' : ''}`
              : `Activity ${i + 1}`
            return (
              <div key={i} className="sg-score-row">
                <span className="sg-score-label">{label}</span>
                <span className="sg-score-val" style={{ color: col }}>
                  {a.score != null ? a.score + (a.max !== 100 ? `/${a.max}` : '%') : '—'}
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
          {qzEntries.map(([k, v, title]) => {
            const num = parseInt(k.slice(1))
            const col = v == null ? 'var(--ink3)' : v >= 75 ? 'var(--green)' : v >= 60 ? 'var(--yellow)' : 'var(--red)'
            const label = title
              ? `Quiz ${isNaN(num) ? k : num} — ${title.slice(0, 30)}${title.length > 30 ? '…' : ''}`
              : `Quiz ${isNaN(num) ? k : num}`
            return (
              <div key={k} className="sg-score-row">
                <span className="sg-score-label">{label}</span>
                <span className="sg-score-val" style={{ color: col }}>{v != null ? `${v}%` : '—'}</span>
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
