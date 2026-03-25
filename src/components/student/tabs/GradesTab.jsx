import React, { useMemo } from 'react'
import {
  gradeInfo, combineEquiv, computeFinalGradeFromTerms,
} from '@/utils/grades'
import { useData } from '@/context/DataContext'
import { BookOpen, Clock } from 'lucide-react'

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

  if (!subs.length) {
    return (
      <div className="empty"><div className="empty-icon"><BookOpen size={40} /></div>No subjects enrolled yet.</div>
    )
  }

  return (
    <div className="student-grades">
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

function SubjectCard({ sub, student: s, classes, activities, students, eqScale }) {
  const comp = s.gradeComponents?.[sub] || {}
  const midG = comp.midterm ?? null
  const finG = comp.finals  ?? null
  const ts   = s.gradeUploadedAt?.[sub]

  const gradeFullyUploaded = midG != null && finG != null && ts
  const derivedFinalPct = computeFinalGradeFromTerms(midG, finG)
  const g = derivedFinalPct ?? s.grades?.[sub] ?? null

  const tsLabel = ts
    ? <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>
        Uploaded {new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    : <span style={{ fontSize: 10, color: 'var(--ink3)' }}>Not yet uploaded</span>

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

  // Quiz display
  let qzEntries = []
  if (comp.quizScores && Object.keys(comp.quizScores).length) {
    const qzRaw = Object.entries(comp.quizScores)
    const isNumbered = qzRaw.every(([k]) => /^q\d+$/.test(k))
    qzEntries = isNumbered
      ? qzRaw.sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
      : qzRaw.sort(([a], [b]) => String(a).localeCompare(String(b)))
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

  const hasAny = actVal != null || comp.quizzes != null || midG != null || finG != null

  return (
    <div className="sg-card">
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
                  <span className="badge badge-gray" title="Final grade not yet uploaded by teacher" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>
                  {midG != null && (
                    <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ink3)' }}>
                      Midterm: <strong style={{ color: midG >= 75 ? 'var(--green)' : 'var(--yellow)' }}>{gradeInfo(midG, eqScale).eq}</strong>
                    </div>
                  )}
                </div>
              </>
            : <>
                <div
                  className="sg-grade-num"
                  style={{ color: g != null ? (g >= 75 ? 'var(--green)' : g >= 60 ? 'var(--yellow)' : 'var(--red)') : 'var(--ink3)' }}
                  title={g != null ? `${g}%` : ''}
                >
                  {eq !== '—' ? eq : '—'}
                </div>
                {g != null && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{g}%</div>}
                <div className="sg-grade-badges">
                  <span className={`badge ${remarksColor}`}>{rem}</span>
                </div>
              </>
          }
        </div>
      </div>

      {hasAny ? (
        <div className="sg-breakdown">
          <div className="sg-section-label">Grade Breakdown</div>
          <Bar val={actVal}       label="Activities" weight="CS" />
          <Bar val={comp.quizzes} label="Quizzes"    weight="CS" />
          <Bar val={attRate}      label="Attendance" weight="CS" />
          <Bar val={midG}         label="Midterm"    weight="Term grade" />
          <Bar val={finG}         label="Finals"     weight={finG != null ? 'Term grade' : 'Pending upload'} />
        </div>
      ) : (
        <div className="sg-no-data">No grade components uploaded yet.</div>
      )}

      {/* Activity scores */}
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

      {/* Quiz scores */}
      {qzEntries.length > 0 && (
        <div className="sg-score-block">
          <div className="sg-section-label">Quiz Scores</div>
          {qzEntries.map(([k, v]) => {
            const num = parseInt(k.slice(1))
            const col = v >= 75 ? 'var(--green)' : v >= 60 ? 'var(--yellow)' : 'var(--red)'
            return (
              <div key={k} className="sg-score-row">
                <span className="sg-score-label">Quiz {isNaN(num) ? k : num}</span>
                <span className="sg-score-val" style={{ color: col }}>{v}%</span>
              </div>
            )
          })}
          {comp.quizzes != null && (
            <div className="sg-score-avg">
              <span>Average</span>
              <span style={{ color: 'var(--accent)' }}>{comp.quizzes}%</span>
            </div>
          )}
        </div>
      )}
      {qzEntries.length === 0 && comp.quizzes != null && (
        <div className="sg-score-block">
          <div className="sg-section-label">Quiz Score</div>
          <div className="sg-score-avg">
            <span>Overall</span>
            <span style={{ color: comp.quizzes >= 75 ? 'var(--green)' : comp.quizzes >= 60 ? 'var(--yellow)' : 'var(--red)' }}>{comp.quizzes}%</span>
          </div>
        </div>
      )}

      {/* Exam grades */}
      {(midG != null || finG != null) && (
        <div className="sg-score-block">
          <div className="sg-section-label">Exam Grades</div>
          {midG != null && (
            <div className="sg-exam-row">
              <div className="sg-exam-label">Midterm Exam<span className="sg-exam-weight">used in Midterm Term</span></div>
              <div className="sg-exam-right">
                <span className="sg-exam-pct" style={{ color: midG >= 75 ? 'var(--green)' : midG >= 60 ? 'var(--yellow)' : 'var(--red)' }}>{midG}%</span>
                <span className={`badge ${midG >= 75 ? 'badge-green' : midG > 71 ? 'badge-yellow' : 'badge-red'}`}>{gradeInfo(midG, eqScale).eq}</span>
              </div>
            </div>
          )}
          {finG != null && (
            <div className="sg-exam-row">
              <div className="sg-exam-label">Final Exam<span className="sg-exam-weight">used in Finals Term</span></div>
              <div className="sg-exam-right">
                <span className="sg-exam-pct" style={{ color: finG >= 75 ? 'var(--green)' : finG >= 60 ? 'var(--yellow)' : 'var(--red)' }}>{finG}%</span>
                <span className={`badge ${finG >= 75 ? 'badge-green' : finG > 71 ? 'badge-yellow' : 'badge-red'}`}>{gradeInfo(finG, eqScale).eq}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
