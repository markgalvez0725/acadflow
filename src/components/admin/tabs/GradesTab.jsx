import React, { useState, useMemo, useCallback, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import {
  gradeInfo, combineEquiv, computeTerms, scoredPercent, round2,
  getHeldDays, gradeInfoForStudent, getGradeScaleLabel,
} from '@/utils/grades'
import { exportMasterGradingReport } from '@/export/excelExport'
import { exportGradingSheet, parseGradingSheetImport, exportCurrentGrades } from '@/export/gradingSheet'
import { verifyGradeRows } from '@/utils/gradeImportVerifySmart'
import { makeHistoryEntry, appendGradeHistory, deriveQuizzes } from '@/utils/gradeEngine'
import { classTag, courseShort } from '@/utils/groupChat'
import { pushStudentNotif } from '@/firebase/studentNotif'
import Modal from '@/components/primitives/Modal'
import Pagination from '@/components/primitives/Pagination'
import KebabMenu from '@/components/primitives/KebabMenu'
import EmptyState from '@/components/ds/EmptyState'
import PageHeader from '@/components/ds/PageHeader'
import { Clock, Pencil, BarChart2, Upload, Download, Trash2, BarChart, RefreshCw, Archive, ArchiveRestore, FileSpreadsheet, Plus, ChevronDown, Sparkles, Undo2, Redo2, Check, Maximize2, AlertTriangle, Search, MessageSquare } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'

const GRADE_PER_PAGE = 10
const GRADE_IMPORT_PER_PAGE = 25

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v) {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function clamp(v) {
  return v !== null ? Math.min(100, Math.max(0, v)) : null
}

// ── Big numeric field used by the speed-grading view ──────────────────────────
function BigField({ label, value, onChange, accent }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4 }}>{label}</span>
      <input
        type="number" min="0" max="100" value={value} placeholder="-"
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', fontSize: 26, fontWeight: 700, textAlign: 'center', padding: '12px 8px',
          borderRadius: 10, border: '1px solid var(--border)',
          background: accent ? 'var(--accent-l)' : 'var(--surface)', color: 'var(--ink)',
        }}
      />
    </label>
  )
}

