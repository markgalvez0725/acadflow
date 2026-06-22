import React, { useState, useMemo } from 'react'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import { getHeldDays, computeFinalGradeFromTerms } from '@/utils/grades'
import Modal from '@/components/primitives/Modal'
import Pagination from '@/components/primitives/Pagination'
import Badge from '@/components/primitives/Badge'
import { Clock, AlertCircle, X, Archive, ArchiveRestore, Sparkles, Wand2, Pencil, ClipboardList, AlarmClock, CircleDot, BarChart3, CheckCircle2, Check, Save, Plus } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
import { deviceRubric, deviceInstructions, aiInstructions, aiRubric, aiGrade, isNotConfigured } from '@/utils/activityAI'
import { sendPushToOwners } from '@/firebase/pushTokens'

function fmtLocalInput(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Helpers ───────────────────────────────────────────────────────────
function actId() {
  return 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

function defaultDeadlineStr() {
  const dl = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${dl.getFullYear()}-${pad(dl.getMonth() + 1)}-${pad(dl.getDate())}T${pad(dl.getHours())}:${pad(dl.getMinutes())}`
}

// ── Push a notification to a specific student ─────────────────────────
async function pushStudentNotif(db, studentId, title, body, link = 'activities') {
  try {
    const { getDoc, setDoc, doc: fbDoc } = await import('firebase/firestore')
    const ref = fbDoc(db, 'notifications', studentId)
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().items || []) : []
    const notif = {
      id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
      type: 'act_grade', read: false, ts: Date.now(), title, body, link,
    }
    await setDoc(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false })
  } catch (e) {}
}

// ── Recompute student grade components after activity scoring ─────────
// Mirrors _actUpdateStudentGrade from original
function buildUpdatedStudent(s, subject, classId, allActivities, allStudents) {
  const comp = { ...(s.gradeComponents?.[subject] || {}) }

  const subjectActs = allActivities.filter(a => a.classId === classId && a.subject === subject)
  const scores = subjectActs.map(a => (a.submissions || {})[s.id]?.score).filter(v => v != null)
  if (!scores.length) return null

  const actAvg = parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2))
  comp.activities = actAvg

  const actScores = {}
  subjectActs.forEach((a, idx) => {
    const sc = (a.submissions || {})[s.id]?.score
    if (sc != null) {
      actScores['a' + (idx + 1)] = sc
      actScores[a.id] = sc
    }
  })
  comp.activityScores = actScores

  const midExamV = comp.midtermExam ?? null
  const finExamV = comp.finalsExam  ?? null
  const qzV      = comp.quizzes     ?? null

  const held  = getHeldDays(classId, subject, allStudents)
  const attSet = s.attendance?.[subject] || new Set()
  const attV = held > 0 ? parseFloat(((attSet.size / held) * 100).toFixed(2)) : null

  const csParts = [actAvg, qzV, attV].filter(x => x !== null)
  const cs = csParts.length
    ? parseFloat((csParts.reduce((a, b) => a + b, 0) / csParts.length).toFixed(2))
    : null
  comp.midtermCS = cs
  comp.finalsCS  = cs

  if (midExamV !== null) {
    const mtParts = [cs, midExamV].filter(x => x !== null)
    comp.midterm = parseFloat((mtParts.reduce((a, b) => a + b, 0) / mtParts.length).toFixed(2))
  }

  if (finExamV !== null) {
    const ftParts = [cs, finExamV].filter(x => x !== null)
    comp.finals = parseFloat((ftParts.reduce((a, b) => a + b, 0) / ftParts.length).toFixed(2))
  }

  const newGrade = (comp.midterm != null || comp.finals != null)
    ? computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null)
    : s.grades?.[subject] ?? null

  return {
    ...s,
    grades: { ...s.grades, [subject]: newGrade },
    gradeComponents: { ...s.gradeComponents, [subject]: comp },
  }
}

// ── Rubric helpers ────────────────────────────────────────────────────
function newCriterion() {
  return { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5), name: '', points: 10 }
}

// ── Create / Edit Modal ───────────────────────────────────────────────
function ActivityFormModal({ act, onClose }) {
  const { classes, db, fbReady } = useData()
  const { toast } = useUI()
  const isEdit = !!act

  const [title,    setTitle]    = useState(act?.title || '')
  const [classId,  setClassId]  = useState(act?.classId || '')
  const [subject,  setSubject]  = useState(act?.subject || '')
  const [deadline, setDeadline] = useState(() => {
    if (act?.deadline) {
      const d = new Date(act.deadline)
      const pad = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return defaultDeadlineStr()
  })
  const [instructions, setInstructions] = useState(act?.instructions || '')
  const [rubric, setRubric] = useState(() => act?.rubric?.length ? act.rubric : [])
  const [err,     setErr]     = useState('')
  const [saving,  setSaving]  = useState(false)
  const [aiBusyInstr, setAiBusyInstr] = useState(false)
  const [aiBusyRubric, setAiBusyRubric] = useState(false)

  const selectedClass = classes.find(c => c.id === classId)

  // Deadline quick-presets
  function presetDeadline(kind) {
    const d = new Date()
    if (kind === 'eod') { d.setHours(23, 59, 0, 0) }
    else if (kind === '3d') { d.setDate(d.getDate() + 3) }
    else if (kind === '1w') { d.setDate(d.getDate() + 7) }
    setDeadline(fmtLocalInput(d))
  }

  // AI-assist: instructions (Gemini if set up, else on-device template)
  async function suggestInstructions() {
    if (!title.trim()) { toast('Add a title first.', 'warn'); return }
    setAiBusyInstr(true)
    try {
      const text = await aiInstructions(title, subject)
      if (text) setInstructions(text)
    } catch (e) {
      setInstructions(deviceInstructions(title, subject))
      if (!isNotConfigured(e)) toast('Used a quick template (AI unavailable).', 'info')
    } finally { setAiBusyInstr(false) }
  }

  // Auto-suggest rubric criteria
  async function suggestRubric() {
    if (!title.trim()) { toast('Add a title first.', 'warn'); return }
    setAiBusyRubric(true)
    try {
      const r = await aiRubric(title, subject, instructions)
      setRubric(r.length ? r : deviceRubric(title, subject))
    } catch (e) {
      setRubric(deviceRubric(title, subject))
      if (!isNotConfigured(e)) toast('Used a template rubric (AI unavailable).', 'info')
    } finally { setAiBusyRubric(false) }
  }

  // maxScore is derived from rubric total if rubric exists, else 100
  const maxScore = rubric.length
    ? rubric.reduce((s, c) => s + (parseFloat(c.points) || 0), 0)
    : 100

  function handleClassChange(id) {
    setClassId(id)
    setSubject('')
  }

  function addCriterion() {
    setRubric(prev => [...prev, newCriterion()])
  }

  function removeCriterion(id) {
    setRubric(prev => prev.filter(c => c.id !== id))
  }

  function updateCriterion(id, field, val) {
    setRubric(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c))
  }

  async function handleSave() {
    setErr('')
    if (!title.trim())   { setErr('Activity title is required.'); return }
    if (!classId)        { setErr('Please select a class.'); return }
    if (!subject)        { setErr('Please select a subject.'); return }
    if (!deadline)       { setErr('Please set a deadline.'); return }
    const dlTs = new Date(deadline).getTime()
    if (isNaN(dlTs))     { setErr('Invalid deadline date.'); return }

    // Validate rubric if used
    if (rubric.length) {
      for (const c of rubric) {
        if (!c.name.trim()) { setErr('Each rubric criterion must have a name.'); return }
        const pts = parseFloat(c.points)
        if (isNaN(pts) || pts < 1) { setErr('Each criterion must have at least 1 point.'); return }
      }
      if (maxScore < 1 || maxScore > 1000) { setErr('Rubric total must be between 1 and 1000.'); return }
    }

    if (!fbReady || !db.current) { setErr('Firebase is required to post activities.'); return }

    const cleanRubric = rubric.map(c => ({ id: c.id, name: c.name.trim(), points: parseFloat(c.points) || 0 }))

    setSaving(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db.current, 'activities', act.id), {
          title: title.trim(), classId, subject, maxScore, deadline: dlTs,
          instructions: instructions.trim(), rubric: cleanRubric,
        })
      } else {
        const id = actId()
        await setDoc(doc(db.current, 'activities', id), {
          id, title: title.trim(), classId, subject, maxScore, deadline: dlTs,
          instructions: instructions.trim(), rubric: cleanRubric,
          createdAt: Date.now(), createdBy: 'admin', submissions: {},
        })
      }
      toast(isEdit ? 'Activity updated!' : 'Activity posted!', 'green')
      onClose()
    } catch (e) {
      setErr((isEdit ? 'Failed to update: ' : 'Failed to post: ') + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1">
        {isEdit ? <><Pencil size={18} /> Edit Activity</> : <><ClipboardList size={18} /> New Activity</>}
      </h3>
      <p className="modal-sub">{isEdit ? 'Update activity details below.' : 'Fill in the activity details below.'}</p>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Title <span className="text-red-500">*</span></label>
        <input className="input w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Lab Report 1" autoFocus />
      </div>

      <div className="input-row mb-3">
        <div className="field flex-1">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Class <span className="text-red-500">*</span></label>
          <select className="input w-full" value={classId} onChange={e => handleClassChange(e.target.value)} disabled={isEdit}>
            <option value="">— Select Class —</option>
            {classes.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
          </select>
        </div>
        <div className="field flex-1">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Subject <span className="text-red-500">*</span></label>
          <select className="input w-full" value={subject} onChange={e => setSubject(e.target.value)} disabled={isEdit}>
            <option value="">— Select Subject —</option>
            {(selectedClass?.subjects || []).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Deadline <span className="text-red-500">*</span></label>
        <input className="input w-full" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
        <div className="flex gap-1.5 mt-2 flex-wrap">
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => presetDeadline('eod')}>End of day</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => presetDeadline('3d')}>In 3 days</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => presetDeadline('1w')}>In 1 week</button>
        </div>
      </div>

      <div className="field mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-ink2">Instructions <span className="font-normal text-ink3">(optional)</span></label>
          <button type="button" className="btn btn-ghost btn-xs" onClick={suggestInstructions} disabled={aiBusyInstr}>
            <Sparkles size={12} className="inline-block mr-1" />{aiBusyInstr ? 'Writing…' : 'Suggest'}
          </button>
        </div>
        <textarea className="input w-full" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Brief instructions for students…" />
      </div>

      {/* Rubric builder */}
      <div className="field mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-ink2">
            Grading Rubric <span className="font-normal text-ink3">(optional)</span>
          </label>
          <div className="flex gap-1.5">
            <button type="button" className="btn btn-ghost btn-sm" onClick={suggestRubric} disabled={aiBusyRubric}>
              <Wand2 size={13} className="inline-block mr-1" />{aiBusyRubric ? 'Suggesting…' : 'Suggest rubric'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCriterion}>+ Add Criterion</button>
          </div>
        </div>

        {rubric.length === 0 ? (
          <p className="text-xs text-ink3">No rubric set — max score defaults to 100.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {rubric.map((c, i) => (
                <div key={c.id} className="flex gap-2 items-center">
                  <span className="text-xs text-ink3 w-4">{i + 1}.</span>
                  <input
                    className="input flex-1"
                    placeholder="Criterion name (e.g. Clarity)"
                    value={c.name}
                    onChange={e => updateCriterion(c.id, 'name', e.target.value)}
                  />
                  <input
                    className="input"
                    type="number"
                    min="1"
                    style={{ width: 70 }}
                    placeholder="pts"
                    value={c.points}
                    onChange={e => updateCriterion(c.id, 'points', e.target.value)}
                  />
                  <span className="text-xs text-ink3">pts</span>
                  <button type="button" className="btn btn-ghost btn-sm text-red-500" onClick={() => removeCriterion(c.id)}><X size={16} /></button>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink2 mt-2">
              Total: <strong>{maxScore} pts</strong> (max score set automatically from rubric)
            </p>
          </>
        )}
      </div>

      {err && <div className="err-msg mb-2">{err}</div>}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? <><Save size={16} /> Save Changes</> : <><ClipboardList size={16} /> Post Activity</>}
        </button>
      </div>
    </Modal>
  )
}

// ── View / Grade Modal ────────────────────────────────────────────────
function ViewActivityModal({ act, onClose, onEdit, onDelete }) {
  const { students, activities, saveStudents, db, fbReady, logAudit } = useData()
  const { toast, openDialog } = useUI()
  const [scores,        setScores]       = useState({})
  const [feedbacks,     setFeedbacks]    = useState({}) // { [studentId]: string } — teacher feedback
  const [rubricChecks,  setRubricChecks] = useState({}) // { [studentId]: { [criterionId]: bool } }
  const [aiFor,    setAiFor]    = useState(null)  // studentId for grading assist
  const [aiText,   setAiText]   = useState('')
  const [aiBusy,   setAiBusy]   = useState(false)
  const [aiResult, setAiResult] = useState(null)  // { score, feedback, criteria }
  const [saving,        setSaving]       = useState({})
  const [savingAll,     setSavingAll]    = useState(false)

  const hasRubric = !!(act.rubric?.length)

  const now    = Date.now()
  const isPast = act.deadline < now
  const cls    = act.classId
  const dlLabel = new Date(act.deadline).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

  const enrolledStudents = useMemo(
    () => sortByLastName(students.filter(s => s.classId === act.classId && s.account?.registered)),
    [students, act.classId]
  )

  const submitted = Object.values(act.submissions || {}).filter(s => s.link).length
  const graded    = Object.values(act.submissions || {}).filter(s => s.score != null).length

  const timeLeft = useMemo(() => {
    if (isPast) return null
    const mins = Math.round((act.deadline - now) / 60000)
    if (mins > 1440) return Math.round(mins / 1440) + 'd'
    if (mins > 60)   return Math.round(mins / 60) + 'h ' + Math.round(mins % 60) + 'm'
    return mins + 'm'
  }, [act.deadline, isPast])

  function toggleRubricCheck(studentId, criterionId) {
    setRubricChecks(prev => {
      const cur = prev[studentId] || {}
      const updated = { ...cur, [criterionId]: !cur[criterionId] }
      const autoScore = act.rubric.reduce((s, c) => s + (updated[c.id] ? (parseFloat(c.points) || 0) : 0), 0)
      setScores(s => ({ ...s, [studentId]: String(autoScore) }))
      return { ...prev, [studentId]: updated }
    })
  }

  async function handleSaveScore(s) {
    const raw = scores[s.id]
    if (raw === undefined || raw === '') return
    const score = parseFloat(raw)
    if (isNaN(score) || score < 0 || score > act.maxScore) {
      toast('Score must be 0–' + act.maxScore, 'red')
      return
    }
    if (!fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }

    const rubricSnapshot = hasRubric ? (rubricChecks[s.id] || {}) : undefined

    setSaving(prev => ({ ...prev, [s.id]: true }))
    try {
      const update = {
        [`submissions.${s.id}.score`]:  score,
        [`submissions.${s.id}.graded`]: true,
      }
      if (rubricSnapshot !== undefined) update[`submissions.${s.id}.rubricChecks`] = rubricSnapshot
      // Persist teacher feedback only when the field was touched this session.
      if (feedbacks[s.id] !== undefined) update[`submissions.${s.id}.feedback`] = feedbacks[s.id].trim()
      await updateDoc(doc(db.current, 'activities', act.id), update)
      // Update local student grade components
      const updated = buildUpdatedStudent(s, act.subject, act.classId, activities, students)
      if (updated) await saveStudents(students.map(x => x.id === s.id ? updated : x), [s.id])
      toast('Score saved!', 'green')
      if (fbReady && db.current) {
        pushStudentNotif(db.current, s.id, `Activity graded: ${act.title}`, `${act.subject} — Score: ${score}/${act.maxScore}`, 'activities')
      }
    } catch (e) {
      toast('Save failed: ' + e.message, 'red')
    } finally {
      setSaving(prev => ({ ...prev, [s.id]: false }))
    }
  }

  async function handleApplyDefault() {
    const missed = enrolledStudents.filter(s => !(act.submissions || {})[s.id]?.link)
    if (!missed.length) { toast('All registered students have already submitted.', 'green'); return }
    const ok = await openDialog({
      title: 'Apply default score?',
      msg: `This will give ${missed.length} student${missed.length !== 1 ? 's' : ''} a score of 50.`,
      type: 'warning',
      confirmLabel: 'Apply Score',
      showCancel: true,
    })
    if (!ok) return

    const updates = {}
    missed.forEach(s => {
      updates[`submissions.${s.id}.score`]      = 50
      updates[`submissions.${s.id}.graded`]     = true
      updates[`submissions.${s.id}.autoGraded`] = true
    })
    try {
      await updateDoc(doc(db.current, 'activities', act.id), updates)
      const updatedStudents = students.map(s => {
        if (!missed.find(x => x.id === s.id)) return s
        const updatedActs = activities.map(a =>
          a.id === act.id
            ? { ...a, submissions: { ...a.submissions, [s.id]: { ...(a.submissions || {})[s.id], score: 50, graded: true } } }
            : a
        )
        const updated = buildUpdatedStudent(s, act.subject, act.classId, updatedActs, students)
        return updated || s
      })
      await saveStudents(updatedStudents, missed.map(s => s.id))
      toast(`Applied score of 50 to ${missed.length} student${missed.length !== 1 ? 's' : ''}.`, 'green')
      if (fbReady && db.current) {
        for (const s of missed) {
          pushStudentNotif(db.current, s.id, `Activity graded: ${act.title}`, `${act.subject} — Score: 50/${act.maxScore}`, 'activities')
        }
      }
    } catch (e) {
      toast('Failed: ' + e.message, 'red')
    }
  }

  async function handleExtend() {
    const cur = new Date(act.deadline)
    const pad = n => String(n).padStart(2, '0')
    const defVal = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}T${pad(cur.getHours())}:${pad(cur.getMinutes())}`
    const newDl = window.prompt('Set new deadline (current: ' + dlLabel + ').\n\nEnter new date/time:', defVal)
    if (!newDl) return
    const ts = new Date(newDl).getTime()
    if (isNaN(ts) || ts < Date.now()) { toast('Invalid date or date is in the past.', 'red'); return }
    try {
      await updateDoc(doc(db.current, 'activities', act.id), { deadline: ts })
      toast('Deadline extended!', 'green')
    } catch (e) {
      toast('Failed: ' + e.message, 'red')
    }
  }

  async function handleSaveAll() {
    if (!fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    const toSave = enrolledStudents.filter(s => {
      const raw = scores[s.id]
      if (raw === undefined || raw === '') return false
      const score = parseFloat(raw)
      return !isNaN(score) && score >= 0 && score <= act.maxScore
    })
    if (!toSave.length) { toast('No valid scores to save.', 'red'); return }
    setSavingAll(true)
    try {
      const update = {}
      toSave.forEach(s => {
        const score = parseFloat(scores[s.id])
        update[`submissions.${s.id}.score`]  = score
        update[`submissions.${s.id}.graded`] = true
        if (hasRubric) update[`submissions.${s.id}.rubricChecks`] = rubricChecks[s.id] || {}
        if (feedbacks[s.id] !== undefined) update[`submissions.${s.id}.feedback`] = feedbacks[s.id].trim()
      })
      await updateDoc(doc(db.current, 'activities', act.id), update)
      const updatedStudents = students.map(s => {
        if (!toSave.find(x => x.id === s.id)) return s
        const updated = buildUpdatedStudent(s, act.subject, act.classId, activities, students)
        return updated || s
      })
      await saveStudents(updatedStudents, toSave.map(s => s.id))
      toast(`Saved grades for ${toSave.length} student${toSave.length !== 1 ? 's' : ''}.`, 'green')
      if (fbReady && db.current) {
        for (const s of toSave) {
          const score = parseFloat(scores[s.id])
          pushStudentNotif(db.current, s.id, `Activity graded: ${act.title}`, `${act.subject} — Score: ${score}/${act.maxScore}`, 'activities')
        }
      }
    } catch (e) {
      toast('Save failed: ' + e.message, 'red')
    } finally {
      setSavingAll(false)
    }
  }

  async function runAiGrade(studentId) {
    if (!aiText.trim()) { toast('Paste the student\'s submission text first.', 'warn'); return }
    setAiBusy(true); setAiResult(null)
    try {
      const res = await aiGrade({
        title: act.title, subject: act.subject, instructions: act.instructions,
        rubric: act.rubric, maxScore: act.maxScore, submissionText: aiText,
      })
      setAiResult(res)
    } catch (e) {
      if (isNotConfigured(e)) toast('AI grading needs a free Gemini key (set GEMINI_API_KEY in Vercel).', 'warn', 7000)
      else toast('AI error: ' + e.message, 'error', 7000)
    } finally { setAiBusy(false) }
  }

  function applyAiGrade(studentId) {
    if (!aiResult) return
    setScores(prev => ({ ...prev, [studentId]: String(aiResult.score) }))
    // Pre-fill the feedback box with the AI's notes so the teacher can review,
    // edit, and save it for the student (previously it was shown but discarded).
    if (aiResult.feedback) setFeedbacks(prev => ({ ...prev, [studentId]: aiResult.feedback }))
    if (hasRubric && Array.isArray(aiResult.criteria)) {
      const checks = {}
      act.rubric.forEach(c => {
        const m = aiResult.criteria.find(x => (x.name || '').toLowerCase().trim() === c.name.toLowerCase().trim())
        if (m && m.met) checks[c.id] = true
      })
      setRubricChecks(prev => ({ ...prev, [studentId]: checks }))
    }
    setAiFor(null); setAiText(''); setAiResult(null)
    toast('AI suggestion applied. Review and Save.', 'green')
  }

  async function handleDelete() {
    const ok = await openDialog({
      title: `Delete "${act.title}"?`,
      msg: 'This activity and all submissions will be permanently removed.',
      type: 'danger',
      confirmLabel: 'Delete Activity',
      showCancel: true,
    })
    if (!ok) return
    try {
      await deleteDoc(doc(db.current, 'activities', act.id))
      logAudit?.({
        action: 'activity.delete',
        target: act.title,
        summary: `Deleted activity "${act.title}"${act.subject ? ' (' + act.subject + ')' : ''}`,
        meta: { activityId: act.id, subject: act.subject || null, classId: act.classId || null },
      })
      onDelete()
    } catch (e) {
      toast('Failed: ' + e.message, 'red')
    }
  }

  // Manual deadline reminder: notify enrolled students who haven't submitted.
  async function handleRemind() {
    const missing = enrolledStudents.filter(s => !(act.submissions || {})[s.id]?.link)
    if (!missing.length) { toast('Everyone enrolled has already submitted.', 'green'); return }
    const ok = await openDialog({
      title: `Remind ${missing.length} student${missing.length === 1 ? '' : 's'}?`,
      msg: `Send a reminder to enrolled students who haven't submitted "${act.title}".`,
      confirmLabel: 'Send reminder',
      showCancel: true,
    })
    if (!ok) return
    const ids = missing.map(s => s.id)
    const title = `Reminder: ${act.title}`
    const body = isPast
      ? `${act.subject} — this activity is past due. Please submit as soon as you can.`
      : `${act.subject} — due ${dlLabel}. Don't forget to submit.`
    // In-app notifications (reliable) + best-effort web push.
    if (fbReady && db.current) {
      for (const id of ids) pushStudentNotif(db.current, id, title, body, 'activities')
      sendPushToOwners(db.current, ids, { title, body }, { url: 'activities', tag: 'deadline-reminder' })
    }
    toast(`Reminder sent to ${ids.length} student${ids.length === 1 ? '' : 's'}.`, 'green')
  }

  return (
    <Modal onClose={onClose} size="lg">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-lg font-bold text-ink"><ClipboardList size={18} /> {act.title}</h3>
          <p className="text-xs text-ink2 mt-0.5">
            {act.subject} · Max {act.maxScore} pts · Deadline: {dlLabel}
          </p>
          <p className="text-xs text-ink2">
            {submitted}/{enrolledStudents.length} submitted · {graded} graded
          </p>
        </div>
        <button className="text-ink3 hover:text-ink" onClick={onClose}><X size={18} /></button>
      </div>

      {/* Deadline banner */}
      {isPast ? (
        <div style={{ background: 'var(--red-l)', color: 'var(--red)', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <AlarmClock size={14} /> <strong>Deadline passed.</strong> Students can no longer submit.
        </div>
      ) : (
        <div style={{ background: 'var(--green-l)', color: 'var(--green)', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <CircleDot size={14} /> <strong>Open — {timeLeft} remaining.</strong> Students can still submit.
        </div>
      )}

      {act.instructions && (
        <div className="text-xs text-ink2 mb-3 p-2 rounded" style={{ background: 'var(--surface2)', borderRadius: 6 }}>
          {act.instructions}
        </div>
      )}

      {/* Rubric summary */}
      {hasRubric && (
        <div className="mb-3" style={{ background: 'var(--surface2)', borderRadius: 6, padding: '10px 14px' }}>
          <div className="text-xs font-semibold text-ink2 mb-1"><BarChart3 size={14} /> Grading Rubric</div>
          <div className="flex flex-wrap gap-2">
            {act.rubric.map(c => (
              <span key={c.id} style={{ fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', color: 'var(--ink2)' }}>
                {c.name} <strong>{c.points}pt{c.points !== 1 ? 's' : ''}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Submissions table */}
      {!enrolledStudents.length ? (
        <div className="empty">No registered students in this class yet.</div>
      ) : (
        <div className="tbl-wrap mb-3">
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Submission</th>
                {hasRubric && <th>Rubric</th>}
                <th>Score /{act.maxScore}</th>
                <th>Feedback</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {enrolledStudents.map(s => {
                const sub    = (act.submissions || {})[s.id] || {}
                const hasLink = !!sub.link
                const curScore = sub.score != null ? sub.score : ''
                const subDate = sub.submittedAt
                  ? new Date(sub.submittedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : '—'
                const inputVal = scores[s.id] !== undefined ? scores[s.id] : String(curScore)
                const checks = rubricChecks[s.id] || {}
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                      <br />
                      <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{s.id}</span>
                    </td>
                    <td>
                      {hasLink
                        ? <Badge variant="green"><CheckCircle2 size={14} /> Submitted</Badge>
                        : <Badge variant="gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{isPast ? <><AlertCircle size={11} />Missed</> : <><Clock size={11} />Pending</>}</Badge>
                      }
                    </td>
                    <td>
                      {hasLink ? (
                        <>
                          <a
                            href={sub.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 11, color: 'var(--c-accent)', wordBreak: 'break-all', maxWidth: 200, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {sub.link.replace(/^https?:\/\//, '').slice(0, 40)}…
                          </a>
                          <br />
                          <span style={{ fontSize: 10, color: 'var(--ink3)' }}>{subDate}</span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--ink3)', fontSize: 11 }}>No submission</span>
                      )}
                    </td>
                    {hasRubric && (
                      <td>
                        <div className="flex flex-col gap-1">
                          {act.rubric.map(c => (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              <input
                                type="checkbox"
                                checked={!!(checks[c.id])}
                                onChange={() => toggleRubricCheck(s.id, c.id)}
                                style={{ accentColor: 'var(--c-accent)' }}
                              />
                              {c.name} <span style={{ color: 'var(--ink3)' }}>({c.points}pt{c.points !== 1 ? 's' : ''})</span>
                            </label>
                          ))}
                        </div>
                      </td>
                    )}
                    <td>
                      <input
                        type="number"
                        min="0"
                        max={act.maxScore}
                        value={inputVal}
                        onChange={e => setScores(prev => ({ ...prev, [s.id]: e.target.value }))}
                        style={{ width: 70, padding: '5px 7px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'center', background: 'var(--surface)', color: 'var(--ink)' }}
                        placeholder="—"
                      />
                    </td>
                    <td>
                      <textarea
                        value={feedbacks[s.id] !== undefined ? feedbacks[s.id] : (sub.feedback || '')}
                        onChange={e => setFeedbacks(prev => ({ ...prev, [s.id]: e.target.value }))}
                        placeholder="Optional feedback…"
                        aria-label={`Feedback for ${s.name}`}
                        rows={2}
                        style={{ width: 190, minWidth: 150, padding: '5px 7px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12, lineHeight: 1.45, background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    </td>
                    <td>
                      <div className="flex gap-1.5 items-center">
                        {hasLink && (
                          <button
                            className="btn btn-ghost btn-sm"
                            title="AI grading assistant"
                            onClick={() => { setAiFor(s.id); setAiText(''); setAiResult(null) }}
                          >
                            <Sparkles size={13} />
                          </button>
                        )}
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={saving[s.id] || inputVal === ''}
                          onClick={() => handleSaveScore(s)}
                        >
                          {saving[s.id] ? '…' : 'Save'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-ink3 mb-4">Scores are saved immediately. After saving, the student's grade components are updated automatically.</p>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap items-center">
        {isPast && (
          <button className="btn btn-ghost btn-sm" onClick={handleApplyDefault}>Apply Missed Grade (50)</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={handleExtend}>Extend Deadline</button>
        <button className="btn btn-ghost btn-sm" onClick={handleRemind} title="Notify enrolled students who haven't submitted">
          <AlarmClock size={16} /> Remind Missing
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onEdit}><Pencil size={16} /> Edit</button>
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>Close</button>
        <button className="btn btn-primary btn-sm" onClick={handleSaveAll} disabled={savingAll}>
          {savingAll ? 'Saving…' : <><Save size={16} /> Save All Grades</>}
        </button>
      </div>

      {aiFor && (() => {
        const stud = enrolledStudents.find(x => x.id === aiFor)
        const sub = (act.submissions || {})[aiFor] || {}
        return (
          <Modal onClose={() => setAiFor(null)} size="md">
            <h3 className="text-lg font-bold mb-1"><Sparkles size={16} className="inline-block mr-1 align-text-bottom" />AI Grading Assist</h3>
            <p className="modal-sub">{stud?.name} · {act.title}</p>
            <div style={{ fontSize: 12, color: 'var(--ink2)', background: 'var(--accent-l)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', margin: '8px 0 12px' }}>
              The AI can't open the student's link, so paste their work below (open the submission, copy the text). It suggests a score and feedback against your rubric, and you review and Save.
            </div>
            {sub.link && (
              <a href={sub.link} target="_blank" rel="noopener noreferrer" className="link-btn" style={{ fontSize: 12, marginBottom: 8, display: 'inline-block' }}>Open submission ↗</a>
            )}
            <textarea
              className="input w-full"
              rows={6}
              placeholder="Paste the student's submission text here…"
              value={aiText}
              onChange={e => setAiText(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <button className="btn btn-primary btn-sm" onClick={() => runAiGrade(aiFor)} disabled={aiBusy || !aiText.trim()}>
                <Sparkles size={13} className="inline-block mr-1" />{aiBusy ? 'Assessing…' : 'Suggest grade'}
              </button>
            </div>
            {aiResult && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  Suggested score: <span style={{ color: 'var(--accent)' }}>{aiResult.score} / {act.maxScore}</span>
                </div>
                {aiResult.feedback && <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, lineHeight: 1.6 }}>{aiResult.feedback}</div>}
                {hasRubric && aiResult.criteria?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {aiResult.criteria.map((c, i) => (
                      <div key={i} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: c.met ? 'var(--green)' : 'var(--ink3)', fontWeight: 700 }}>{c.met ? <Check size={14} /> : <X size={14} />}</span>{c.name}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <button className="btn btn-primary btn-sm" onClick={() => applyAiGrade(aiFor)}>Apply to score</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAiFor(null)}>Cancel</button>
                </div>
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setAiFor(null)}>Close</button>
            </div>
          </Modal>
        )
      })()}
    </Modal>
  )
}

// ── Main Tab ──────────────────────────────────────────────────────────
const PER_PAGE = 10

export default function ActivitiesTab() {
  const { activities, students, classes, fbReady } = useData()
  const [page,            setPage]           = useState(1)
  const [archivedPage,    setArchivedPage]   = useState(1)
  const [showCreate,      setShowCreate]     = useState(false)
  const [viewAct,         setViewAct]        = useState(null)
  const [editAct,         setEditAct]        = useState(null)
  const [showArchivedActs, setShowArchivedActs] = useState(false)

  const sorted = useMemo(
    () => [...activities].sort((a, b) => b.createdAt - a.createdAt),
    [activities]
  )

  const activeActs   = useMemo(() => sorted.filter(a => !classes.find(c => c.id === a.classId)?.archived), [sorted, classes])
  const archivedActs = useMemo(() => sorted.filter(a =>  classes.find(c => c.id === a.classId)?.archived), [sorted, classes])

  const slice = useMemo(
    () => activeActs.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    [activeActs, page]
  )

  const archivedSlice = useMemo(
    () => archivedActs.slice((archivedPage - 1) * PER_PAGE, archivedPage * PER_PAGE),
    [archivedActs, archivedPage]
  )

  if (!fbReady) return <SkeletonTable />

  const now = Date.now()

  function ActivityCard({ act, readOnly }) {
    const cls       = classes.find(c => c.id === act.classId)
    const subs      = students.filter(s => s.classId === act.classId && s.account?.registered)
    const isPast    = act.deadline < now
    const submitted = Object.values(act.submissions || {}).filter(s => s.link).length
    const graded    = Object.values(act.submissions || {}).filter(s => s.score != null).length
    const dlLabel   = new Date(act.deadline).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    return (
      <div className="card card-pad">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <strong style={{ fontSize: 14 }}>{act.title}</strong>
              <Badge variant={isPast ? 'red' : 'green'}>{isPast ? 'Closed' : 'Open'}</Badge>
              <Badge variant="blue">{act.subject}</Badge>
              {readOnly && <Badge variant="yellow">Archived</Badge>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
              {cls ? cls.name + ' ' + cls.section : '—'} · Max: {act.maxScore} pts
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>
              Deadline: {dlLabel} · {submitted}/{subs.length} submitted · {graded} graded
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button className="btn btn-ghost btn-sm" onClick={() => setViewAct(act)}>View</button>
            {!readOnly && <button className="btn btn-ghost btn-sm" onClick={() => setEditAct(act)}>Edit</button>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="sec-hdr mb-3">
        <div className="sec-title">Activities</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}><Plus size={16} /> New Activity</button>
      </div>

      {/* Active Activities */}
      {activeActs.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" style={{ fontSize: '2rem' }}>—</div>
          No activities posted yet. Click "New Activity" to get started.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 mb-3">
            {slice.map(act => <ActivityCard key={act.id} act={act} readOnly={false} />)}
          </div>
          <Pagination total={activeActs.length} perPage={PER_PAGE} page={page} onChange={setPage} />
        </>
      )}

      {/* Archived Activities Section */}
      {archivedActs.length > 0 && (
        <div className="mt-5">
          <button
            className="flex items-center gap-2 text-sm font-semibold mb-3"
            style={{ color: 'var(--amber, #d97706)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onClick={() => setShowArchivedActs(v => !v)}
          >
            {showArchivedActs ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            {showArchivedActs ? 'Hide' : 'Show'} Archived Class Activities ({archivedActs.length})
          </button>
          {showArchivedActs && (
            <>
              <div className="rounded-lg px-3 py-2 mb-3 text-sm font-medium"
                style={{ background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a' }}>
                <Archive size={13} className="inline-block mr-1 align-text-bottom" />
                These activities belong to archived classes and are read-only.
              </div>
              <div className="flex flex-col gap-3 mb-3">
                {archivedSlice.map(act => <ActivityCard key={act.id} act={act} readOnly={true} />)}
              </div>
              <Pagination total={archivedActs.length} perPage={PER_PAGE} page={archivedPage} onChange={setArchivedPage} />
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <ActivityFormModal onClose={() => setShowCreate(false)} />
      )}
      {editAct && (
        <ActivityFormModal
          act={editAct}
          onClose={() => setEditAct(null)}
        />
      )}
      {viewAct && (
        <ViewActivityModal
          act={activities.find(a => a.id === viewAct.id) || viewAct}
          onClose={() => setViewAct(null)}
          onEdit={() => { setEditAct(viewAct); setViewAct(null) }}
          onDelete={() => setViewAct(null)}
        />
      )}
    </div>
  )
}
