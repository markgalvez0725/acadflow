import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Modal from '@/components/primitives/Modal'
import { gradeInfo, combineEquiv, computeTerms, round2, getHeldDays } from '@/utils/grades'
import { subjectColor } from '@/utils/subjectColor'
import { GraduationCap } from 'lucide-react'

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function clamp(v) {
  if (v === null || v === undefined) return v
  return Math.min(100, Math.max(0, v))
}

// Push a "Grade posted" notification to a student (mirrors GradesTab's helper).
async function pushStudentNotif(db, studentId, title, body, type = 'act_grade', link = 'grades') {
  try {
    const { getDoc, setDoc, doc: fbDoc } = await import('firebase/firestore')
    const ref = fbDoc(db, 'notifications', studentId)
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().items || []) : []
    const notif = { id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5), type, read: false, ts: Date.now(), title, body, link }
    await setDoc(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false })
  } catch (e) {}
}

function pctColor(p) {
  if (p == null) return 'var(--ink3)'
  return p >= 85 ? 'var(--green)' : p >= 75 ? 'var(--yellow)' : 'var(--red)'
}

// One editable subject row. The displayed Final/Equiv are computed from the SAME
// inputs (and the SAME computeTerms) used on save, so what's shown is what saves.
function SubjectRow({ sub, meta, eqScale, row, onChange }) {
  const col = subjectColor(sub).color
  const comp = meta.comp

  const { midterm, finals, final } = computeTerms({
    activities:  comp.activities ?? null,
    quizzes:     comp.quizzes ?? null,
    attendance:  meta.att,
    attitude:    comp.attitude ?? null,
    midtermExam: toNum(row.midtermExam),
    finalsExam:  toNum(row.finalsExam),
  })

  let equiv = '—', remark = null, remarkCls = 'badge-gray'
  if (midterm != null && finals != null) {
    const combined = combineEquiv(gradeInfo(midterm, eqScale).eq, gradeInfo(finals, eqScale).eq)
    equiv = combined.eq
    remark = combined.rem
    remarkCls = combined.rem === 'Passed' ? 'badge-green' : combined.rem === 'Conditional' ? 'badge-yellow' : combined.rem === 'Failed' ? 'badge-red' : 'badge-gray'
  } else if (midterm != null) {
    equiv = gradeInfo(midterm, eqScale).eq
  } else if (finals != null) {
    equiv = gradeInfo(finals, eqScale).eq
  }

  const finalDisplay = final != null ? Math.round(final) : '—'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 84px 84px 56px 64px auto', gap: 8, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sub}>{sub}</span>
      </div>
      <input
        type="number" min="0" max="100" step="0.1"
        className="input"
        style={{ padding: '4px 8px', fontSize: 13, height: 32 }}
        value={row.midtermExam}
        onChange={e => onChange('midtermExam', e.target.value)}
        placeholder="—"
        aria-label={`${sub} midterm exam`}
      />
      <input
        type="number" min="0" max="100" step="0.1"
        className="input"
        style={{ padding: '4px 8px', fontSize: 13, height: 32 }}
        value={row.finalsExam}
        onChange={e => onChange('finalsExam', e.target.value)}
        placeholder="—"
        aria-label={`${sub} finals exam`}
      />
      <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink2)' }} title="Class standing (activities, quizzes, attendance, attitude)">
        {meta.cs != null ? Math.round(meta.cs) : '—'}
      </div>
      <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, color: pctColor(final), lineHeight: 1 }}>
        {finalDisplay}
      </div>
      <div style={{ minWidth: 64, textAlign: 'right' }}>
        {remark
          ? <span className={`badge ${remarkCls}`}>{equiv}</span>
          : <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{equiv}</span>}
      </div>
    </div>
  )
}