// ── GradeEntryModal ───────────────────────────────────────────────────────────
function GradeEntryModal({ classId, subject, onClose }) {
  const { students, classes, activities, quizzes, saveStudents, saveGradeNote, admin, eqScale, db, fbReady, logAudit } = useData()
  const { toast, openDialog } = useUI()

  const cls   = classes.find(c => c.id === classId)
  const studs = useMemo(() => sortByLastName(students.filter(s => s.classId === classId || s.classIds?.includes(classId))), [students, classId])

  // Panel activities for this class+subject
  const panelActs = useMemo(
    () => (activities || []).filter(a => a.classId === classId && a.subject === subject),
    [activities, classId, subject]
  )

  // Panel quizzes for this class+subject
  const panelQuizzes = useMemo(
    () => (quizzes || []).filter(q => q.classIds?.includes(classId) && q.subject === subject),
    [quizzes, classId, subject]
  )

  // Manual "+ column" extras the professor adds in-modal (beyond app/imported ones).
  const [manualActExtra, setManualActExtra] = useState(0)
  const [manualQzExtra,  setManualQzExtra]  = useState(0)

  // Unified activity columns, left→right: app activities (live, by id) OR manual
  // positional columns (a-keys), then any IMPORTED extra columns (x-keys) so
  // grades imported from Excel show as their own columns next to the app's, then
  // any in-modal "+ column" extras. Each carries { key, label, max, act? }.
  const actCols = useMemo(() => {
    const cols = []
    if (panelActs.length > 0) {
      panelActs.forEach((a, i) => cols.push({ key: a.id, label: a.title || `Activity ${i + 1}`, max: a.maxScore || 100, act: a }))
    } else {
      let n = 0
      studs.forEach(s => {
        const sc = s.gradeComponents?.[subject]?.activityScores || {}
        n = Math.max(n, Object.keys(sc).filter(k => /^a\d+$/.test(k)).length)
      })
      for (let i = 0; i < Math.max(n, 1); i++) cols.push({ key: `a${i + 1}`, label: `Activity ${i + 1}`, max: 100 })
    }
    const xset = new Set()
    studs.forEach(s => Object.keys(s.gradeComponents?.[subject]?.activityScores || {}).forEach(k => { if (/^x\d+$/.test(k)) xset.add(k) }))
    const xsorted = [...xset].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
    xsorted.forEach((k, i) => cols.push({ key: k, label: `Extra ${i + 1}`, max: 100 }))
    const xBase = xsorted.length
    for (let i = 0; i < manualActExtra; i++) cols.push({ key: `x${xBase + i + 1}`, label: `Extra ${xBase + i + 1}`, max: 100 })
    return cols
  }, [studs, subject, panelActs, manualActExtra])

  const qzCols = useMemo(() => {
    const cols = []
    if (panelQuizzes.length > 0) {
      panelQuizzes.forEach((q, i) => cols.push({ key: q.id, label: q.title || `Quiz ${i + 1}`, max: 100, quiz: q }))
    } else {
      let n = 0
      studs.forEach(s => {
        const sc = s.gradeComponents?.[subject]?.quizScores || {}
        n = Math.max(n, Object.keys(sc).filter(k => /^q\d+$/.test(k)).length)
      })
      for (let i = 0; i < Math.max(n, 1); i++) cols.push({ key: `q${i + 1}`, label: `Quiz ${i + 1}`, max: 100 })
    }
    const xset = new Set()
    studs.forEach(s => Object.keys(s.gradeComponents?.[subject]?.quizScores || {}).forEach(k => { if (/^xq\d+$/.test(k)) xset.add(k) }))
    const xsorted = [...xset].sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)))
    xsorted.forEach((k, i) => cols.push({ key: k, label: `Extra ${i + 1}`, max: 100 }))
    const xBase = xsorted.length
    for (let i = 0; i < manualQzExtra; i++) cols.push({ key: `xq${xBase + i + 1}`, label: `Extra ${xBase + i + 1}`, max: 100 })
    return cols
  }, [studs, subject, panelQuizzes, manualQzExtra])

  const actInputCount  = actCols.length
  const quizInputCount = qzCols.length

  // Activity average as a percentage: each input is normalized by its column's
  // maxScore (rubric activities may be out of ≠100; extras are out of 100).
  function actAvgFromInputs(actInputs) {
    const items = actInputs.map((v, i) => {
      const sc = toNum(v)
      return sc === null ? null : { score: sc, maxScore: actCols[i]?.max || 100 }
    }).filter(Boolean)
    return scoredPercent(items)
  }

  // Build initial row values from existing student data + activities panel
  const initRows = useMemo(() => {
    return studs.map(s => {
      const comp = s.gradeComponents?.[subject] || {}

      // Per-activity scores - one per unified column (app submission / stored key).
      const actInputs = actCols.map(c => {
        if (c.act) {
          const sc = (c.act.submissions || {})[s.id]?.score
          if (sc != null) return String(sc)
        }
        const v = comp.activityScores?.[c.key]
        return v != null ? String(v) : ''
      })

      // Compute activity avg from inputs (normalized by each activity's maxScore)
      const actAvg = round2(actAvgFromInputs(actInputs))

      // Per-quiz scores - one per unified column (app submission % / stored key).
      const qzScoresMap = comp.quizScores || {}
      const qzInputs = qzCols.map(c => {
        if (c.quiz) {
          const sub = (c.quiz.submissions || {})[s.id]
          // Prefer the stored effective percentage (already includes any cheat
          // deduction); fall back to raw score for older submissions.
          if (sub?.pct != null) return String(sub.pct)
          if (sub?.score != null) {
            const total = (sub.total ?? c.quiz.totalPoints ?? c.quiz.questions?.length) || 1
            return String(parseFloat(((sub.score / total) * 100).toFixed(1)))
          }
        }
        const v = qzScoresMap[c.key]
        return v != null ? String(v) : ''
      })
      const qzNums = qzInputs.map(v => toNum(v)).filter(v => v !== null)
      const qzAvg  = qzNums.length > 0
        ? parseFloat((qzNums.reduce((a, b) => a + b, 0) / qzNums.length).toFixed(2))
        : (typeof comp.quizzes === 'number' ? comp.quizzes : null)

      // Auto-compute attendance
      const attSet = s.attendance?.[subject] || new Set()
      const held   = getHeldDays(classId, subject, students)
      const attRate = held > 0 ? Math.min(100, parseFloat(((attSet.size / held) * 100).toFixed(2))) : null

      const mid = comp.midtermExam ?? ''
      const fin = comp.finalsExam  ?? ''

      // Compute current equiv preview
      const midTermN = comp.midterm ?? null
      const finTermN = comp.finals  ?? null
      const eqPreview = (midTermN != null && finTermN != null)
        ? combineEquiv(gradeInfo(midTermN, eqScale).eq, gradeInfo(finTermN, eqScale).eq).eq
        : gradeInfo(s.grades?.[subject] ?? null, eqScale).eq

      return {
        actInputs,   // per-activity score strings
        actAvg,      // computed avg of actInputs
        qzInputs,    // per-quiz score strings
        qzAvg,       // computed avg of qzInputs (fallback to stored quizzes avg)
        attitude: comp.attitude != null ? String(comp.attitude) : '',
        midtermExam: String(mid),
        finalsExam:  String(fin),
        finalGrade: s.grades?.[subject] != null ? String(s.grades[subject]) : '',
        attRate,
        held,
        attSize: attSet.size,
        equivPreview: eqPreview,
      }
    })
  }, [studs, subject, classId, actCols, qzCols, students, eqScale])

  const [rows, setRows] = useState(initRows)
  const [saving, setSaving] = useState(false)
  const [showFormula, setShowFormula] = useState(false)
  const [autoStatus, setAutoStatus] = useState('idle') // idle | saving | saved
  const [speedMode, setSpeedMode] = useState(false)
  const [speedIdx, setSpeedIdx]   = useState(0)
  const [pasteOpen, setPasteOpen]   = useState(false)
  const [pasteField, setPasteField] = useState('midtermExam')
  const [pasteText, setPasteText]   = useState('')

  // Per-student grade note editor. `noteFor` holds the student being annotated
  // (or null when closed); the note rides its own write path (saveGradeNote),
  // independent of the rows/grades pipeline, so it never perturbs grade saves.
  const [noteFor, setNoteFor]   = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const openNote = (stu) => { setNoteFor(stu); setNoteDraft(stu.gradeNotes?.[subject]?.text || '') }
  const saveNote = async () => {
    if (!noteFor) return
    setNoteSaving(true)
    try { await saveGradeNote(noteFor.id, subject, noteDraft, admin?.name) }
    finally { setNoteSaving(false); setNoteFor(null) }
  }

  // Undo/redo history + debounced auto-save. undoRef/redoRef hold rows snapshots;
  // travelRef suppresses history capture while applying an undo/redo; the rows
  // watcher effect (below the handlers) records history and schedules auto-save.
  const undoRef   = useRef([])
  const redoRef   = useRef([])
  const rowsRef   = useRef(rows)
  const travelRef = useRef(false)   // set during undo/redo: skip history capture
  const resyncRef = useRef(false)   // set during panel re-sync: skip history + auto-save
  const firstRowsRef = useRef(true)
  const dirtyRef  = useRef(false)
  const dirtyIdsRef = useRef(new Set())   // student ids actually edited this session
  const savingInFlightRef = useRef(false) // guards against overlapping autosaves
  const autoTimerRef = useRef(null)
  const autoSaveRef  = useRef(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const syncHist = useCallback(() => {
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(redoRef.current.length > 0)
  }, [])

  // Re-sync rows when panel activities or quizzes load/change after initial render
  const prevActKeyRef = React.useRef('')
  const prevQzKeyRef  = React.useRef('')
  React.useEffect(() => {
    // Build stable keys from ids + submission counts so we detect any data change
    const actKey = panelActs.map(a => a.id + ':' + Object.keys(a.submissions || {}).length).join(',')
    const qzKey  = panelQuizzes.map(q => q.id + ':' + Object.keys(q.submissions || {}).length).join(',')
    if (actKey !== prevActKeyRef.current || qzKey !== prevQzKeyRef.current) {
      prevActKeyRef.current = actKey
      prevQzKeyRef.current  = qzKey
      resyncRef.current = true // programmatic reload - not a user edit
      setRows(initRows)
    }
  }, [panelActs, panelQuizzes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Last upload timestamp for this subject
  const uploadTs = useMemo(() =>
    studs.map(s => s.gradeUploadedAt?.[subject]).filter(Boolean).sort().pop()
  , [studs, subject])

  // Recompute actAvg and qzAvg from individual inputs, then recompute final grade
  // Uses combineEquiv (school lookup table) for correct equivalency - not just gradeInfo on raw %
  function recomputeRow(r) {
    // Full-precision component percentages (activities normalized by maxScore).
    const actAvg = actAvgFromInputs(r.actInputs)
    const qzNums = r.qzInputs.map(v => toNum(v)).filter(v => v !== null)
    const qzAvg  = qzNums.length ? qzNums.reduce((a, b) => a + b, 0) / qzNums.length : null

    // One canonical computation (intermediates full precision; final rounded).
    const { midterm, finals, final } = computeTerms({
      activities:  actAvg,
      quizzes:     qzAvg,
      attendance:  r.attRate,
      attitude:    toNum(r.attitude),
      midtermExam: toNum(r.midtermExam),
      finalsExam:  toNum(r.finalsExam),
    })

    let fg = r.finalGrade
    let equivPreview = '-'

    if (midterm !== null || finals !== null) {
      if (final !== null) fg = String(final)
      // Equivalency via the school combine table on the term equivalents.
      const midEq = midterm !== null ? gradeInfo(midterm, eqScale).eq : null
      const finEq = finals  !== null ? gradeInfo(finals,  eqScale).eq : null
      if (midEq && finEq)  equivPreview = combineEquiv(midEq, finEq).eq
      else if (midEq)       equivPreview = midEq
      else if (finEq)       equivPreview = finEq
    } else {
      const fgN = toNum(fg)
      if (fgN !== null) equivPreview = gradeInfo(fgN, eqScale).eq
    }

    // actAvg/qzAvg are display values → rounded; computation above used full precision.
    return { ...r, actAvg: round2(actAvg), qzAvg: round2(qzAvg), finalGrade: fg, equivPreview }
  }

  const clampGrade = val => {
    if (val === '' || val === null || val === undefined) return val
    const n = parseFloat(val)
    if (isNaN(n)) return val
    return String(Math.min(100, Math.max(0, n)))
  }

  // Record which student a row edit touched, so autosave writes ONLY changed
  // students instead of re-uploading the whole roster on every keystroke.
  const markRowDirty = (i) => { const id = studs[i]?.id; if (id) dirtyIdsRef.current.add(id) }
  const markAllDirty = () => { studs.forEach(s => dirtyIdsRef.current.add(s.id)) }

  // Update an activity input by index
  const updateActInput = useCallback((rowIdx, actIdx, val) => {
    markRowDirty(rowIdx)
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r
      const actInputs = r.actInputs.map((v, j) => j === actIdx ? clampGrade(val) : v)
      return recomputeRow({ ...r, actInputs })
    }))
  }, [eqScale]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update a quiz input by index
  const updateQzInput = useCallback((rowIdx, qzIdx, val) => {
    markRowDirty(rowIdx)
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r
      const qzInputs = r.qzInputs.map((v, j) => j === qzIdx ? clampGrade(val) : v)
      return recomputeRow({ ...r, qzInputs })
    }))
  }, [eqScale]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live recompute row equiv
  const updateRow = useCallback((i, field, val) => {
    markRowDirty(i)
    setRows(prev => prev.map((r, idx) => {
      if (idx !== i) return r
      return recomputeRow({ ...r, [field]: clampGrade(val) })
    }))
  }, [eqScale]) // eslint-disable-line react-hooks/exhaustive-deps

  // When finalGrade is manually edited, just update equiv
  const updateFinalGrade = useCallback((i, val) => {
    markRowDirty(i)
    setRows(prev => prev.map((r, idx) => {
      if (idx !== i) return r
      const clamped = clampGrade(val)
      const fgN = toNum(clamped)
      return { ...r, finalGrade: clamped, equivPreview: gradeInfo(fgN, eqScale).eq }
    }))
  }, [eqScale])

  // Add an extra activity column (manual mode only - when no panel activities).
  // A new column changes every row, so mark all students dirty.
  function addActColumn() {
    markAllDirty()
    setManualActExtra(n => n + 1)
    setRows(prev => prev.map(r => recomputeRow({ ...r, actInputs: [...r.actInputs, ''] })))
  }

  // Add an extra quiz column (manual mode only - when no panel quizzes)
  function addQzColumn() {
    markAllDirty()
    setManualQzExtra(n => n + 1)
    setRows(prev => prev.map(r => recomputeRow({ ...r, qzInputs: [...r.qzInputs, ''] })))
  }

  // Build the updated students array from the current rows (pure - reused by
  // both the manual Save and the debounced auto-save).
  function buildUpdatedStudents(recordHistory = false) {
    const now = Date.now()
    return students.map(s => {
      const si = studs.findIndex(x => x.id === s.id)
      if (si === -1) return s

      const r    = rows[si]
      const ns   = { ...s, grades: { ...s.grades }, gradeComponents: { ...(s.gradeComponents || {}) }, gradeUploadedAt: { ...(s.gradeUploadedAt || {}) } }
      const comp = { ...(ns.gradeComponents[subject] || {}) }

      // Recompute component percentages at full precision from the row inputs
      // (activities normalized by each activity's maxScore).
      const actPct    = actAvgFromInputs(r.actInputs)
      const qzNums    = r.qzInputs.map(v => toNum(v)).filter(v => v !== null)
      const qzPct     = qzNums.length ? qzNums.reduce((a, b) => a + b, 0) / qzNums.length : null
      const attitudeV = clamp(toNum(r.attitude))
      const midExamV  = clamp(toNum(r.midtermExam))
      const finExamV  = clamp(toNum(r.finalsExam))
      const attV      = r.attRate

      // Persist component percentages (rounded for clean display/storage).
      if (actPct    != null) comp.activities  = clamp(round2(actPct))
      if (qzPct     != null) comp.quizzes     = clamp(round2(qzPct))
      if (attitudeV != null) comp.attitude    = attitudeV
      if (midExamV  != null) comp.midtermExam = midExamV
      if (finExamV  != null) comp.finalsExam  = finExamV

      // Canonical computation - CS includes Attitude; intermediates full precision.
      const { cs, midterm, finals, final } = computeTerms({
        activities: actPct, quizzes: qzPct, attendance: attV,
        attitude: attitudeV, midtermExam: midExamV, finalsExam: finExamV,
      })
      if (midExamV !== null) { comp.midtermCS = round2(cs); comp.midterm = round2(midterm) }
      if (finExamV !== null) { comp.finalsCS  = round2(cs); comp.finals  = round2(finals) }

      // Sync per-column scores by their stable key (panel id / a-key / x-extra),
      // so app, manual, and imported columns all round-trip.
      const actScoresMap = {}
      actCols.forEach((c, idx) => {
        const sc = toNum(r.actInputs[idx])
        if (sc != null) actScoresMap[c.key] = sc
      })
      if (Object.keys(actScoresMap).length) comp.activityScores = actScoresMap
      else delete comp.activityScores

      const qzMap = {}
      qzCols.forEach((c, idx) => {
        const sc = toNum(r.qzInputs[idx])
        if (sc != null) qzMap[c.key] = sc
      })
      if (Object.keys(qzMap).length) comp.quizScores = qzMap
      else delete comp.quizScores

      // Final Grade % = avg(Midterm Term, Finals Term) - full precision, rounded once.
      const finalGrade = (comp.midterm != null || comp.finals != null) ? final : null

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

      // Append a publish-history entry on explicit Save (not on every autosave,
      // which would flood the timeline with intermediate typing states).
      if (recordHistory && val !== null) {
        const entry = makeHistoryEntry(
          { activities: actPct, quizzes: qzPct, attendance: attV, attitude: attitudeV },
          { midterm: comp.midterm ?? null, finals: comp.finals ?? null, final: val },
          'published', now,
        )
        ns.gradeHistory = appendGradeHistory(ns.gradeHistory, subject, entry)
      }

      return ns
    })
  }

  // Manual save - persists, audits, notifies students, then closes the modal.
  async function handleSave() {
    setSaving(true)
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null }
    const updatedStudents = buildUpdatedStudents(true)
    // Only the students actually edited this session (full roster as a fallback
    // when nothing was tracked, e.g. right after a bulk import).
    const changedIds = dirtyIdsRef.current.size ? [...dirtyIdsRef.current] : studs.map(s => s.id)
    const changedSet = new Set(changedIds)
    try {
      await saveStudents(updatedStudents, changedIds)
      dirtyIdsRef.current = new Set()
      dirtyRef.current = false
      setAutoStatus('saved')
      logAudit?.({
        action: 'grade.edit',
        target: `${cls?.name || subject} · ${subject}`,
        summary: `Saved grades for ${subject} (${changedIds.length} student${changedIds.length === 1 ? '' : 's'})`,
        meta: { subject, classId: cls?.id || null, students: changedIds.length },
      })
      toast('Grades saved!', 'green')
      // Notify each student whose grade was saved
      if (fbReady && db.current) {
        const clsName = cls?.name || subject
        for (const s of studs) {
          if (!changedSet.has(s.id)) continue   // don't re-notify unchanged students
          const si = updatedStudents.findIndex(x => x.id === s.id)
          const grade = si !== -1 ? updatedStudents[si].grades?.[subject] : null
          if (grade != null) {
            pushStudentNotif(
              db.current, s.id,
              `Grade posted for ${subject}`,
              `${clsName} - Final Grade: ${grade.toFixed(1)}`,
              'act_grade', 'grades'
            )
          }
        }
      }
      onClose()
    } catch (e) {
      toast('Saved locally - Firebase sync failed: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  // Debounced auto-save - quietly persists edits (no audit/notification spam);
  // kept in a ref so the debounce timer always calls the latest closure.
  autoSaveRef.current = async () => {
    if (!dirtyRef.current || saving || savingInFlightRef.current) return
    // Per-cell edits tracked their own student ids, so write ONLY those instead
    // of re-uploading the whole roster on every keystroke. Bulk paths (e.g. a
    // grade import) flag dirtyRef but don't enumerate ids, so fall back to the
    // full roster there to stay correct.
    const ids = dirtyIdsRef.current.size ? [...dirtyIdsRef.current] : studs.map(s => s.id)
    savingInFlightRef.current = true
    setAutoStatus('saving')
    try {
      await saveStudents(buildUpdatedStudents(), ids)
      dirtyIdsRef.current = new Set()
      dirtyRef.current = false
      setAutoStatus('saved')
    } catch (e) {
      setAutoStatus('idle')   // keep dirty ids so the next change retries them
    } finally {
      savingInFlightRef.current = false
    }
  }

  // Undo / redo over rows snapshots.
  const undo = useCallback(() => {
    if (!undoRef.current.length) return
    const prev = undoRef.current.pop()
    redoRef.current.push(rowsRef.current)
    travelRef.current = true
    setRows(prev)
    syncHist()
  }, [syncHist])
  const redo = useCallback(() => {
    if (!redoRef.current.length) return
    const next = redoRef.current.pop()
    undoRef.current.push(rowsRef.current)
    travelRef.current = true
    setRows(next)
    syncHist()
  }, [syncHist])

  // Rows watcher: record undo history (skipping programmatic resync/undo) and
  // schedule a debounced auto-save.
  React.useEffect(() => {
    if (firstRowsRef.current) { firstRowsRef.current = false; rowsRef.current = rows; return }
    if (resyncRef.current) { resyncRef.current = false; rowsRef.current = rows; return }
    if (travelRef.current) {
      travelRef.current = false
    } else if (rows !== rowsRef.current) {
      undoRef.current.push(rowsRef.current)
      if (undoRef.current.length > 60) undoRef.current.shift()
      redoRef.current = []
      syncHist()
    }
    rowsRef.current = rows
    dirtyRef.current = true
    setAutoStatus('idle')
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    autoTimerRef.current = setTimeout(() => { autoSaveRef.current && autoSaveRef.current() }, 2000)
  }, [rows, syncHist])

  // Flush any pending edits on modal close or tab-hide, so closing within the 2s
  // debounce window never loses work. Mount-once (refs are stable; autoSaveRef
  // always holds the latest closure), so it fires only on true unmount/hide.
  React.useEffect(() => {
    const flush = () => { if (dirtyRef.current && autoSaveRef.current) autoSaveRef.current() }
    const onHide = () => { if (document.hidden) flush() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
      flush()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard undo/redo + clear the auto-save timer on unmount.
  React.useEffect(() => {
    const onKey = (e) => {
      const z = (e.key === 'z' || e.key === 'Z')
      if ((e.metaKey || e.ctrlKey) && z) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    }
  }, [undo, redo])

  // ── Fast grade entry: keyboard grid nav ─────────────────────────────────────
  // Editable columns per row, left→right: activity inputs (0..actInputCount-1),
  // quiz inputs (next quizInputCount), then attitude, midtermExam, finalsExam,
  // finalGrade. Each input carries data-cell="row-col" so Enter / ArrowDown move
  // to the same column of the next student (and ArrowUp to the previous).
  const gridRef = useRef(null)
  const colAttitude = actInputCount + quizInputCount
  const focusCell = useCallback((r, c) => {
    const el = gridRef.current?.querySelector(`input[data-cell="${r}-${c}"]`)
    if (el) {
      el.focus()
      try { el.select() } catch (_) { /* number inputs may not support select */ }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [])
  const onGridKey = useCallback((e) => {
    const t = e.target
    if (!t || t.tagName !== 'INPUT' || !t.dataset.cell) return
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const [r, c] = t.dataset.cell.split('-').map(Number)
    // ArrowDown/Up on a number input would otherwise nudge its value - block that.
    e.preventDefault()
    const nr = e.key === 'ArrowUp' ? Math.max(0, r - 1) : Math.min(studs.length - 1, r + 1)
    focusCell(nr, c)
  }, [studs.length, focusCell])

  // ── Search-as-you-type: jump focus to the first matching student row ────────
  const [jumpQ, setJumpQ] = useState('')
  const jumpIdx = useMemo(() => {
    const q = jumpQ.trim().toLowerCase()
    if (!q) return -1
    return studs.findIndex(s => (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q))
  }, [jumpQ, studs])
  const doJump = useCallback(() => { if (jumpIdx >= 0) focusCell(jumpIdx, 0) }, [jumpIdx, focusCell])

  // ── Missing / invalid grade detector - pure validation over current rows ────
  const validation = useMemo(() => {
    const badNum = v => {
      if (v === '' || v === null || v === undefined) return false
      const n = parseFloat(v)
      return isNaN(n) || n < 0 || n > 100
    }
    let missing = 0, invalid = 0
    const rowFlags = rows.map(r => {
      if (!r) return { missing: false, invalid: false }
      const vals = [...r.actInputs, ...r.qzInputs, r.attitude, r.midtermExam, r.finalsExam, r.finalGrade]
      const isInvalid = vals.some(badNum)
      const isMissing = String(r.finalGrade).trim() === '' && toNum(r.midtermExam) === null && toNum(r.finalsExam) === null
      if (isInvalid) invalid++
      if (isMissing) missing++
      return { missing: isMissing, invalid: isInvalid }
    })
    return { missing, invalid, rowFlags }
  }, [rows])

  // ── CSV / paste-in ──────────────────────────────────────────────────────────
  // Paste two columns ("id-or-name <tab|comma|2+ spaces> score" per line) and
  // map them onto a chosen field; or import a full grading-sheet XLSX.
  const pastePreview = useMemo(() => {
    const idx = studs.map(s => ({ id: String(s.id).toLowerCase(), name: String(s.name || '').toLowerCase() }))
    const out = []
    let matched = 0
    pasteText.split(/\r?\n/).forEach(line => {
      const t = line.trim()
      if (!t) return
      const parts = t.split(/\t|,|\s{2,}/).map(x => x.trim()).filter(Boolean)
      if (parts.length < 2) return
      const n = parseFloat(parts[parts.length - 1])
      if (isNaN(n)) return
      const key = parts.slice(0, parts.length - 1).join(' ').toLowerCase()
      const mi = idx.findIndex(s => s.id === key || (key.length >= 3 && s.name.includes(key)))
      out.push({ key, score: n, idx: mi })
      if (mi >= 0) matched++
    })
    return { rows: out, matched, total: out.length }
  }, [pasteText, studs])

  function applyPaste() {
    const setField = (r, val) => {
      if (pasteField === 'finalGrade') {
        const clamped = clampGrade(String(val))
        return { ...r, finalGrade: clamped, equivPreview: gradeInfo(toNum(clamped), eqScale).eq }
      }
      return recomputeRow({ ...r, [pasteField]: clampGrade(String(val)) })
    }
    const byIdx = {}
    pastePreview.rows.forEach(p => { if (p.idx >= 0) byIdx[p.idx] = p.score })
    setRows(prev => prev.map((r, i) => (byIdx[i] != null ? setField(r, byIdx[i]) : r)))
    toast(`Applied ${pastePreview.matched} score${pastePreview.matched === 1 ? '' : 's'}.`, 'green')
    setPasteOpen(false); setPasteText('')
  }

  async function applyExcelFile(file) {
    try {
      const XLSX = window.XLSX
      if (!XLSX) { toast('SheetJS not loaded.', 'red'); return }
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const records = parseGradingSheetImport(wb)
      const recById = {}
      records.forEach(rec => { recById[String(rec.studentId).toLowerCase()] = rec })

      // Widen the grid if the file carries more activity/quiz columns than are
      // currently shown (e.g. "+ Activity" extras) so none are silently dropped.
      const lastFilled = key => records.reduce((m, rec) => {
        const arr = rec[key] || []
        let last = 0
        arr.forEach((v, i) => { if (v != null) last = i + 1 })
        return Math.max(m, last)
      }, 0)
      const needAct = lastFilled('actScores')
      const needQz  = lastFilled('qzScores')
      const growAct = Math.max(0, needAct - actInputCount)
      const growQz  = Math.max(0, needQz - quizInputCount)
      if (growAct) setManualActExtra(n => n + growAct)
      if (growQz)  setManualQzExtra(n => n + growQz)

      let matched = 0
      setRows(prev => prev.map((r, i) => {
        const rec = recById[String(studs[i].id).toLowerCase()]
        if (!rec) return r
        matched++
        const nr = { ...r }
        if (Array.isArray(rec.actScores) && rec.actScores.length) {
          const base = r.actInputs.slice()
          while (base.length < needAct) base.push('')
          nr.actInputs = base.map((v, idx) => (rec.actScores[idx] != null ? String(rec.actScores[idx]) : v))
        }
        if (Array.isArray(rec.qzScores) && rec.qzScores.length) {
          const base = r.qzInputs.slice()
          while (base.length < needQz) base.push('')
          nr.qzInputs = base.map((v, idx) => (rec.qzScores[idx] != null ? String(rec.qzScores[idx]) : v))
        }
        if (rec.attitude != null) nr.attitude = String(rec.attitude)
        if (rec.mtExam != null) nr.midtermExam = String(rec.mtExam)
        if (rec.ftExam != null) nr.finalsExam = String(rec.ftExam)
        return recomputeRow(nr)
      }))
      toast(`Imported scores for ${matched} student${matched === 1 ? '' : 's'}.`, 'green')
      setPasteOpen(false)
    } catch (e) {
      toast('Import failed: ' + e.message, 'red')
    }
  }

  return (
    <>
    <Modal onClose={onClose} wide sheetOnMobile icon={<Pencil size={18} />} title="Edit Grades"
      subtitle={<>Subject: <strong>{subject}</strong> · <span title={cls?.name || ''}>{courseShort(cls?.name)}</span> {cls?.section}</>}
    >
      <div className="text-xs text-ink2 mb-3" style={{ textAlign: 'right' }}>
        {uploadTs
          ? <><Upload size={12} className="inline-block mr-1 align-text-bottom" />Last uploaded: <strong>{new Date(uploadTs).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</strong></>
          : <span className="text-ink3">Not yet uploaded</span>}
      </div>

      {/* Auto-first guide */}
      <div className="mb-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--accent-l)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Sparkles size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>
            <strong>You only fill in Attitude, Midterm Exam, and Finals Exam.</strong> Activities, Quizzes, and Attendance are calculated automatically from their tabs. The Final Grade fills in for you, and you can type over it to override.
          </span>
        </div>
        {(panelActs.length === 0 || panelQuizzes.length === 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {panelActs.length === 0 && (
              <button className="btn btn-ghost btn-sm" onClick={addActColumn}><Plus size={13} className="inline-block mr-1" />Add Activity Column</button>
            )}
            {panelQuizzes.length === 0 && (
              <button className="btn btn-ghost btn-sm" onClick={addQzColumn}><Plus size={13} className="inline-block mr-1" />Add Quiz Column</button>
            )}
            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>Manual columns - only needed if you are not using the Activities / Quiz tabs.</span>
          </div>
        )}
      </div>

      {/* Fast-entry toolbar: jump-to-student + validation summary */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div style={{ position: 'relative', minWidth: 220 }}>
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Jump to student… (name or ID)"
            value={jumpQ}
            onChange={e => setJumpQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doJump() } }}
          />
          {jumpQ.trim() !== '' && (
            <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: jumpIdx >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {jumpIdx >= 0 ? 'Enter ↵' : 'no match'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button className="btn btn-ghost btn-sm" onClick={() => setPasteOpen(true)} title="Paste a column of scores or import a grading-sheet Excel file" style={{ padding: '4px 10px' }}><FileSpreadsheet size={13} className="inline-block mr-1 align-text-bottom" />Import</button>
          <button className={`btn btn-sm ${speedMode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSpeedMode(v => !v)} title="Speed-grading mode - one student at a time" style={{ padding: '4px 10px' }}><Maximize2 size={13} className="inline-block mr-1 align-text-bottom" />Speed</button>
          <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)" style={{ padding: '4px 8px' }}><Undo2 size={14} /></button>
          <button className="btn btn-ghost btn-sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" style={{ padding: '4px 8px' }}><Redo2 size={14} /></button>
          <span style={{ minWidth: 64, color: 'var(--ink3)' }}>
            {autoStatus === 'saving' ? 'Saving…' : autoStatus === 'saved' ? <><Check size={12} className="inline-block align-text-bottom" style={{ color: 'var(--green)' }} /> Saved</> : ''}
          </span>
          {validation.invalid > 0 && (
            <span className="badge badge-red" title="Values outside 0-100">{validation.invalid} invalid</span>
          )}
          {validation.missing > 0 && (
            <span className="badge badge-yellow" title="No exam scores and no final grade yet">{validation.missing} no grade</span>
          )}
          {validation.invalid === 0 && validation.missing === 0 && (
            <span className="badge badge-green">All entered</span>
          )}
        </div>
      </div>

      {/* Speed-grading view - one student at a time, big inputs */}
      {speedMode && (() => {
        const i = Math.min(speedIdx, studs.length - 1)
        const s = studs[i]; const r = rows[i]
        if (!s || !r) return null
        const go = d => setSpeedIdx(p => Math.max(0, Math.min(studs.length - 1, p + d)))
        const nextUngraded = () => {
          for (let k = i + 1; k < studs.length; k++) { if (validation.rowFlags[k]?.missing) { setSpeedIdx(k); return } }
          for (let k = 0; k <= i; k++) { if (validation.rowFlags[k]?.missing) { setSpeedIdx(k); return } }
          toast('No students without a grade.', 'green')
        }
        return (
          <div style={{ padding: '4px 4px 8px', minHeight: 320 }}>
            <div className="flex items-center justify-between mb-3">
              <button className="btn btn-ghost" onClick={() => go(-1)} disabled={i === 0}>← Prev</button>
              <div className="text-center">
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{s.name}</div>
                <div className="text-xs text-ink2">{s.id} · Student {i + 1} of {studs.length}</div>
              </div>
              <button className="btn btn-ghost" onClick={() => go(1)} disabled={i === studs.length - 1}>Next →</button>
            </div>

            <div className="flex items-center justify-center gap-2 flex-wrap mb-4 text-xs">
              <span className="badge badge-green" title="Activity average (auto)">Act {r.actAvg ?? '-'}</span>
              <span className="badge badge-gray" title="Quiz average (auto)">Quiz {r.qzAvg ?? '-'}</span>
              <span className="badge badge-blue" title="Attendance (auto)">Att {r.attRate != null ? `${r.attRate.toFixed(0)}%` : '-'}</span>
              <span className="badge badge-gray" title="Equivalent">Equiv {r.equivPreview}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, maxWidth: 560, margin: '0 auto' }}>
              <BigField label="Attitude" value={r.attitude} onChange={v => updateRow(i, 'attitude', v)} />
              <BigField label="Midterm Exam" value={r.midtermExam} onChange={v => updateRow(i, 'midtermExam', v)} />
              <BigField label="Finals Exam" value={r.finalsExam} onChange={v => updateRow(i, 'finalsExam', v)} />
              <BigField label="Final Grade" value={r.finalGrade} onChange={v => updateFinalGrade(i, v)} accent />
            </div>

            {(r.actInputs.length > 0 || r.qzInputs.length > 0) && (
              <div style={{ maxWidth: 560, margin: '14px auto 0' }}>
                <div className="text-xs text-ink3 mb-1">Individual scores</div>
                <div className="flex flex-wrap gap-2">
                  {r.actInputs.map((val, ai) => (
                    <label key={`a${ai}`} className="text-xs" style={{ width: 84 }}>
                      <span className="text-ink3" title={actCols[ai]?.label || `Activity ${ai + 1}`}>{(actCols[ai]?.label || `Act ${ai + 1}`).slice(0, 8)}</span>
                      <input className="grade-input" type="number" min="0" max="100" value={val} placeholder="-" onChange={e => updateActInput(i, ai, e.target.value)} />
                    </label>
                  ))}
                  {r.qzInputs.map((val, qi) => (
                    <label key={`q${qi}`} className="text-xs" style={{ width: 84 }}>
                      <span className="text-ink3" title={qzCols[qi]?.label || `Quiz ${qi + 1}`}>{(qzCols[qi]?.label || `Quiz ${qi + 1}`).slice(0, 8)}</span>
                      <input className="grade-input" type="number" min="0" max="100" value={val} placeholder="-" onChange={e => updateQzInput(i, qi, e.target.value)} />
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 mt-5">
              <button className="btn btn-ghost btn-sm" onClick={nextUngraded}>Next ungraded →</button>
            </div>
          </div>
        )
      })()}

      <div className="overflow-x-auto" ref={gridRef} onKeyDown={onGridKey} style={{ display: speedMode ? 'none' : undefined }}>
        <table className="tbl" style={{ minWidth: 900 }}>
          <thead>
            {/* Row 1: group headers */}
            <tr>
              <th rowSpan={2} style={{ verticalAlign: 'bottom', position: 'sticky', left: 0, zIndex: 3, background: 'var(--surface)', boxShadow: '2px 0 4px -1px var(--border)' }}>Student</th>
              <th colSpan={actInputCount} className="text-center" style={{ borderBottom: '1px solid var(--border)' }}>
                Activities<br /><small className="font-normal text-ink3">{panelActs.length > 0 ? 'auto · Activities tab' : 'manual'}</small>
              </th>
              <th rowSpan={2} title="Activities average - computed from individual scores">
                Act Avg<br /><small className="font-normal text-ink3">auto</small>
              </th>
              <th colSpan={quizInputCount} className="text-center" style={{ borderBottom: '1px solid var(--border)' }}>
                Quizzes<br /><small className="font-normal text-ink3">{panelQuizzes.length > 0 ? 'auto · Quiz tab' : 'manual'}</small>
              </th>
              <th rowSpan={2} title="Quizzes average - computed from individual scores">
                Quiz Avg<br /><small className="font-normal text-ink3">auto</small>
              </th>
              <th rowSpan={2} title="Attitude/Character grade - entered manually by professor" style={{ background: 'var(--yellow-l)' }}>
                Attitude<br /><small className="font-normal" style={{ color: 'var(--gold-var)' }}>you enter</small>
              </th>
              <th rowSpan={2} title="Attendance % - auto from records">
                Attendance<br /><small className="font-normal text-ink3">auto · Attendance tab</small>
              </th>
              <th rowSpan={2} title="Midterm Exam score - combined with CS Midterm to get Midterm Term grade" style={{ background: 'var(--yellow-l)' }}>
                Midterm Exam<br /><small className="font-normal" style={{ color: 'var(--gold-var)' }}>you enter</small>
              </th>
              <th rowSpan={2} title="Finals Exam score - combined with CS Finals to get Finals Term grade" style={{ background: 'var(--yellow-l)' }}>
                Finals Exam<br /><small className="font-normal" style={{ color: 'var(--gold-var)' }}>you enter</small>
              </th>
              <th rowSpan={2} style={{ background: 'var(--accent-l)' }}>
                Final Grade<br /><small className="font-normal" style={{ color: 'var(--accent)' }}>auto/manual</small>
              </th>
              <th rowSpan={2}>Equiv.</th>
              <th rowSpan={2} title="Leave a private note for this student about their grade">
                Note<br /><small className="font-normal text-ink3">to student</small>
              </th>
            </tr>
            {/* Row 2: individual activity and quiz columns */}
            <tr>
              {actCols.map((c, i) => (
                <th key={c.key || i} title={c.label}>
                  {c.label.length > 10 ? c.label.slice(0, 10) + '…' : c.label}
                </th>
              ))}
              {qzCols.map((c, i) => (
                <th key={c.key || i} title={c.label}>
                  {c.label.length > 10 ? c.label.slice(0, 10) + '…' : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {studs.map((s, i) => {
              const r = rows[i]
              if (!r) return null
              const vf = validation.rowFlags[i] || {}
              const attColor = r.attRate !== null
                ? (r.attRate >= 90 ? 'var(--green)' : r.attRate >= 75 ? 'var(--yellow)' : 'var(--red)')
                : 'var(--ink3)'
              const flagBorder = vf.invalid ? 'var(--red)' : vf.missing ? 'var(--yellow)' : 'transparent'

              return (
                <tr key={s.id}>
                  <td style={{ minWidth: 160, position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface)', boxShadow: '2px 0 4px -1px var(--border)', borderLeft: `3px solid ${flagBorder}` }}>
                    <strong>{s.name}</strong>
                    {vf.invalid && <span className="badge badge-red ml-1" style={{ fontSize: 9, padding: '0 4px' }} title="Has a value outside 0-100">!</span>}
                    {!vf.invalid && vf.missing && <span className="badge badge-yellow ml-1" style={{ fontSize: 9, padding: '0 4px' }} title="No grade entered yet">-</span>}
                    <br />
                    <small className="text-ink2">{s.id}</small>
                  </td>
                  {/* Per-activity inputs */}
                  {r.actInputs.map((val, ai) => (
                    <td key={ai}>
                      <input className="grade-input" type="number" min="0" max="100"
                        data-cell={`${i}-${ai}`}
                        value={val} placeholder="-"
                        title={actCols[ai]?.label || `Activity ${ai + 1}`}
                        onChange={e => updateActInput(i, ai, e.target.value)} />
                    </td>
                  ))}
                  {/* Act avg (read-only) */}
                  <td>
                    <div className="px-2 py-1.5 rounded-md text-sm font-bold text-center"
                      style={{ background: 'var(--green-l)', color: 'var(--green)' }}>
                      {r.actAvg ?? '-'}
                    </div>
                  </td>
                  {/* Per-quiz inputs */}
                  {r.qzInputs.map((val, qi) => (
                    <td key={qi}>
                      <input className="grade-input" type="number" min="0" max="100"
                        data-cell={`${i}-${actInputCount + qi}`}
                        value={val} placeholder="-"
                        title={qzCols[qi]?.label || `Quiz ${qi + 1}`}
                        onChange={e => updateQzInput(i, qi, e.target.value)} />
                    </td>
                  ))}
                  {/* Quiz avg (read-only) */}
                  <td>
                    <div className="px-2 py-1.5 rounded-md text-sm font-bold text-center"
                      style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
                      {r.qzAvg ?? '-'}
                    </div>
                  </td>
                  {/* Attitude / Character input */}
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      data-cell={`${i}-${colAttitude}`}
                      value={r.attitude} placeholder="0-100"
                      title="Attitude/Character grade (included in Class Standing)"
                      style={{ background: 'var(--purple-l, #ede9fe)' }}
                      onChange={e => updateRow(i, 'attitude', e.target.value)} />
                  </td>
                  <td>
                    <div className="px-2 py-1.5 rounded-md text-sm font-semibold"
                      style={{ background: 'var(--bg)', color: attColor }}
                      title={`Auto-computed from attendance records (${r.attSize}/${r.held} days)`}>
                      {r.attRate !== null ? `${r.attRate.toFixed(1)}%` : '-'}
                      <br /><small className="text-xs font-normal text-ink3">{r.attSize}/{r.held} days</small>
                    </div>
                  </td>
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      data-cell={`${i}-${colAttitude + 1}`}
                      value={r.midtermExam} placeholder="0-100"
                      title="Midterm Exam score"
                      style={{ background: 'var(--yellow-l)' }}
                      onChange={e => updateRow(i, 'midtermExam', e.target.value)} />
                  </td>
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      data-cell={`${i}-${colAttitude + 2}`}
                      value={r.finalsExam} placeholder="0-100"
                      title="Finals Exam score"
                      style={{ background: 'var(--yellow-l)' }}
                      onChange={e => updateRow(i, 'finalsExam', e.target.value)} />
                  </td>
                  <td>
                    <input className="grade-input" type="number" min="0" max="100"
                      data-cell={`${i}-${colAttitude + 3}`}
                      value={r.finalGrade} placeholder="auto"
                      title="Final Grade (editable)"
                      style={{ background: 'var(--accent-l)', fontWeight: 700 }}
                      onChange={e => updateFinalGrade(i, e.target.value)} />
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--ink2)', minWidth: 48 }}>
                    {r.equivPreview}
                  </td>
                  {/* Per-student grade note */}
                  <td style={{ textAlign: 'center' }}>
                    {(() => {
                      const hasNote = !!s.gradeNotes?.[subject]?.text
                      return (
                        <button type="button"
                          onClick={() => openNote(s)}
                          title={hasNote ? 'Edit note to student' : 'Add a note for this student'}
                          aria-label={hasNote ? `Edit note for ${s.name}` : `Add note for ${s.name}`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0, color: hasNote ? 'var(--accent)' : 'var(--ink3)' }}>
                          <MessageSquare size={16} fill={hasNote ? 'currentColor' : 'none'} />
                        </button>
                      )
                    })()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <button
          className="link-btn"
          onClick={() => setShowFormula(v => !v)}
          style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ChevronDown size={14} style={{ transform: showFormula ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
          How is the grade computed?
        </button>
        {showFormula && (
          <div className="px-3 py-2 mt-1 rounded-lg text-xs text-ink2" style={{ background: 'var(--bg)', lineHeight: 2 }}>
            <strong>CS Midterm</strong> = Average(Activities, Quizzes, Attendance, Attitude)<br />
            <strong>CS Finals</strong> = Average(Activities, Quizzes, Attendance, Attitude)<br />
            <strong>Midterm Term</strong> = Average(CS Midterm, Midterm Exam)<br />
            <strong>Finals Term</strong> = Average(CS Finals, Finals Exam)<br />
            <strong>Final Grade %</strong> = Average(Midterm Term, Finals Term) → converted to 1.00-5.00 via school lookup table<br />
            <span className="text-ink3">{getGradeScaleLabel(eqScale)}</span>
          </div>
        )}
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Grades'}
        </button>
      </div>
    </Modal>

    {pasteOpen && (
      <Modal onClose={() => setPasteOpen(false)} size="md" sheetOnMobile icon={<FileSpreadsheet size={18} />} title="Import / Paste scores" subtitle="Fill the open grade sheet - review, then Save Grades to keep changes.">

        {/* Excel file import */}
        <div className="mb-4 px-3 py-2.5 rounded-lg" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-1">From a grading-sheet Excel file</div>
          <p className="text-xs text-ink3 mb-2">An <code>.xlsx</code> exported from this app (Activities / Quizzes / Exams &amp; Attendance sheets). Matched by Student ID.</p>
          <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
            <Upload size={13} className="inline-block mr-1" />Choose Excel file…
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) applyExcelFile(f); e.target.value = '' }} />
          </label>
        </div>

        {/* Paste a column */}
        <div className="px-3 py-2.5 rounded-lg" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold mb-1">Paste a column of scores</div>
          <p className="text-xs text-ink3 mb-2">One student per line: <code>Student ID or name [tab/comma] score</code>. Paste straight from Excel or Sheets.</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-ink2">Apply to:</span>
            <select className="input" style={{ maxWidth: 180 }} value={pasteField} onChange={e => setPasteField(e.target.value)}>
              <option value="attitude">Attitude</option>
              <option value="midtermExam">Midterm Exam</option>
              <option value="finalsExam">Finals Exam</option>
              <option value="finalGrade">Final Grade (override)</option>
            </select>
          </div>
          <textarea
            className="input"
            style={{ width: '100%', minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            placeholder={'20241234\t85\n20241235, 90\nDela Cruz   78'}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
          />
          {pasteText.trim() !== '' && (
            <div className="text-xs mt-1" style={{ color: pastePreview.matched > 0 ? 'var(--green)' : 'var(--red)' }}>
              {pastePreview.matched} of {pastePreview.total} line{pastePreview.total === 1 ? '' : 's'} matched a student
              {pastePreview.total > pastePreview.matched && <span className="text-ink3"> · {pastePreview.total - pastePreview.matched} unmatched (ignored)</span>}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setPasteOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={applyPaste} disabled={pastePreview.matched === 0}>
            Apply {pastePreview.matched > 0 ? pastePreview.matched : ''} score{pastePreview.matched === 1 ? '' : 's'}
          </button>
        </div>
      </Modal>
    )}

    {noteFor && (
      <Modal onClose={() => setNoteFor(null)} size="sm" sheetOnMobile icon={<MessageSquare size={18} />} title={`Note to ${noteFor.name}`}
        subtitle={<>About their <strong>{subject}</strong> grade. The student sees this on their Grades tab.</>}
      >
        <textarea
          className="input"
          style={{ width: '100%', minHeight: 110, fontSize: 13 }}
          maxLength={600}
          placeholder="e.g. See me before finals week, your Finals slipped. We can set up a recovery plan."
          value={noteDraft}
          onChange={e => setNoteDraft(e.target.value)}
        />
        <div className="text-xs text-ink3 mt-1">
          {noteDraft.trim()
            ? 'Saving notifies the student.'
            : 'Saving an empty note removes any existing one (no notification).'}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setNoteFor(null)} disabled={noteSaving}>Cancel</button>
          <button className="btn btn-primary" onClick={saveNote} disabled={noteSaving}>
            {noteSaving ? 'Saving…' : (noteDraft.trim() ? 'Save note' : 'Remove note')}
          </button>
        </div>
      </Modal>
    )}
    </>
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
function SubjectCard({ cls, sub, studs, allStuds = [], quizzes = [], eqScale, readOnly, onEdit, onClear, onExport, onExportGrades, onImport }) {
  const [sort, setSort]   = useState({ col: 'name', dir: 'asc' })
  const [page, setPage]   = useState(1)
  const [filter, setFilter] = useState('all') // all | passing | failing | nograde

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
  const midAvgEquiv = midAvg ? gradeInfo(parseFloat(midAvg), eqScale).eq : '-'
  const finAvgEquiv = finAvg ? gradeInfo(parseFloat(finAvg), eqScale).eq : '-'

  const latestTs = studs.map(s => s.gradeUploadedAt?.[sub]).filter(Boolean).sort().pop()

  // Class average (of final grades) + attendance held-days from the full roster.
  const classAvg = finGrades.length ? (finGrades.reduce((a, b) => a + b, 0) / finGrades.length) : null
  const classAvgEquiv = classAvg != null ? gradeInfo(classAvg, eqScale).eq : '-'
  const passRate = total ? Math.round(passing / total * 100) : 0
  const heldDays = useMemo(() => getHeldDays(cls?.id, sub, allStuds), [cls, sub, allStuds])

  // Attention breakdown - who still needs a final grade.
  const notStarted    = studs.filter(s => { const c = s.gradeComponents?.[sub] || {}; return c.midterm == null && c.finals == null }).length
  const missingFinals = studs.filter(s => { const c = s.gradeComponents?.[sub] || {}; return c.midterm != null && c.finals == null }).length
  const needsAttention = noGrade

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

  // Quick-filter the sorted list by status.
  const filtered = useMemo(() => sorted.filter(s => {
    if (filter === 'all') return true
    const c = s.gradeComponents?.[sub] || {}
    const complete = c.midterm != null && c.finals != null
    const fg = s.grades?.[sub]
    if (filter === 'passing') return complete && fg != null && fg >= 75
    if (filter === 'failing') return complete && fg != null && fg < 75
    if (filter === 'nograde') return !complete
    return true
  }), [sorted, filter, sub])

  const slice = filtered.slice((page - 1) * GRADE_PER_PAGE, page * GRADE_PER_PAGE)
  const setFilterReset = (f) => { setFilter(f); setPage(1) }

  // Derive each visible student's row once - shared by the desktop table and
  // the phone card list so the computation isn't duplicated.
  const rowsData = slice.map(s => {
    const comp = s.gradeComponents?.[sub] || {}
    const midG = comp.midterm ?? null
    const finG = comp.finals  ?? null
    const fg   = s.grades?.[sub] ?? null
    const ts   = s.gradeUploadedAt?.[sub]
    const tsLabel = ts ? new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'

    const complete = midG != null && finG != null
    const anyData  = midG != null || finG != null || comp.activities != null || comp.attitude != null
    const stMap = { complete: { l: 'Complete', c: 'green' }, partial: { l: 'Partial', c: 'yellow' }, none: { l: 'Not started', c: 'gray' } }
    const st = complete ? stMap.complete : anyData ? stMap.partial : stMap.none

    const actsV = typeof comp.activities === 'number' ? comp.activities.toFixed(0) : '-'
    const qzDerived = deriveQuizzes(s, sub, quizzes).pct
    const quizV = qzDerived != null ? qzDerived.toFixed(0)
      : (typeof comp.quizzes === 'number' ? comp.quizzes.toFixed(0) : '-')
    const attSize = s.attendance?.[sub]?.size ?? 0
    const attRate = heldDays > 0 ? Math.round((attSize / heldDays) * 100) : null
    const attColor = attRate == null ? 'var(--ink3)' : attRate >= 90 ? 'var(--green)' : attRate >= 75 ? 'var(--yellow)' : 'var(--red)'

    const midPct = midG != null ? `${midG.toFixed(1)}%` : '-'
    const midEquiv = midG != null ? gradeInfo(midG, eqScale).eq : '-'
    const midBadgeCls = midG != null ? (midG >= 75 ? 'green' : midG >= 72 ? 'yellow' : 'red') : 'gray'
    const finPct  = finG != null ? `${finG.toFixed(1)}%` : '-'
    const finEquiv = finG != null ? gradeInfo(finG, eqScale).eq : '-'
    const finBadgeCls = finG != null ? (finG >= 75 ? 'green' : finG >= 72 ? 'yellow' : 'red') : 'gray'
    const fgPct = fg != null ? `${fg.toFixed(1)}%` : '-'
    const fgPctCls = fg != null ? (fg >= 75 ? 'green' : fg >= 72 ? 'yellow' : 'red') : 'gray'

    const gradeFullyUploaded = midG != null && finG != null && ts
    let combinedEq, rem
    if (gradeFullyUploaded) {
      const c = combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq)
      combinedEq = c.eq; rem = c.rem
    } else { combinedEq = '-'; rem = 'Pending' }
    const fgBadgeCls = rem === 'Passed' ? 'green' : rem === 'Conditional' ? 'yellow' : rem === 'Failed' ? 'red' : 'gray'

    return { s, midG, finG, tsLabel, st, actsV, quizV, attRate, attColor, midPct, midEquiv, midBadgeCls, finPct, finEquiv, finBadgeCls, fgPct, fgPctCls, gradeFullyUploaded, combinedEq, rem, fgBadgeCls }
  })

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
          {cls && <span className="badge badge-gray ml-2" style={{ fontWeight: 600 }}>{classTag(cls)}</span>}
          {latestTs
            ? <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--green)' }}>
                Uploaded {new Date(latestTs).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            : <span className="ml-2 text-xs text-ink3">Not yet uploaded</span>}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          {!readOnly && <button className="btn btn-primary btn-sm" onClick={() => onEdit(sub)}><Pencil size={13} className="inline-block mr-1" />Edit Grades</button>}
          <KebabMenu
            label={`Grade actions for ${sub}`}
            items={[
              { label: <><BarChart2 size={13} className="inline-block mr-2 align-text-bottom" />Export Grades</>, onClick: () => onExportGrades(sub) },
              { label: <><Upload size={13} className="inline-block mr-2 align-text-bottom" />Template</>, onClick: () => onExport(sub) },
              !readOnly && { label: <><Download size={13} className="inline-block mr-2 align-text-bottom" />Import</>, onClick: () => onImport(sub) },
              !readOnly && { label: <><Trash2 size={13} className="inline-block mr-2 align-text-bottom" />Clear Grades</>, onClick: () => onClear(sub), danger: true },
            ]}
          />
        </div>
      </div>

      {/* Summary metric cards */}
      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <div className="text-xs text-ink2">Class average</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{classAvg != null ? classAvgEquiv : '-'}
            <span className="text-xs text-ink3" style={{ fontWeight: 400, marginLeft: 4 }}>{classAvg != null ? `· ${classAvg.toFixed(1)}%` : ''}</span>
          </div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <div className="text-xs text-ink2">Pass rate</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: 'var(--green)' }}>{passRate}%
            <span className="text-xs text-ink3" style={{ fontWeight: 400, marginLeft: 4 }}>· {passing}/{total}</span>
          </div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <div className="text-xs text-ink2">Graded</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{completeGrades.length}<span className="text-ink3" style={{ fontSize: 14, fontWeight: 400 }}>/{total}</span></div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <div className="text-xs text-ink2">Needs attention</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: needsAttention ? 'var(--red)' : 'var(--ink)' }}>{needsAttention}</div>
        </div>
      </div>

      {/* Attention banner */}
      {needsAttention > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg flex-wrap" style={{ background: 'var(--yellow-l, #fef9c3)', border: '1px solid var(--yellow, #ca8a04)' }}>
          <AlertTriangle size={16} className="shrink-0" style={{ color: 'var(--yellow-d, #854d0e)' }} />
          <span className="text-sm" style={{ color: 'var(--yellow-d, #854d0e)', flex: '1 1 200px' }}>
            {needsAttention} student{needsAttention !== 1 ? 's' : ''} still need a final grade
            {(missingFinals > 0 || notStarted > 0) && <> - {[missingFinals > 0 && `${missingFinals} missing finals`, notStarted > 0 && `${notStarted} not started`].filter(Boolean).join(', ')}</>}.
          </span>
          {filter !== 'nograde'
            ? <button className="btn btn-ghost btn-sm" onClick={() => setFilterReset('nograde')}>Review these</button>
            : <button className="btn btn-ghost btn-sm" onClick={() => setFilterReset('all')}>Show all</button>}
        </div>
      )}

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

      {/* Quick filters */}
      <div className="flex gap-1.5 flex-wrap mb-2">
        {[
          { k: 'all',     label: 'All',     n: total },
          { k: 'passing', label: 'Passing', n: passing },
          { k: 'failing', label: 'Failing', n: failing },
          { k: 'nograde', label: 'No grade', n: noGrade },
        ].map(({ k, label, n }) => {
          const on = filter === k
          return (
            <button key={k} onClick={() => setFilterReset(k)}
              style={{
                fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                background: on ? 'var(--accent)' : 'var(--surface)',
                color: on ? '#fff' : 'var(--ink2)',
              }}>
              {label} · {n}
            </button>
          )
        })}
      </div>

      {/* Table - tablet/desktop (≥640px); horizontally scrollable */}
      <div className="tbl-wrap hidden sm:block" style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ minWidth: 1040 }}>
          <thead>
            <tr>
              <th className="th-sort" onClick={() => toggleSort('name')}>Student <SortIcon col="name" sort={sort} /></th>
              <th>Status</th>
              <th title="Activity average">Acts</th>
              <th title="Quiz average">Quiz</th>
              <th title="Attendance rate">Attend</th>
              <th className="th-sort" onClick={() => toggleSort('midterm')}>Midterm <SortIcon col="midterm" sort={sort} /></th>
              <th className="th-sort" onClick={() => toggleSort('finals')}>Finals <SortIcon col="finals" sort={sort} /></th>
              <th className="th-sort" onClick={() => toggleSort('grade')}>Final % <SortIcon col="grade" sort={sort} /></th>
              <th>Equiv.</th>
              <th className="th-sort" onClick={() => toggleSort('remarks')}>Remarks <SortIcon col="remarks" sort={sort} /></th>
              <th className="th-sort" onClick={() => toggleSort('uploaded')}>Uploaded <SortIcon col="uploaded" sort={sort} /></th>
            </tr>
          </thead>
          <tbody>
            {rowsData.length === 0 && (
              <tr><td colSpan={12}><EmptyState compact title="No students." /></td></tr>
            )}
            {rowsData.map(r => (
                <tr key={r.s.id}>
                  <td>
                    <strong>{r.s.name}</strong><br />
                    <small className="text-ink2">{r.s.id}</small>
                  </td>
                  <td><span className={`badge ${BADGE_CLS_MAP[r.st.c] || 'badge-gray'}`}>{r.st.l}</span></td>
                  <td style={{ color: r.actsV === '-' ? 'var(--ink3)' : 'var(--ink)' }}>{r.actsV}</td>
                  <td style={{ color: r.quizV === '-' ? 'var(--ink3)' : 'var(--ink)' }}>{r.quizV}</td>
                  <td style={{ color: r.attColor, fontWeight: 600, fontSize: 12 }}>{r.attRate != null ? `${r.attRate}%` : '-'}</td>
                  <td><ToggleBadge pct={r.midPct} equiv={r.midEquiv} badgeCls={r.midBadgeCls} /></td>
                  <td>{r.finG != null ? <ToggleBadge pct={r.finPct} equiv={r.finEquiv} badgeCls={r.finBadgeCls} /> : <span className="badge badge-gray">-</span>}</td>
                  <td><span className={`badge ${BADGE_CLS_MAP[r.fgPctCls] || 'badge-gray'}`}>{r.fgPct}</span></td>
                  <td>
                    {r.gradeFullyUploaded
                      ? <span className={`badge ${BADGE_CLS_MAP[r.fgBadgeCls] || 'badge-gray'}`} style={{ fontSize: 13, fontWeight: 700 }}>{r.combinedEq}</span>
                      : <span className="badge badge-gray" title="Final grade not yet fully uploaded" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>}
                  </td>
                  <td>
                    <span className={`badge ${BADGE_CLS_MAP[r.fgBadgeCls] || 'badge-gray'}`}
                      title={r.rem === 'Pending' ? 'Final grade not yet fully uploaded by professor' : ''}>
                      {r.rem}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--ink2)' }}>{r.tsLabel}</td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone (<640px) - one card per student instead of a sideways-scrolling table */}
      <div className="sm:hidden flex flex-col gap-2">
        {rowsData.length === 0 && <EmptyState compact title="No students." />}
        {rowsData.map(r => (
          <div key={r.s.id} className="rounded-lg p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{r.s.name}</strong>
                <div className="text-xs text-ink3">{r.s.id}</div>
              </div>
              <span className={`badge ${BADGE_CLS_MAP[r.st.c] || 'badge-gray'}`} style={{ flexShrink: 0 }}>{r.st.l}</span>
            </div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {r.gradeFullyUploaded
                ? <span className={`badge ${BADGE_CLS_MAP[r.fgBadgeCls] || 'badge-gray'}`} style={{ fontSize: 14, fontWeight: 700 }}>{r.combinedEq}</span>
                : <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>}
              <span className={`badge ${BADGE_CLS_MAP[r.fgPctCls] || 'badge-gray'}`}>{r.fgPct}</span>
              <span className={`badge ${BADGE_CLS_MAP[r.fgBadgeCls] || 'badge-gray'}`}>{r.rem}</span>
            </div>
            <div className="grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', fontSize: 12 }}>
              <div className="flex justify-between"><span className="text-ink3">Midterm</span><strong>{r.midPct}</strong></div>
              <div className="flex justify-between"><span className="text-ink3">Finals</span><strong>{r.finPct}</strong></div>
              <div className="flex justify-between"><span className="text-ink3">Activities</span><strong>{r.actsV}</strong></div>
              <div className="flex justify-between"><span className="text-ink3">Quiz</span><strong>{r.quizV}</strong></div>
              <div className="flex justify-between"><span className="text-ink3">Attendance</span><strong style={{ color: r.attColor }}>{r.attRate != null ? `${r.attRate}%` : '-'}</strong></div>
              <div className="flex justify-between"><span className="text-ink3">Uploaded</span><strong>{r.tsLabel}</strong></div>
            </div>
          </div>
        ))}
      </div>

      <Pagination total={filtered.length} perPage={GRADE_PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}

// ── GradesTab ─────────────────────────────────────────────────────────────────
// ── Grade-import preview (opens after a file is picked, before anything saves) ──
function GradeImportPreviewModal({ preview, cls, onCancel, onConfirm }) {
  const { sub, verify, fileName } = preview
  const { rows, summary } = verify
  const [page, setPage]     = useState(1)
  const [filter, setFilter] = useState('all') // all | review | ok | error
  const [query, setQuery]   = useState('')
  React.useEffect(() => { setPage(1) }, [filter, query])

  const filtered = useMemo(() => {
    let list = rows
    if (filter === 'review')     list = rows.filter(r => r.matched && r.level === 'review')
    else if (filter === 'ok')    list = rows.filter(r => r.matched && r.level === 'ok')
    else if (filter === 'error') list = rows.filter(r => !r.matched)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter(r => String(r.name).toLowerCase().includes(q) || String(r.studentId).toLowerCase().includes(q))
    if (filter === 'all') {
      const rank = r => (!r.matched ? 0 : r.level === 'review' ? 1 : 2)
      list = [...list].sort((a, b) => rank(a) - rank(b))
    }
    return list
  }, [rows, filter, query])

  const pageRows = filtered.slice((page - 1) * GRADE_IMPORT_PER_PAGE, page * GRADE_IMPORT_PER_PAGE)
  const fmt = v => (v === null || v === undefined ? '-' : v)

  const Tab = ({ id, label, count, color }) => (
    <button
      type="button"
      onClick={() => setFilter(id)}
      className="btn btn-sm"
      style={{
        borderRadius: 999,
        background: filter === id ? 'var(--accent-l)' : 'transparent',
        borderColor: filter === id ? 'var(--accent)' : 'var(--border)',
        color: color || 'var(--ink)',
      }}
    >
      {label} {count}
    </button>
  )

  return (
    <Modal onClose={onCancel} wide sheetOnMobile icon={<Sparkles size={18} />} title={`Review import - ${sub}`}
      subtitle={<><span title={cls?.name || ''}>{courseShort(cls?.name)}</span> {cls?.section} · <span className="text-ink3">{fileName}</span></>}
    >

      <p className="text-xs text-ink3 mb-3" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Sparkles size={12} style={{ color: 'var(--accent)' }} />
        On-device check - grades recomputed the same way the app does. Warnings are advisory; only valid rows import.
      </p>

      {/* Summary */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="badge badge-green">{summary.matched} matched</span>
        {summary.flagged > 0 && <span className="badge" style={{ background: 'var(--warn-l, #FAEEDA)', color: '#854F0B' }}>{summary.flagged} need review</span>}
        {summary.unmatched > 0 && <span className="badge badge-red">{summary.unmatched} not in class</span>}
      </div>

      {/* Filter tabs + search */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex flex-wrap gap-1">
          <Tab id="all"    label="All"          count={rows.length} />
          <Tab id="review" label="Needs review" count={summary.flagged} color="#854F0B" />
          <Tab id="ok"     label="OK"           count={summary.matched - summary.flagged} color="#3B6D11" />
          {summary.unmatched > 0 && <Tab id="error" label="Not in class" count={summary.unmatched} color="#A32D2D" />}
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)' }} />
          <input
            className="input"
            style={{ width: 200, paddingLeft: 28 }}
            placeholder="Search name or ID…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Preview table */}
      <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
        <table className="tbl text-xs">
          <thead>
            <tr>
              <th>#</th><th>Student</th>
              <th className="text-center">Act</th><th className="text-center">Qz</th>
              <th className="text-center">Att</th><th className="text-center">MT</th><th className="text-center">FT</th>
              <th className="text-center">Final</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-ink3" style={{ padding: 16 }}>No rows match.</td></tr>
            )}
            {pageRows.map((r, i) => (
              <tr key={r.studentId + i} style={{ opacity: r.matched ? 1 : 0.6 }}>
                <td className="text-ink3">{(page - 1) * GRADE_IMPORT_PER_PAGE + i + 1}</td>
                <td>
                  <div>{r.name}</div>
                  <div className="text-ink3" style={{ fontSize: 10 }}>{r.studentId}</div>
                </td>
                <td className="text-center">{fmt(r.actAvg)}</td>
                <td className="text-center">{fmt(r.qzAvg)}</td>
                <td className="text-center">{fmt(r.attend)}</td>
                <td className="text-center">{fmt(r.mtExam)}</td>
                <td className="text-center">{fmt(r.ftExam)}</td>
                <td className="text-center" style={{ fontWeight: 600 }}>
                  {fmt(r.final)}{r.final != null && r.equiv && r.equiv !== '-' ? <span className="text-ink3" style={{ fontWeight: 400 }}> · {r.equiv}</span> : null}
                </td>
                <td>
                  {!r.matched ? (
                    <span style={{ color: '#A32D2D', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={r.warnings[0]}>
                      <AlertTriangle size={12} /> Not in class
                    </span>
                  ) : r.level === 'review' ? (
                    <span style={{ color: '#854F0B', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={r.warnings.join('\n')}>
                      <AlertTriangle size={12} /> {r.warnings[0]}
                    </span>
                  ) : (
                    <span style={{ color: '#3B6D11', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Check size={12} /> OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={filtered.length} perPage={GRADE_IMPORT_PER_PAGE} onPageChange={setPage} />

      <div className="flex items-center justify-end gap-2 mt-3">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={summary.matched === 0}>
          <Upload size={14} className="inline-block mr-1" />Import {summary.matched} student{summary.matched === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  )
}

export default function GradesTab() {
  const { classes, students, activities, quizzes, eqScale, saveStudents, fbReady, gradeFloor } = useData()
  const { toast, openDialog } = useUI()

  const [showArchived, setShowArchived] = useState(false)
  const activeClasses   = useMemo(() => classes.filter(c => !c.archived),  [classes])
  const archivedClasses = useMemo(() => classes.filter(c =>  c.archived),  [classes])
  const visibleClasses  = showArchived ? archivedClasses : activeClasses

  const [selKey,     setSelKey]     = useState(null) // `${classId}|||${subject}`
  const [search,     setSearch]     = useState('')
  const [editModal,  setEditModal]  = useState(null) // subject string
  const [importSub,  setImportSub]  = useState(null) // subject string for import
  const [importPreview, setImportPreview] = useState(null) // { sub, entries, verify, fileName }
  const importFileRef = useRef(null)

  // One selectable option per (class, subject) pair, labelled
  // "EMCP 108 - PRINCIPLE OF 3D ANIMATION - BSEMC 3A".
  const subjectOptions = useMemo(() =>
    visibleClasses.flatMap(c => (c.subjects || []).map(sub => ({
      key: `${c.id}|||${sub}`,
      classId: c.id,
      sub,
      label: `${sub} - ${classTag(c)}`,
    }))),
    [visibleClasses]
  )

  // Resolve the current selection, defaulting to the first available subject.
  const selected = subjectOptions.find(o => o.key === selKey) || subjectOptions[0] || null
  const cls = selected ? (visibleClasses.find(c => c.id === selected.classId) || null) : null
  const effectiveId = cls?.id || null
  const selSub = selected?.sub || null

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
      if (ns.gradeHistory?.[sub]) { ns.gradeHistory = { ...ns.gradeHistory }; delete ns.gradeHistory[sub] }
      return ns
    })
    const changedIds = studsInClass.map(s => s.id)
    try {
      await saveStudents(updated, changedIds)
      toast(`Grade data cleared for ${sub}.`, 'green')
    } catch (e) {
      toast('Cleared locally - Firebase sync failed: ' + e.message, 'red')
    }
  }

  async function handleRecompute() {
    const studsInClass = students.filter(s => s.classId === effectiveId || s.classIds?.includes(effectiveId))
    if (!studsInClass.length) return

    const ok = await openDialog({
      title: 'Recompute all grades?',
      msg: `This re-derives grades for all ${studsInClass.length} student${studsInClass.length !== 1 ? 's' : ''} in ${cls.name} ${cls.section} from their underlying components - activity scores (normalized by each activity's max score), quizzes, attendance, attitude and exams - using the current formula. Use this to apply accuracy fixes to existing grades. Manual final-grade overrides will be replaced.`,
      type: 'warning',
      confirmLabel: 'Recompute Grades',
      showCancel: true,
    })
    if (!ok) return

    const now = Date.now()
    let updatedCount = 0

    const updated = students.map(s => {
      if (s.classId !== effectiveId && !s.classIds?.includes(effectiveId)) return s
      const ns = {
        ...s,
        grades: { ...s.grades },
        gradeComponents: { ...(s.gradeComponents || {}) },
        gradeUploadedAt: { ...(s.gradeUploadedAt || {}) },
      }

      // Only touch subjects that already have grade data AND belong to the class
      // being recomputed - otherwise an unrelated subject's attendance would be
      // recomputed against the wrong class id (getHeldDays(effectiveId, …)).
      const classSubs = cls?.subjects || []
      const subjects = Object.keys(ns.gradeComponents).filter(sub => classSubs.includes(sub))
      let changed = false
      subjects.forEach(sub => {
        const comp = { ...(ns.gradeComponents[sub] || {}) }

        // Activities: recompute from this class+subject's submissions (normalized
        // by maxScore); fall back to the stored average when there are none.
        const items = activities
          .filter(a => a.classId === effectiveId && a.subject === sub)
          .map(a => { const sc = (a.submissions || {})[s.id]?.score; return sc != null ? { score: sc, maxScore: a.maxScore || 100 } : null })
          .filter(Boolean)
        const actPct = items.length ? scoredPercent(items) : (comp.activities ?? null)
        if (items.length) comp.activities = round2(actPct)

        // Attendance: recompute from records (held-days now counts cross-enrolled).
        const held   = getHeldDays(effectiveId, sub, students)
        const attSet = s.attendance?.[sub] || new Set()
        const attV   = held > 0 ? Math.min(100, (attSet.size / held) * 100) : null

        const qzV       = typeof comp.quizzes === 'number' ? comp.quizzes : null
        const attitudeV = comp.attitude    ?? null
        const midExamV  = comp.midtermExam ?? null
        const finExamV  = comp.finalsExam  ?? null

        const { cs, midterm, finals, final } = computeTerms({
          activities: actPct, quizzes: qzV, attendance: attV,
          attitude: attitudeV, midtermExam: midExamV, finalsExam: finExamV,
        })
        if (midExamV != null) { comp.midtermCS = round2(cs); comp.midterm = round2(midterm) }
        if (finExamV != null) { comp.finalsCS  = round2(cs); comp.finals  = round2(finals) }

        ns.gradeComponents[sub] = comp

        const newFinal = (comp.midterm != null || comp.finals != null) ? final : null
        if (newFinal !== null) {
          ns.grades[sub] = newFinal
          if (!ns.gradeUploadedAt[sub]) ns.gradeUploadedAt[sub] = now
          const entry = makeHistoryEntry(
            { activities: actPct, quizzes: qzV, attendance: attV, attitude: attitudeV },
            { midterm: comp.midterm ?? null, finals: comp.finals ?? null, final: newFinal },
            'recomputed', now,
          )
          ns.gradeHistory = appendGradeHistory(ns.gradeHistory, sub, entry)
          changed = true
        }
      })

      if (changed) updatedCount++
      return ns
    })

    const changedIds = studsInClass.map(s => s.id)
    try {
      await saveStudents(updated, changedIds)
      toast(`Recomputed grades for ${updatedCount} student${updatedCount !== 1 ? 's' : ''}.`, 'green')
    } catch (e) {
      toast('Recomputed locally - Firebase sync failed: ' + e.message, 'red')
    }
  }

  async function handleExport(sub) {
    const res = await exportGradingSheet({ classId: effectiveId, subject: sub, students, classes, activities, quizzes, eqScale })
    if (res?.reason === 'empty') toast(`No students are enrolled in ${cls?.name || 'this class'} yet - add students before exporting grades.`, 'red')
  }

  async function handleExportGrades(sub) {
    const res = await exportCurrentGrades({ classId: effectiveId, subject: sub, students, classes, activities, quizzes, eqScale })
    if (res?.reason === 'empty') toast(`No students are enrolled in ${cls?.name || 'this class'} yet - add students before exporting grades.`, 'red')
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

    // Recompute every row the way the app does and surface anything off before
    // anything is written - the professor reviews + confirms in the preview panel.
    const verify = verifyGradeRows(entries, { students, classId: effectiveId, subject: importSub, eqScale, gradeFloor })
    setImportPreview({ sub: importSub, entries, verify, fileName: file.name })
  }

  async function applyGradeImport(preview) {
    const { sub, entries } = preview
    const now      = Date.now()
    const entryMap = Object.fromEntries(entries.map(en => [String(en.studentId).toLowerCase(), en]))
    const clampV   = v => (v !== null && v !== undefined && !isNaN(v)) ? Math.min(100, Math.max(0, v)) : null

    const updatedStudents = students.map(s => {
      if (s.classId !== effectiveId && !s.classIds?.includes(effectiveId)) return s
      const entry = entryMap[String(s.id).toLowerCase()]
      if (!entry) return s

      const ns   = { ...s, grades: { ...s.grades }, gradeComponents: { ...(s.gradeComponents || {}) }, gradeUploadedAt: { ...(s.gradeUploadedAt || {}) } }
      const comp = { ...(ns.gradeComponents[sub] || {}) }

      // Attendance - auto from records (matches the system formula).
      const attSet = s.attendance?.[sub] || new Set()
      const held   = getHeldDays(effectiveId, sub, students)
      const attV   = held > 0 ? Math.min(100, round2((attSet.size / held) * 100)) : null

      // The "+ Activity" / "+ Quiz" extra columns import as their own columns
      // (keys x1.. / xq1..) - additive, never overwriting the app's own activities
      // and quizzes (which stay locked + submission-driven in the sheet).
      const extraAct = (entry.actScores || []).slice(entry.nApp || 0)
      if (extraAct.some(v => v != null)) {
        const map = {}
        Object.entries(comp.activityScores || {}).forEach(([k, v]) => { if (!/^x\d+$/.test(k)) map[k] = v })
        extraAct.forEach((v, i) => { if (v != null) map[`x${i + 1}`] = v })
        comp.activityScores = map
      }
      const extraQz = (entry.qzScores || []).slice(entry.nAppQz || 0)
      if (extraQz.some(v => v != null)) {
        const map = {}
        Object.entries(comp.quizScores || {}).forEach(([k, v]) => { if (!/^xq\d+$/.test(k)) map[k] = v })
        extraQz.forEach((v, i) => { if (v != null) map[`xq${i + 1}`] = v })
        comp.quizScores = map
      }

      // Component percentages - the activity/quiz averages from the sheet already
      // fold in the extra columns; fall back to stored values when a cell is blank.
      const actV     = entry.actAvg   != null ? clampV(entry.actAvg)   : (comp.activities ?? null)
      const qzV      = entry.qzAvg    != null ? clampV(entry.qzAvg)    : (typeof comp.quizzes === 'number' ? comp.quizzes : null)
      const attitude = entry.attitude != null ? clampV(entry.attitude) : (comp.attitude ?? null)
      const midExamV = entry.mtExam   != null ? clampV(entry.mtExam)   : (comp.midtermExam ?? null)
      const finExamV = entry.ftExam   != null ? clampV(entry.ftExam)   : (comp.finalsExam ?? null)

      if (actV     != null) comp.activities  = actV
      if (qzV      != null) comp.quizzes     = qzV
      if (attitude != null) comp.attitude    = attitude
      if (midExamV != null) comp.midtermExam = midExamV
      if (finExamV != null) comp.finalsExam  = finExamV

      // Canonical computation - Class Standing includes Attitude; intermediates
      // full precision, final rounded once.
      const { cs, midterm, finals, final } = computeTerms({
        activities: actV, quizzes: qzV, attendance: attV,
        attitude, midtermExam: midExamV, finalsExam: finExamV,
      })
      if (midExamV !== null) { comp.midtermCS = round2(cs); comp.midterm = round2(midterm) }
      if (finExamV !== null) { comp.finalsCS  = round2(cs); comp.finals  = round2(finals) }

      const finalGrade = (comp.midterm != null || comp.finals != null) ? final : null
      ns.grades[sub]          = finalGrade
      ns.gradeComponents[sub] = comp
      if (finalGrade !== null) {
        ns.gradeUploadedAt[sub] = now
        const entry = makeHistoryEntry(
          { activities: actV, quizzes: qzV, attendance: attV, attitude },
          { midterm: comp.midterm ?? null, finals: comp.finals ?? null, final: finalGrade },
          'imported', now,
        )
        ns.gradeHistory = appendGradeHistory(ns.gradeHistory, sub, entry)
      }
      return ns
    })

    const studsInClass = students.filter(s => s.classId === effectiveId || s.classIds?.includes(effectiveId))
    const changedIds   = studsInClass.map(s => s.id)
    const idsLower     = new Set(studsInClass.map(s => String(s.id).toLowerCase()))
    const matched      = entries.filter(en => idsLower.has(String(en.studentId).toLowerCase())).length
    try {
      await saveStudents(updatedStudents, changedIds)
      toast(`Grades imported for ${matched} student${matched === 1 ? '' : 's'} in "${sub}".`, 'green')
    } catch (err) {
      toast('Saved locally - Firebase sync failed: ' + err.message, 'red')
    }
    setImportPreview(null)
    setImportSub(null)
  }

  if (!fbReady) return <SkeletonTable />

  return (
    <div>
      {/* Header */}
      <PageHeader
        title="Grades"
        subtitle={`${students.length} ${students.length === 1 ? 'student' : 'students'}`}
        actions={<>
          <button
            className="btn btn-primary btn-sm"
            title="Export a master workbook with full grading computation for every student across all active classes"
            onClick={() => exportMasterGradingReport({ students, classes, eqScale })}
          >
            <FileSpreadsheet size={14} className="inline-block mr-1" />Master Report
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setShowArchived(v => !v); setSelKey(null); setSearch('') }}
          >
            {showArchived
              ? <><ArchiveRestore size={14} className="inline-block mr-1" />Active Classes</>
              : <><Archive size={14} className="inline-block mr-1" />Archived Classes</>}
          </button>
        </>}
      />

      {/* Archived mode banner */}
      {showArchived && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-sm"
          style={{ background: 'var(--yellow-l, #fef9c3)', color: 'var(--yellow-d, #854d0e)', border: '1px solid var(--yellow, #ca8a04)' }}>
          <Archive size={14} className="shrink-0" />
          Viewing archived class data - read-only.
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select className="input" style={{ flex: '1 1 240px', minWidth: 0, maxWidth: 420 }}
          value={selected?.key || ''}
          onChange={e => { setSelKey(e.target.value); setSearch('') }}>
          <option value="">- Select a subject -</option>
          {subjectOptions.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <input className="input" style={{ flex: '1 1 160px', minWidth: 0, maxWidth: 240 }}
          aria-label="Search students"
          placeholder="Search student…"
          value={search}
          onChange={e => setSearch(e.target.value)} />
        {effectiveId && !showArchived && (
          <button className="btn btn-ghost btn-sm" onClick={handleRecompute}
            title="Recompute all final grades from stored grade components">
            <RefreshCw size={13} className="inline-block mr-1" />Recompute Grades
          </button>
        )}
      </div>

      {!subjectOptions.length ? (
        <EmptyState
          Icon={BarChart}
          title={showArchived ? 'No archived classes with subjects.' : 'No subjects yet'}
          text={showArchived ? undefined : 'Add subjects to a class first.'}
        />
      ) : !selected ? (
        <EmptyState title="Select a subject above to view its grades." />
      ) : (
        <SubjectCard
          key={selected.key}
          cls={cls}
          sub={selSub}
          studs={filteredStuds}
          allStuds={students}
          quizzes={quizzes}
          eqScale={eqScale}
          readOnly={showArchived}
          onEdit={showArchived ? null : sub => setEditModal(sub)}
          onClear={showArchived ? null : handleClear}
          onExport={handleExport}
          onExportGrades={handleExportGrades}
          onImport={showArchived ? null : sub => { setImportSub(sub); importFileRef.current?.click() }}
        />
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

      {importPreview && (
        <GradeImportPreviewModal
          preview={importPreview}
          cls={cls}
          onCancel={() => { setImportPreview(null); setImportSub(null) }}
          onConfirm={() => applyGradeImport(importPreview)}
        />
      )}
    </div>
  )
}
