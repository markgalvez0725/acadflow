import React, { useState, useMemo, useCallback, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import {
  gradeInfo, combineEquiv, computeGrade, computeFinalGradeFromTerms,
  getHeldDays, gradeInfoForStudent, getGradeScaleLabel,
} from '@/utils/grades'
import { exportGradingSheet, parseGradingSheetImport } from '@/export/excelExport'
import Modal from '@/components/primitives/Modal'
import Pagination from '@/components/primitives/Pagination'
import Badge from '@/components/primitives/Badge'

const GRADE_PER_PAGE = 10

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v) {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function clamp(v) {
  return v !== null ? Math.min(100, Math.max(0, v)) : null
}

// ── Push a notification to a specific student ─────────────────────────────────
async function pushStudentNotif(db, studentId, title, body, type = 'act_grade', link = 'grades') {
  try {
    const { getDoc, setDoc, doc: fbDoc } = await import('firebase/firestore')
    const ref = fbDoc(db, 'notifications', studentId)
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().items || []) : []
    const notif = {
      id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
      type, read: false, ts: Date.now(), title, body, link,
    }
    await setDoc(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false })
  } catch (e) {}
}

// ── GradeEntryModal ───────────────────────────────────────────────────────────
function GradeEntryModal({ classId, subject, onClose }) {
  const { students, classes, activities, saveStudents, eqScale, db, fbReady } = useData()
  const { toast, openDialog } = useUI()

  const cls   = classes.find(c => c.id === classId)
  const studs = useMemo(() => sortByLastName(students.filter(s => s.classId === classId || s.classIds?.includes(classId))), [students, classId])

  // Build initial row values from existing student data + activities panel
  const initRows = useMemo(() => {
    return studs.map(s => {
      const comp = s.gradeComponents?.[subject] || {}

      // Auto-compute activities from Activities panel
      const panelActs = (activities || []).filter(a => a.classId === classId && a.subject === subject)
      const actScores = panelActs.map(a => (a.submissions || {})[s.id]?.score).filter(v => v != null)
      const actFromPanel = actScores.length > 0
      const actAvg = actFromPanel
        ? parseFloat((actScores.reduce((a, b) => a + b, 0) / actScores.length).toFixed(2))
        : null

      // Auto-compute attendance
      const attSet = s.attendance?.[subject] || new Set()
      const held   = getHeldDays(classId, subject, students)
      const attRate = held > 0 ? Math.min(100, parseFloat(((attSet.size / held) * 100).toFixed(2))) : null

      const actDisplay = actAvg !== null ? actAvg : (comp.activities ?? '')
      const qz  = comp.quizzes     ?? ''
      const mid = comp.midtermExam ?? ''
      const fin = comp.finalsExam  ?? ''

      // Compute current equiv preview
      const midTermN = comp.midterm ?? null
      const finTermN = comp.finals  ?? null
      const eqPreview = (midTermN != null && finTermN != null)
        ? combineEquiv(gradeInfo(midTermN, eqScale).eq, gradeInfo(finTermN, eqScale).eq).eq
        : gradeInfo(s.grades?.[subject] ?? null, eqScale).eq

      return {
        actFromPanel,
        actAvg,
        actScores,
        panelActCount: panelActs.length,
        activities: actFromPanel ? String(actAvg) : String(actDisplay),
        quizzes:    String(qz),
        midtermExam: String(mid),
        finalsExam:  String(fin),
        finalGrade: s.grades?.[subject] != null ? String(s.grades[subject]) : '',
        attRate,
        held,
        attSize: attSet.size,
        equivPreview: eqPreview,
      }
    })
  }, [studs, subject, classId, activities, students, eqScale])

  const [rows, setRows] = useState(initRows)
  const [saving, setSaving] = useState(false)

  // Last upload timestamp for this subject
  const uploadTs = useMemo(() =>
    studs.map(s => s.gradeUploadedAt?.[subject]).filter(Boolean).sort().pop()
  , [studs, subject])

  // Live recompute row equiv
  const updateRow = useCallback((i, field, val) => {
    setRows(prev => {
      const next = prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r)
      const r = next[i]

      const actV = r.actFromPanel ? r.actAvg : toNum(r.activities)
      const qzV  = toNum(r.quizzes)
      const attV = r.attRate
      const midV = toNum(r.midtermExam)
      const finV = toNum(r.finalsExam)

      // Auto-compute if at least one exam is present
      let fg = r.finalGrade
      if (midV !== null || finV !== null) {
        const computed = computeGrade(actV, qzV, attV, midV, finV)
        if (computed !== null) {
          fg = String(computed)
        }
      }

      // Compute equiv preview from manual final grade field
      const fgN = toNum(fg)
      const equivPreview = gradeInfo(fgN, eqScale).eq

      return next.map((r2, idx) => idx === i ? { ...r2, finalGrade: fg, equivPreview } : r2)
    })
  }, [eqScale])

  // When finalGrade is manually edited, just update equiv
  const updateFinalGrade = useCallback((i, val) => {
    setRows(prev => prev.map((r, idx) => {
      if (idx !== i) return r
      const fgN = toNum(val)
      return { ...r, finalGrade: val, equivPreview: gradeInfo(fgN, eqScale).eq }
    }))
  }, [eqScale])

  async function handleSave() {
    setSaving(true)
    const now = Date.now()

    const updatedStudents = students.map(s => {
      const si = studs.findIndex(x => x.id === s.id)
      if (si === -1) return s

      const r    = rows[si]
      const ns   = { ...s, grades: { ...s.grades }, gradeComponents: { ...(s.gradeComponents || {}) }, gradeUploadedAt: { ...(s.gradeUploadedAt || {}) } }
      const comp = { ...(ns.gradeComponents[subject] || {}) }

      const actV     = r.actFromPanel ? r.actAvg : clamp(toNum(r.activities))
      const qzV      = clamp(toNum(r.quizzes))
      const midExamV = clamp(toNum(r.midtermExam))
      const finExamV = clamp(toNum(r.finalsExam))
      const attV     = r.attRate

      // Persist raw inputs
      if (actV     != null) comp.activities   = actV
      if (qzV      != null) comp.quizzes      = qzV
      if (midExamV != null) comp.midtermExam  = midExamV
      if (finExamV != null) comp.finalsExam   = finExamV

      // CS Midterm = avg(acts, qz, att)
      const csMidParts = [actV, qzV, attV].filter(x => x !== null)
      const csMid = csMidParts.length
        ? parseFloat((csMidParts.reduce((s, x) => s + x, 0) / csMidParts.length).toFixed(2))
        : null

      // CS Finals = avg(acts, qz, att)
      const csFinParts = [actV, qzV, attV].filter(x => x !== null)
      const csFin = csFinParts.length
        ? parseFloat((csFinParts.reduce((s, x) => s + x, 0) / csFinParts.length).toFixed(2))
        : null

      // Midterm Term = avg(CS Midterm, Midterm Exam)
      if (midExamV !== null) {
        const p = [csMid, midExamV].filter(x => x !== null)
        comp.midtermCS = csMid
        comp.midterm   = parseFloat((p.reduce((s, x) => s + x, 0) / p.length).toFixed(2))
      }

      // Finals Term = avg(CS Finals, Finals Exam)
      if (finExamV !== null) {
        const p = [csFin, finExamV].filter(x => x !== null)
        comp.finalsCS = csFin
        comp.finals   = parseFloat((p.reduce((s, x) => s + x, 0) / p.length).toFixed(2))
      }

      // Sync activityScores from panel
      const panelActs = (activities || []).filter(a => a.classId === classId && a.subject === subject)
      if (panelActs.length) {
        const actScoresMap = {}
        panelActs.forEach((a, idx) => {
          const sc = (a.submissions || {})[s.id]?.score
          if (sc != null) {
            actScoresMap['a' + (idx + 1)] = sc
            actScoresMap[a.id] = sc
          }
        })
        if (Object.keys(actScoresMap).length) comp.activityScores = actScoresMap
      } else if (actV !== null && !comp.activityScores) {
        comp.activityScores = { a1: actV }
      }

      // Sync quizScores
      if (qzV !== null) {
        if (!comp.quizScores || !Object.keys(comp.quizScores).length) {
          comp.quizScores = { q1: qzV }
        } else {
          comp.quizzes = qzV
        }
      }

      // Final Grade % = avg(Midterm Term, Finals Term)
      let finalGrade = null
      if (comp.midterm != null || comp.finals != null) {
        finalGrade = computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null)
      }

      // Manual override
      const rawOverride = r.finalGrade.trim()
      let val
      if (rawOverride !== '') {
        val = clamp(toNum(rawOverride))
        if (val === null) val = finalGrade
      } else {
        val = finalGrade
      }

      ns.grades[subject] = val
      ns.gradeComponents[subject] = comp
      if (val !== null) ns.gradeUploadedAt[subject] = now

      return ns
    })

    const changedIds = studs.map(s => s.id)
    try {
      await saveStudents(updatedStudents, changedIds)
      toast('Grades saved!', 'green')
      // Notify each student whose grade was saved
      if (fbReady && db.current) {
        const clsName = cls?.name || subject
        for (const s of studs) {
          const si = updatedStudents.findIndex(x => x.id === s.id)
          const grade = si !== -1 ? updatedStudents[si].grades?.[subject] : null
          if (grade != null) {
            pushStudentNotif(
              db.current, s.id,
              `Grade posted for ${subject}`,
              `${clsName} — Final Grade: ${grade.toFixed(1)}`,
              'act_grade', 'grades'
            )
          }
        }
      }
      onClose()
    } catch (e) {
      toast('Saved locally — Firebase sync failed: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="mb-0">✏️ Edit Grades</h3>
          <p className="modal-sub mb-0">
            Subject: <strong>{subject}</strong> · {cls?.name} {cls?.section}
          </p>
        </div>
        <div className="text-xs text-ink2">
          {uploadTs
            ? <>📤 Last uploaded: <strong>{new Date(uploadTs).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</strong></>
            : <span className="text-ink3">Not yet uploaded</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="tbl" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th>Student</th>
              <th title="Activities average — used in both CS Midterm and CS Finals">
                Activities<br /><small className="font-normal text-ink3">avg</small>
              </th>
              <th title="Quizzes average">
                Quizzes<br /><small className="font-normal text-ink3">avg</small>
              </th>
              <th title="Attendance % — auto from records">
                Attendance<br /><small className="font-normal text-ink3">auto · CS</small>
              </th>
              <th title="Midterm Exam score — combined with CS Midterm to get Midterm Term grade">
                Midterm Exam<br /><small className="font-normal text-ink3">exam score</small>
              </th>
              <th title="Finals Exam score — combined with CS Finals to get Finals Term grade">
                Finals Exam<br /><small className="font-normal text-ink3">exam score</small>
              </th>
              <th style={{ background: 'var(--accent-l)' }}>
                Final Grade<br /><small className="font-normal" style={{ color: 'var(--accent)' }}>auto/manual</small>
              </th>
              <th>Equiv.</th>
            </tr>
          </thead>
          <tbody>
            {studs.map((s, i) => {
              const r = rows[i]
              if (!r) return null
              const attColor = r.attRate !== null
                ? (r.attRate >= 90 ? 'var(--green)' : r.attRate >= 75 ? 'var(--yellow)' : 'var(--red)')
                : 'var(--ink3)'

              return (
                <tr key={s.id}>
                  <td style={{ minWidth: 150 }}>
                    <strong>{s.name}</strong><br />
                    <small className="text-ink2">{s.id}</small>
                  </td>
                  <td>
                    {r.actFromPanel ? (
                      <div className="px-2 py-1.5 rounded-md text-sm font-bold text-center"
                        style={{ background: 'var(--green-l)', color: 'var(--green)' }}
                        title={`Auto-computed from Activities panel (${r.panelActCount} activit${r.panelActCount === 1 ? 'y' : 'ies'})`}>
                        {r.actAvg ?? '—'}
                        <br /><small className="text-xs font-normal" style={{ color: 'var(--green)' }}>
                          {r.panelActCount} activit{r.panelActCount === 1 ? 'y' : 'ies'} · auto
                        </small>
                      </div>
                    ) : (
                      <input className="grade-input" type="number" min="0" max="100"
                        value={r.activities} placeholder="0–100"
                        title="Activities (avg)"
                        onChange={e => updateRow(i, 'activities', e.target.value)} />
                    )}
                  </td>
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      value={r.quizzes} placeholder="0–100"
                      title="Quizzes (avg)"
                      onChange={e => updateRow(i, 'quizzes', e.target.value)} />
                  </td>
                  <td>
                    <div className="px-2 py-1.5 rounded-md text-sm font-semibold"
                      style={{ background: 'var(--bg)', color: attColor }}
                      title={`Auto-computed from attendance records (${r.attSize}/${r.held} days)`}>
                      {r.attRate !== null ? `${r.attRate.toFixed(1)}%` : '—'}
                      <br /><small className="text-xs font-normal text-ink3">{r.attSize}/{r.held} days</small>
                    </div>
                  </td>
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      value={r.midtermExam} placeholder="0–100"
                      title="Midterm Exam score"
                      onChange={e => updateRow(i, 'midtermExam', e.target.value)} />
                  </td>
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      value={r.finalsExam} placeholder="0–100"
                      title="Finals Exam score"
                      onChange={e => updateRow(i, 'finalsExam', e.target.value)} />
                  </td>
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      value={r.finalGrade} placeholder="auto"
                      title="Final Grade (editable)"
                      style={{ background: 'var(--accent-l)', fontWeight: 700 }}
                      onChange={e => updateFinalGrade(i, e.target.value)} />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink2)', minWidth: 48 }}>
                    {r.equivPreview}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 px-3 py-2 rounded-lg text-xs text-ink2" style={{ background: 'var(--bg)', lineHeight: 2 }}>
        <strong>CS Midterm</strong> = Average(Activities, Quizzes, Attendance)<br />
        <strong>CS Finals</strong> = Average(Activities, Quizzes, Attendance)<br />
        <strong>Midterm Term</strong> = Average(CS Midterm, Midterm Exam)<br />
        <strong>Finals Term</strong> = Average(CS Finals, Finals Exam)<br />
        <strong>Final Grade %</strong> = Average(Midterm Term, Finals Term) → converted to 1.00–5.00 via school lookup table<br />
        <span className="text-ink3">{getGradeScaleLabel(eqScale)}</span>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Grades'}
        </button>
      </div>
    </Modal>
  )
}

// ── Toggle badge: shows equiv by default, click toggles to % ─────────────────
const BADGE_CLS_MAP = { green: 'badge-green', yellow: 'badge-yellow', red: 'badge-red', gray: 'badge-gray', blue: 'badge-blue' }

function ToggleBadge({ pct, equiv, badgeCls }) {
  const [showPct, setShowPct] = useState(false)
  return (
    <span
      className={`badge ${BADGE_CLS_MAP[badgeCls] || 'badge-gray'}`}
      style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
      title="Click to toggle equiv / %"
      onClick={() => setShowPct(p => !p)}
    >
      {showPct ? pct : equiv}
    </span>
  )
}

// ── Sort icon ─────────────────────────────────────────────────────────────────
function SortIcon({ col, sort }) {
  if (sort.col !== col) return <span className="th-sort-icon">↕</span>
  return <span className={`th-sort-icon ${sort.dir === 'asc' ? 'asc' : 'desc'}`}>↕</span>
}

// ── SubjectCard ───────────────────────────────────────────────────────────────
function SubjectCard({ cls, sub, studs, eqScale, onEdit, onClear, onExport, onImport }) {
  const [sort, setSort]   = useState({ col: 'name', dir: 'asc' })
  const [page, setPage]   = useState(1)

  function toggleSort(col) {
    setSort(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
    setPage(1)
  }

  // Distribution stats
  const total = studs.length
  const completeGrades = studs.filter(s => {
    const comp = s.gradeComponents?.[sub] || {}
    return comp.midterm != null && comp.finals != null
  })
  const withMidterm = studs.filter(s => s.gradeComponents?.[sub]?.midterm != null).length
  const withFinals  = studs.filter(s => s.gradeComponents?.[sub]?.finals  != null).length
  const withFtActs  = studs.filter(s => {
    const fa = s.gradeComponents?.[sub]?.finalsActivityScores
    return fa && Object.keys(fa).length > 0
  }).length
  const passing = completeGrades.filter(s => s.grades?.[sub] != null && s.grades[sub] >= 75).length
  const failing = completeGrades.filter(s => s.grades?.[sub] != null && s.grades[sub] < 75).length
  const noGrade = total - completeGrades.length
  const pPct = total ? Math.round(passing / total * 100) : 0
  const fPct = total ? Math.round(failing / total * 100) : 0
  const midUploadPct   = total ? Math.round(withMidterm / total * 100) : 0
  const finUploadPct   = total ? Math.round(withFinals  / total * 100) : 0
  const ftActUploadPct = total ? Math.round(withFtActs  / total * 100) : 0

  const midGrades  = studs.map(s => s.gradeComponents?.[sub]?.midterm).filter(g => g != null)
  const finGrades  = studs.map(s => s.grades?.[sub]).filter(g => g != null)
  const midAvg     = midGrades.length ? (midGrades.reduce((a, b) => a + b, 0) / midGrades.length).toFixed(1) : null
  const finAvg     = finGrades.length ? (finGrades.reduce((a, b) => a + b, 0) / finGrades.length).toFixed(1) : null
  const midAvgEquiv = midAvg ? gradeInfo(parseFloat(midAvg), eqScale).eq : '—'
  const finAvgEquiv = finAvg ? gradeInfo(parseFloat(finAvg), eqScale).eq : '—'

  const latestTs = studs.map(s => s.gradeUploadedAt?.[sub]).filter(Boolean).sort().pop()

  // Sort
  const sorted = useMemo(() => {
    return [...studs].sort((a, b) => {
      const aC = a.gradeComponents?.[sub] || {}
      const bC = b.gradeComponents?.[sub] || {}
      let av, bv
      if (sort.col === 'name')     { av = a.name;             bv = b.name }
      else if (sort.col === 'midterm') { av = aC.midterm ?? -1; bv = bC.midterm ?? -1 }
      else if (sort.col === 'finals')  { av = a.grades?.[sub] ?? -1; bv = b.grades?.[sub] ?? -1 }
      else if (sort.col === 'grade')   { av = a.grades?.[sub] ?? -1; bv = b.grades?.[sub] ?? -1 }
      else if (sort.col === 'remarks') {
        av = gradeInfoForStudent(a, sub, eqScale).rem
        bv = gradeInfoForStudent(b, sub, eqScale).rem
      }
      else if (sort.col === 'uploaded') { av = a.gradeUploadedAt?.[sub] || ''; bv = b.gradeUploadedAt?.[sub] || '' }
      else { av = a.name; bv = b.name }
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? av - bv : bv - av
    })
  }, [studs, sort, sub, eqScale])

  const slice = sorted.slice((page - 1) * GRADE_PER_PAGE, page * GRADE_PER_PAGE)

  const ftHasAnyData = studs.some(s => {
    const fa = s.gradeComponents?.[sub]?.finalsActivityScores
    return fa && Object.keys(fa).length > 0
  })

  return (
    <div className="card card-pad mb-3">
      {/* Header */}
      <div className="sec-hdr mb-2 flex-wrap gap-2">
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 15 }}>{sub}</strong>
          {latestTs
            ? <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--green)' }}>
                Uploaded {new Date(latestTs).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            : <span className="ml-2 text-xs text-ink3">Not yet uploaded</span>}
        </div>
        <div className="flex gap-1.5 flex-wrap flex-shrink-0">
          <button className="btn btn-primary btn-sm" onClick={() => onEdit(sub)}>✏️ Edit Grades</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onExport(sub)} title="Export grading sheet">📤 Export</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onImport(sub)} title="Import grading sheet">📥 Import</button>
          <button className="btn btn-warning btn-sm" onClick={() => onClear(sub)}
            title="Clear all grade data for this subject">🗑 Clear Grades</button>
        </div>
      </div>

      {/* Grade distribution */}
      <div className="rounded-lg p-3 mb-3" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
          <div className="text-xs font-bold text-ink2 uppercase" style={{ letterSpacing: '.06em' }}>Grade Distribution</div>
          <div className="flex gap-2.5 text-xs text-ink2 flex-wrap">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--green)' }} />Passed: {passing}</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--red)' }} />Failed: {failing}</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--border)' }} />No grade: {noGrade}</span>
          </div>
        </div>
        <div className="flex h-2.5 rounded-md overflow-hidden" style={{ background: 'var(--border)' }}>
          {pPct > 0 && <div style={{ width: `${pPct}%`, background: 'var(--green)', transition: 'width .4s' }} />}
          {fPct > 0 && <div style={{ width: `${fPct}%`, background: 'var(--red)',   transition: 'width .4s' }} />}
        </div>
        <div className="mt-2 text-xs text-ink3 flex gap-4 flex-wrap items-center">
          <span>Midterm avg: <strong className="text-ink">{midAvgEquiv}</strong></span>
          <span>Finals avg: <strong className="text-ink">{finAvgEquiv}</strong></span>
          <span>{total} student{total !== 1 ? 's' : ''}</span>
        </div>

        {/* Upload progress bars */}
        <div className="mt-2.5 flex flex-col gap-1.5">
          {[
            { label: 'Midterm graded', pct: midUploadPct, count: withMidterm, color: 'var(--accent)' },
            { label: 'FT Acts graded', pct: ftActUploadPct, count: withFtActs, color: 'var(--c-gold, #f59e0b)' },
            { label: 'Finals graded',  pct: finUploadPct,  count: withFinals,
              color: finUploadPct === 100 ? 'var(--green)' : 'var(--accent)' },
          ].map(({ label, pct, count, color }) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <span className="text-ink2" style={{ minWidth: 106 }}>{label}</span>
              <div className="flex-1 h-1.5 rounded overflow-hidden" style={{ background: 'var(--border)' }}>
                <div style={{ height: '100%', borderRadius: 4, background: color, width: `${pct}%`, transition: 'width .4s' }} />
              </div>
              <span className="font-semibold text-ink2" style={{ minWidth: 50, textAlign: 'right' }}>{count}/{total}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {[
                { col: 'name',     label: 'Student' },
                { col: 'midterm',  label: 'Midterm' },
                { col: 'finals',   label: 'Finals' },
                { col: 'grade',    label: 'Final Grade' },
                { col: 'remarks',  label: 'Remarks' },
                { col: 'uploaded', label: 'Uploaded' },
              ].map(({ col, label }) => (
                <th key={col} className="th-sort" onClick={() => toggleSort(col)}>
                  {label} <SortIcon col={col} sort={sort} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr><td colSpan={6}><div className="empty">No students.</div></td></tr>
            )}
            {slice.map(s => {
              const comp  = s.gradeComponents?.[sub] || {}
              const midG  = comp.midterm ?? null
              const finG  = comp.finals  ?? null
              const ts    = s.gradeUploadedAt?.[sub]
              const tsLabel = ts ? new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

              const { eq: midEq } = gradeInfo(midG, eqScale)
              const midPct = midG != null ? `${midG.toFixed(1)}%` : '—'
              const midEquiv = midG != null ? midEq : '—'
              const midBadgeCls = midG != null ? (midG >= 75 ? 'green' : midG > 71 ? 'yellow' : 'red') : 'gray'

              const { eq: finRawEq } = gradeInfo(finG, eqScale)
              const finPct  = finG != null ? `${finG.toFixed(1)}%` : '—'
              const finEquiv = finG != null ? finRawEq : '—'
              const finBadgeCls = finG != null ? (finG >= 75 ? 'green' : finG > 71 ? 'yellow' : 'red') : 'gray'

              // Finals per-row FT activity progress
              const ftActTotal = studs.filter(x => {
                const fa = x.gradeComponents?.[sub]?.finalsActivityScores
                return fa && Object.keys(fa).length > 0
              }).length
              const ftActPct = total > 0 ? Math.round(ftActTotal / total * 100) : 0

              // Final grade badge
              const gradeFullyUploaded = midG != null && finG != null && ts
              let combinedEq, rem
              if (gradeFullyUploaded) {
                const combined = combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq)
                combinedEq = combined.eq; rem = combined.rem
              } else if (midG != null) {
                combinedEq = '—'; rem = 'Pending'
              } else {
                combinedEq = '—'; rem = 'Pending'
              }

              const fgBadgeCls = rem === 'Passed' ? 'green' : rem === 'Conditional' ? 'yellow' : rem === 'Failed' ? 'red' : 'gray'
              const remBadgeCls = rem === 'Passed' ? 'green' : rem === 'Conditional' ? 'yellow' : rem === 'Failed' ? 'red' : 'gray'

              return (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong><br />
                    <small className="text-ink2">{s.id}</small>
                  </td>
                  <td>
                    <ToggleBadge pct={midPct} equiv={midEquiv} badgeCls={midBadgeCls} />
                  </td>
                  <td>
                    <div className="inline-flex flex-col items-center" style={{ minWidth: 54 }}>
                      <ToggleBadge pct={finPct} equiv={finEquiv} badgeCls={finBadgeCls} />
                      {finG == null && ftHasAnyData && (
                        <div className="mt-1 w-full h-1 rounded overflow-hidden" style={{ background: 'var(--border)' }}
                          title={`FT Activities graded: ${ftActTotal}/${total} students`}>
                          <div style={{ height: '100%', background: 'var(--accent)', width: `${ftActPct}%`, transition: 'width .4s' }} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    {gradeFullyUploaded
                      ? <span className={`badge ${BADGE_CLS_MAP[fgBadgeCls] || 'badge-gray'}`} style={{ fontSize: 13, fontWeight: 700 }}>{combinedEq}</span>
                      : <span className="badge badge-gray" title="Final grade not yet fully uploaded">⏳ Pending</span>}
                  </td>
                  <td>
                    <span className={`badge ${BADGE_CLS_MAP[remBadgeCls] || 'badge-gray'}`}
                      title={rem === 'Pending' ? 'Final grade not yet fully uploaded by teacher' : ''}>
                      {rem}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--ink2)' }}>{tsLabel}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination total={studs.length} perPage={GRADE_PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}

// ── GradesTab ─────────────────────────────────────────────────────────────────
export default function GradesTab() {
  const { classes, students, eqScale, saveStudents } = useData()
  const { toast, openDialog } = useUI()

  const [selClassId, setSelClassId] = useState(() => classes[0]?.id || null)
  const [search,     setSearch]     = useState('')
  const [editModal,  setEditModal]  = useState(null) // subject string
  const [importSub,  setImportSub]  = useState(null) // subject string for import
  const importFileRef = useRef(null)

  // Auto-select first class if current selection no longer exists
  const cls = classes.find(c => c.id === selClassId) || classes[0] || null
  const effectiveId = cls?.id || null

  const filteredStuds = useMemo(() => {
    const base = sortByLastName(students.filter(s => s.classId === effectiveId || s.classIds?.includes(effectiveId)))
    if (!search.trim()) return base
    const q = search.toLowerCase()
    return base.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  }, [students, effectiveId, search])

  async function handleClear(sub) {
    const studsInClass = students.filter(s => s.classId === effectiveId || s.classIds?.includes(effectiveId))
    const ok = await openDialog({
      title: `Clear grade data for "${sub}"?`,
      msg: `All midterm scores, finals scores, activity scores, quiz scores, and computed final grades for ${sub} will be permanently removed for all ${studsInClass.length} student${studsInClass.length !== 1 ? 's' : ''} in ${cls.name} ${cls.section}.\n\nThis cannot be undone.`,
      type: 'danger',
      confirmLabel: 'Clear All Grades',
      showCancel: true,
    })
    if (!ok) return

    const updated = students.map(s => {
      if (s.classId !== effectiveId && !s.classIds?.includes(effectiveId)) return s
      const ns = { ...s, grades: { ...s.grades }, gradeComponents: { ...(s.gradeComponents || {}) }, gradeUploadedAt: { ...(s.gradeUploadedAt || {}) } }
      delete ns.grades[sub]
      delete ns.gradeComponents[sub]
      delete ns.gradeUploadedAt[sub]
      return ns
    })
    const changedIds = studsInClass.map(s => s.id)
    try {
      await saveStudents(updated, changedIds)
      toast(`Grade data cleared for ${sub}.`, 'green')
    } catch (e) {
      toast('Cleared locally — Firebase sync failed: ' + e.message, 'red')
    }
  }

  function handleExport(sub) {
    exportGradingSheet({ classId: effectiveId, subject: sub, students, classes, eqScale })
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting same file
    if (!file || !importSub) return

    const XLSX = window.XLSX
    if (!XLSX) { toast('SheetJS not loaded.', 'red'); return }

    let entries
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array' })
      entries   = parseGradingSheetImport(wb)
    } catch (err) {
      toast('Could not read file: ' + err.message, 'red')
      return
    }

    if (!entries.length) {
      toast('No student data found in this file.', 'red')
      return
    }

    const sub = importSub
    const ok  = await openDialog({
      title: `Import grades for "${sub}"?`,
      msg: `${entries.length} student record(s) found. Grade components will be updated and grades recomputed for matched students in ${cls?.name} ${cls?.section}.\n\nThis will overwrite existing grade data.`,
      type: 'warning',
      confirmLabel: 'Import Grades',
      showCancel: true,
    })
    if (!ok) { setImportSub(null); return }

    const now       = Date.now()
    const entryMap  = Object.fromEntries(entries.map(en => [en.studentId, en]))
    const clamp     = v => v !== null ? Math.min(100, Math.max(0, v)) : null

    const updatedStudents = students.map(s => {
      if (s.classId !== effectiveId && !s.classIds?.includes(effectiveId)) return s
      const entry = entryMap[s.id]
      if (!entry) return s

      const ns   = { ...s, grades: { ...s.grades }, gradeComponents: { ...(s.gradeComponents || {}) }, gradeUploadedAt: { ...(s.gradeUploadedAt || {}) } }
      const comp = { ...(ns.gradeComponents[sub] || {}) }

      // Attendance — auto from records (matches system formula)
      const attSet = s.attendance?.[sub] || new Set()
      const held   = getHeldDays(effectiveId, sub, students)
      const attV   = held > 0 ? Math.min(100, parseFloat(((attSet.size / held) * 100).toFixed(2))) : null

      // Score components — from import file; fall back to existing stored values
      const actV     = entry.actAvg !== null ? clamp(entry.actAvg)  : (comp.activities   ?? null)
      const qzV      = entry.qzAvg  !== null ? clamp(entry.qzAvg)   : (comp.quizzes      ?? null)
      const midExamV = entry.mtExam !== null ? clamp(entry.mtExam)  : (comp.midtermExam  ?? null)
      const finExamV = entry.ftExam !== null ? clamp(entry.ftExam)  : (comp.finalsExam   ?? null)

      // Persist raw inputs
      if (actV     != null) comp.activities  = actV
      if (qzV      != null) comp.quizzes     = qzV
      if (midExamV != null) comp.midtermExam = midExamV
      if (finExamV != null) comp.finalsExam  = finExamV

      // Class Standing = avg(activities, quizzes, attendance)
      const csParts = [actV, qzV, attV].filter(x => x !== null)
      const cs = csParts.length
        ? parseFloat((csParts.reduce((a, x) => a + x, 0) / csParts.length).toFixed(2))
        : null

      // Midterm Term = avg(CS, Midterm Exam)
      if (midExamV !== null) {
        const p = [cs, midExamV].filter(x => x !== null)
        comp.midtermCS = cs
        comp.midterm   = parseFloat((p.reduce((a, x) => a + x, 0) / p.length).toFixed(2))
      }

      // Finals Term = avg(CS, Finals Exam)
      if (finExamV !== null) {
        const p = [cs, finExamV].filter(x => x !== null)
        comp.finalsCS = cs
        comp.finals   = parseFloat((p.reduce((a, x) => a + x, 0) / p.length).toFixed(2))
      }

      // Final Grade % = avg(Midterm Term, Finals Term)
      let finalGrade = null
      if (comp.midterm != null || comp.finals != null) {
        finalGrade = computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null)
      }

      ns.grades[sub]          = finalGrade
      ns.gradeComponents[sub] = comp
      if (finalGrade !== null) ns.gradeUploadedAt[sub] = now

      return ns
    })

    const studsInClass = students.filter(s => s.classId === effectiveId || s.classIds?.includes(effectiveId))
    const changedIds   = studsInClass.map(s => s.id)
    try {
      await saveStudents(updatedStudents, changedIds)
      toast(`Grades imported for "${sub}"!`, 'green')
    } catch (err) {
      toast('Saved locally — Firebase sync failed: ' + err.message, 'red')
    }
    setImportSub(null)
  }

  return (
    <div>
      {/* Header */}
      <div className="sec-hdr mb-3">
        <div className="sec-title">Grades</div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select className="input" style={{ maxWidth: 280 }}
          value={effectiveId || ''}
          onChange={e => { setSelClassId(e.target.value); setSearch('') }}>
          <option value="">— Select a class —</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name} · {c.section}</option>
          ))}
        </select>
        <input className="input" style={{ maxWidth: 220 }}
          placeholder="Search student…"
          value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      {!effectiveId ? (
        <div className="empty"><div className="empty-icon">📊</div>No classes yet.</div>
      ) : !cls?.subjects?.length ? (
        <div className="empty">This class has no subjects.</div>
      ) : (
        cls.subjects.map(sub => (
          <SubjectCard
            key={sub}
            cls={cls}
            sub={sub}
            studs={filteredStuds}
            eqScale={eqScale}
            onEdit={sub => setEditModal(sub)}
            onClear={handleClear}
            onExport={handleExport}
            onImport={sub => { setImportSub(sub); importFileRef.current?.click() }}
          />
        ))
      )}

      {editModal && (
        <GradeEntryModal
          classId={effectiveId}
          subject={editModal}
          onClose={() => setEditModal(null)}
        />
      )}

      <input
        type="file"
        accept=".xlsx"
        ref={importFileRef}
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </div>
  )
}