export default function StudentGradeEditModal() {
  const { editGradesStudentId, closeEditGrades, toast } = useUI()
  const { students, classes, saveStudents, eqScale, db, fbReady, logAudit } = useData()

  const student = useMemo(() => students.find(s => s.id === editGradesStudentId) || null, [students, editGradesStudentId])

  const enrolledIds = useMemo(() => {
    if (!student) return []
    return student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
  }, [student])

  const subjects = useMemo(() => {
    if (!student) return []
    const enrolledClasses = enrolledIds.map(id => classes.find(c => c.id === id)).filter(Boolean)
    // Union enrolled-class subjects with any already-graded subjects, so an
    // unassigned student (or one whose class was archived/removed) is editable.
    return [...new Set([
      ...enrolledClasses.flatMap(c => c.subjects || []),
      ...Object.keys(student.grades || {}),
      ...Object.keys(student.gradeComponents || {}),
    ])]
  }, [student, enrolledIds, classes])

  // Per-subject derived context: stored components + LIVE attendance + CS.
  // Attendance is recomputed here (never persisted) exactly like GradesTab, so
  // the class-standing folded into each term matches the canonical computation.
  const subjectMeta = useMemo(() => {
    const map = {}
    if (!student) return map
    for (const sub of subjects) {
      const comp = student.gradeComponents?.[sub] || {}
      const clsId = enrolledIds.find(id => classes.find(c => c.id === id)?.subjects?.includes(sub)) || null
      const attSet = student.attendance?.[sub] || new Set()
      const held = clsId ? getHeldDays(clsId, sub, students) : 0
      const att = held > 0 ? Math.min(100, parseFloat(((attSet.size / held) * 100).toFixed(2))) : null
      const { cs } = computeTerms({
        activities: comp.activities ?? null, quizzes: comp.quizzes ?? null,
        attendance: att, attitude: comp.attitude ?? null,
      })
      map[sub] = { comp, clsId, att, cs }
    }
    return map
  }, [student, subjects, enrolledIds, classes, students])

  const initRows = useMemo(() => {
    const out = {}
    for (const sub of subjects) {
      const comp = student?.gradeComponents?.[sub] || {}
      out[sub] = {
        midtermExam: comp.midtermExam != null ? String(comp.midtermExam) : '',
        finalsExam:  comp.finalsExam  != null ? String(comp.finalsExam)  : '',
      }
    }
    return out
  }, [student, subjects])

  const [rows, setRows] = useState({})
  const [saving, setSaving] = useState(false)

  // Reset row state whenever the modal opens for a different student.
  const [lastStudentId, setLastStudentId] = useState(null)
  if (editGradesStudentId !== lastStudentId) {
    setLastStudentId(editGradesStudentId)
    setRows(initRows)
  }

  if (!editGradesStudentId) return null
  if (!student) {
    return (
      <Modal onClose={closeEditGrades} size="md">
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink2)' }}>Student not found.</div>
      </Modal>
    )
  }

  function handleChange(sub, field, val) {
    // clamp 0–100 on entry so the preview can't show out-of-range values
    let v = val
    if (v !== '') {
      const n = parseFloat(v)
      if (!isNaN(n)) v = String(Math.min(100, Math.max(0, n)))
    }
    setRows(prev => ({ ...prev, [sub]: { ...prev[sub], [field]: v } }))
  }

  async function handleSave() {
    setSaving(true)
    const now = Date.now()
    const changedSubs = []

    try {
      const updated = students.map(s => {
        if (s.id !== student.id) return s
        const ns = { ...s, grades: { ...s.grades }, gradeComponents: { ...(s.gradeComponents || {}) }, gradeUploadedAt: { ...(s.gradeUploadedAt || {}) } }

        for (const sub of subjects) {
          const meta = subjectMeta[sub]
          const r = rows[sub] || {}
          const origMid = meta.comp.midtermExam != null ? String(meta.comp.midtermExam) : ''
          const origFin = meta.comp.finalsExam  != null ? String(meta.comp.finalsExam)  : ''
          const midRaw = (r.midtermExam ?? '').trim()
          const finRaw = (r.finalsExam ?? '').trim()

          // Only touch subjects the teacher actually changed. This preserves
          // manual-override grades (no exams) and avoids needless rewrites.
          if (midRaw === origMid && finRaw === origFin) continue
          changedSubs.push(sub)

          const comp = { ...meta.comp }
          const midExamV = midRaw === '' ? null : clamp(toNum(midRaw))
          const finExamV = finRaw === '' ? null : clamp(toNum(finRaw))

          const { cs, midterm, finals, final } = computeTerms({
            activities: comp.activities ?? null, quizzes: comp.quizzes ?? null,
            attendance: meta.att, attitude: comp.attitude ?? null,
            midtermExam: midExamV, finalsExam: finExamV,
          })

          if (midExamV === null) { delete comp.midtermExam; delete comp.midterm; delete comp.midtermCS }
          else { comp.midtermExam = midExamV; comp.midterm = round2(midterm); comp.midtermCS = round2(cs) }

          if (finExamV === null) { delete comp.finalsExam; delete comp.finals; delete comp.finalsCS }
          else { comp.finalsExam = finExamV; comp.finals = round2(finals); comp.finalsCS = round2(cs) }

          const finalGrade = (comp.midterm != null || comp.finals != null) ? final : null
          ns.gradeComponents[sub] = comp
          ns.grades[sub] = finalGrade
          if (finalGrade != null) ns.gradeUploadedAt[sub] = now
        }
        return ns
      })

      if (!changedSubs.length) {
        toast('No changes to save.', 'dark')
        setSaving(false)
        closeEditGrades()
        return
      }

      await saveStudents(updated, [student.id])
      logAudit?.({
        action: 'grade.edit',
        target: student.name,
        summary: `Saved grades for ${student.name} (${changedSubs.length} subject${changedSubs.length === 1 ? '' : 's'})`,
        meta: { studentId: student.id, subjects: changedSubs },
      })
      toast('Grades saved!', 'green')

      // Best-effort: notify the student for each subject whose grade was posted.
      if (fbReady && db?.current) {
        const us = updated.find(x => x.id === student.id)
        for (const sub of changedSubs) {
          const grade = us?.grades?.[sub]
          if (grade != null) {
            pushStudentNotif(db.current, student.id, `Grade posted for ${sub}`, `Final Grade: ${grade.toFixed(1)}`, 'act_grade', 'grades')
          }
        }
      }
      closeEditGrades()
    } catch (e) {
      toast('Failed to save: ' + (e?.message || 'unknown error'), 'red')
    } finally {
      setSaving(false)
    }
  }

  const initial = (student.name || '?').charAt(0).toUpperCase()

  return (
    <Modal onClose={closeEditGrades} size="lg">
      <div className="pr-8" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div className="stu-avatar" style={{ width: 44, height: 44, fontSize: 18, flexShrink: 0, overflow: 'hidden' }}>
          {student.photo ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GraduationCap size={15} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Edit Grades</h3>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student.name} · #{student.id}</div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12, lineHeight: 1.5 }}>
        Enter the <strong>Midterm</strong> and <strong>Finals</strong> exam scores per subject. Class standing (CS) —
        activities, quizzes, attendance &amp; attitude — is carried over and folded into each term automatically.
        Leave both blank to keep a subject untouched.
      </p>

      {!subjects.length ? (
        <div className="empty" style={{ padding: 32 }}>No enrolled subjects to edit.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 84px 84px 56px 64px auto', gap: 8, padding: '0 0 6px', borderBottom: '2px solid var(--border)' }}>
            {['Subject', 'Midterm', 'Finals', 'CS', 'Final', 'Equiv'].map((h, i) => (
              <div key={h} style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: i >= 3 ? (i === 5 ? 'right' : 'center') : 'left' }}>{h}</div>
            ))}
          </div>

          {subjects.map(sub => (
            <SubjectRow
              key={sub}
              sub={sub}
              meta={subjectMeta[sub]}
              eqScale={eqScale}
              row={rows[sub] || { midtermExam: '', finalsExam: '' }}
              onChange={(field, val) => handleChange(sub, field, val)}
            />
          ))}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={closeEditGrades} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Grades'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
