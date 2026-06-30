import React, { useState, useMemo, useEffect, useRef } from 'react'
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName, getInitials } from '@/utils/format'
import { courseShort } from '@/constants/courses'
import { getHeldDays, computeTerms, scoredPercent, round2 } from '@/utils/grades'
import Modal from '@/components/primitives/Modal'
import Pagination from '@/components/primitives/Pagination'
import Badge from '@/components/primitives/Badge'
import EmptyState from '@/components/ds/EmptyState'
import SubmissionPreview from '@/components/primitives/SubmissionPreview'
import { extractSubmissionText } from '@/utils/submissionExtract'
import { Clock, AlertCircle, X, Archive, ArchiveRestore, Sparkles, Wand2, Pencil, ClipboardList, AlarmClock, CircleDot, BarChart3, CheckCircle2, Check, Save, Plus, Copy, Users, ClipboardPaste, AlertTriangle, Trash2 } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
import { deviceRubric, smartInstructions, smartRubric, smartGrade, smartGradeGroups, autoFormGroups, prewarmActivitySmart, groupName } from '@/utils/activitySmart'
import { sendPushToOwners } from '@/firebase/pushTokens'
import { pushStudentNotif } from '@/firebase/studentNotif'
import { lateInfo, applyLatePenalty } from '@/utils/latePenalty'
import { parseGroupPaste, verifyGroupRows, GROUP_COLUMNS } from '@/utils/groupImportVerifySmart'

function fmtLocalInput(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Helpers ───────────────────────────────────────────────────────────
function actId() {
  return 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
}

// A pasted submission link the serverless proxy can read text from.
function isDocLink(link) {
  return /(docs|drive)\.google\.com/i.test(String(link || ''))
}

// Rebuild a base64 payload from the extract-doc proxy into a File the on-device
// OCR/PDF reader can consume. Returns null if the string is not valid base64.
function base64ToFile(b64, name, mime) {
  try {
    const bin = atob(String(b64 || ''))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new File([bytes], name, { type: mime })
  } catch {
    return null
  }
}

function defaultDeadlineStr() {
  const dl = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${dl.getFullYear()}-${pad(dl.getMonth() + 1)}-${pad(dl.getDate())}T${pad(dl.getHours())}:${pad(dl.getMinutes())}`
}

// ── Recompute student grade components after activity scoring ─────────
// Mirrors _actUpdateStudentGrade from original
function buildUpdatedStudent(s, subject, classId, allActivities, allStudents) {
  const comp = { ...(s.gradeComponents?.[subject] || {}) }

  const subjectActs = allActivities.filter(a => a.classId === classId && a.subject === subject)
  // Normalize each activity to a percentage of its own maxScore so rubric
  // activities (max ≠ 100) are weighted correctly.
  const items = subjectActs
    .map(a => { const sc = (a.submissions || {})[s.id]?.score; return sc != null ? { score: sc, maxScore: a.maxScore || 100 } : null })
    .filter(Boolean)
  if (!items.length) return null

  const actPct = scoredPercent(items)       // full precision %
  comp.activities = round2(actPct)

  // Persist the raw per-activity scores for the grade-entry modal.
  const actScores = {}
  subjectActs.forEach((a, idx) => {
    const sc = (a.submissions || {})[s.id]?.score
    if (sc != null) {
      actScores['a' + (idx + 1)] = sc
      actScores[a.id] = sc
    }
  })
  comp.activityScores = actScores

  const held   = getHeldDays(classId, subject, allStudents)
  const attSet = s.attendance?.[subject] || new Set()
  const attV   = held > 0 ? Math.min(100, (attSet.size / held) * 100) : null

  // One canonical computation - Class Standing now includes Attitude, matching
  // the Grades tab and importer. Intermediates full precision; final rounded.
  const { cs, midterm, finals, final } = computeTerms({
    activities: actPct,
    quizzes:    comp.quizzes ?? null,
    attendance: attV,
    attitude:   comp.attitude ?? null,
    midtermExam: comp.midtermExam ?? null,
    finalsExam:  comp.finalsExam ?? null,
  })
  comp.midtermCS = round2(cs)
  comp.finalsCS  = round2(cs)
  if (comp.midtermExam != null) comp.midterm = round2(midterm)
  if (comp.finalsExam  != null) comp.finals  = round2(finals)

  const newGrade = final ?? s.grades?.[subject] ?? null

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

// ── Custom groups (paste from Excel) ──────────────────────────────────
// The professor copies a grouping block out of Excel and pastes it here. Excel
// puts the clipboard on the board as TSV, so we parse it, smart-verify each row
// against the class roster, and hand back ready-to-apply groups[]. Pure UI on top
// of parseGroupPaste / verifyGroupRows.
function CustomGroupsPanel({ roster, allStudents, classes, semester, classMeta, onApply, onClose }) {
  const { toast } = useUI()
  const [rawRows, setRawRows] = useState([])

  const verify = useMemo(
    () => verifyGroupRows(rawRows, { roster, allStudents, classes, semester, classMeta }),
    [rawRows, roster, allStudents, classes, semester, classMeta]
  )
  const s = verify.summary

  function handlePaste(e) {
    const text = e.clipboardData?.getData('text/plain') || ''
    if (!text.trim()) return
    e.preventDefault()
    const parsed = parseGroupPaste(text)
    if (!parsed.length) { toast('Could not read any rows from the clipboard.', 'warn'); return }
    setRawRows(prev => [...prev, ...parsed])
    toast(`Added ${parsed.length} row${parsed.length === 1 ? '' : 's'} from the clipboard.`, 'green')
  }
  function copyHeaders() {
    const line = GROUP_COLUMNS.join('\t')
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(line).then(
        () => toast('Column headers copied - paste them into Excel row 1.', 'green'),
        () => toast('Could not copy headers.', 'warn')
      )
    } else { toast('Clipboard not available in this browser.', 'warn') }
  }
  function removeRow(i) { setRawRows(prev => prev.filter((_, idx) => idx !== i)) }
  function clearAll() { setRawRows([]) }
  function apply() {
    if (!verify.groups.length) { toast('No valid rows to apply yet.', 'warn'); return }
    onApply(verify.groups)
    toast(`Applied ${s.assigned} student${s.assigned === 1 ? '' : 's'} across ${verify.groups.length} group${verify.groups.length === 1 ? '' : 's'}.`, 'green')
  }

  const C_WARN = '#B5710D', C_ERR = '#A32D2D'
  const td = { padding: '5px 7px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  const th = { ...td, textAlign: 'left', fontWeight: 600, color: 'var(--ink2)', position: 'sticky', top: 0, background: 'var(--surface2)' }

  return (
    <Modal isOpen onClose={onClose} zIndex={300} wide>
      <div onPaste={handlePaste}>
        <div className="mb-4 pr-8">
          <h3 className="text-lg font-bold text-ink font-display"><ClipboardPaste size={18} className="inline-block mr-2" style={{ verticalAlign: -3 }} />Custom groups</h3>
          <p className="text-xs text-ink2 mt-1">Build the grouping in Excel, copy the cells, then paste them anywhere in this panel. Smart check verifies every row against the class roster.</p>
        </div>

        {/* Column-order guide */}
        <div className="mb-3 px-3 py-2 rounded-lg flex items-start gap-2" style={{ background: 'var(--accent-l)', border: '1px solid var(--accent)' }}>
          <ClipboardList size={15} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
          <div className="text-xs" style={{ color: 'var(--accent)', lineHeight: 1.6 }}>
            Match this column order in Excel (M.I. may be left blank):
            <div className="mt-1 font-mono" style={{ fontSize: 11, background: 'var(--surface)', color: 'var(--ink2)', padding: '3px 7px', borderRadius: 4, display: 'inline-block' }}>
              {GROUP_COLUMNS.join('  ·  ')}
            </div>
            <button type="button" className="btn btn-ghost btn-sm ml-2" style={{ verticalAlign: 1 }} onClick={copyHeaders}><Copy size={12} className="inline-block mr-1" />Copy headers</button>
          </div>
        </div>

        {verify.rows.length === 0 ? (
          <div tabIndex={0} className="rounded-lg flex flex-col items-center justify-center text-center"
            style={{ border: '1.5px dashed var(--border)', background: 'var(--surface2)', padding: '34px 16px', outline: 'none', cursor: 'text' }}>
            <ClipboardPaste size={26} style={{ color: 'var(--ink3)' }} />
            <p className="text-sm font-semibold text-ink2 mt-2">Paste your grouping here</p>
            <p className="text-xs text-ink3 mt-1">Copy the cells in Excel, click this panel, then press Ctrl/Cmd + V.</p>
          </div>
        ) : (
          <>
            {/* Summary chips */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--green-l, #EAF3DE)', color: 'var(--green, #3B6D11)' }}><Check size={12} className="inline-block mr-1" style={{ verticalAlign: -2 }} />{s.assigned} assigned</span>
              {s.review > 0 && <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(181,113,13,.12)', color: C_WARN }}>{s.review} need review</span>}
              {s.notEnrolled > 0 && <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(163,45,45,.1)', color: C_ERR }}>{s.notEnrolled} not enrolled</span>}
              {s.skipped > 0 && <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(163,45,45,.1)', color: C_ERR }}>{s.skipped} skipped</span>}
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface2)', color: 'var(--ink2)', border: '1px solid var(--border)' }}>{s.groupCount} group{s.groupCount === 1 ? '' : 's'}</span>
            </div>

            <div style={{ maxHeight: '46vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 30 }} /><col style={{ width: 92 }} /><col /><col /><col style={{ width: 44 }} />
                  <col style={{ width: 72 }} /><col style={{ width: 72 }} /><col style={{ width: 56 }} /><col style={{ width: 52 }} /><col style={{ width: 30 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={th}></th><th style={th}>ID</th><th style={th}>Surname</th><th style={th}>First name</th><th style={th}>M.I.</th>
                    <th style={th}>Group</th><th style={th}>Course</th><th style={th}>Section</th><th style={th}>Year</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {verify.rows.map(r => {
                    const tint = r.status === 'error' ? 'rgba(163,45,45,.06)' : r.status === 'warn' ? 'rgba(181,113,13,.07)' : 'transparent'
                    const ink = r.status === 'error' ? C_ERR : r.status === 'warn' ? C_WARN : 'var(--ink)'
                    return (
                      <React.Fragment key={r.i}>
                        <tr style={{ borderTop: '1px solid var(--border)', background: tint }}>
                          <td style={{ ...td, textAlign: 'center' }}>
                            {r.status === 'ok' ? <CheckCircle2 size={15} style={{ color: 'var(--green)' }} />
                              : r.status === 'warn' ? <AlertTriangle size={15} style={{ color: C_WARN }} />
                              : <X size={15} style={{ color: C_ERR }} />}
                          </td>
                          <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--ink3)' }} title={r.id}>{r.id || '-'}</td>
                          <td style={{ ...td, color: ink }} title={r.surname}>{r.surname || '-'}</td>
                          <td style={{ ...td, color: ink }} title={r.first}>{r.first || '-'}</td>
                          <td style={{ ...td, color: 'var(--ink2)' }}>{r.mi || ''}</td>
                          <td style={{ ...td, color: r.applied ? 'var(--accent)' : 'var(--ink3)' }}>{r.groupLabel || r.group || '-'}</td>
                          <td style={{ ...td, color: 'var(--ink3)' }} title={r.course}>{r.course || ''}</td>
                          <td style={{ ...td, color: 'var(--ink3)' }} title={r.section}>{r.section || ''}</td>
                          <td style={{ ...td, color: 'var(--ink3)' }} title={r.year}>{r.year || ''}</td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <button type="button" className="btn btn-ghost btn-sm text-red-500" style={{ padding: 2 }} title="Remove row" onClick={() => removeRow(r.i)}><X size={13} /></button>
                          </td>
                        </tr>
                        {r.warnings.length > 0 && (
                          <tr style={{ background: tint }}>
                            <td></td>
                            <td colSpan={9} style={{ padding: '0 7px 5px', fontSize: 11, color: ink }}>
                              {r.warnings.join('  •  ')}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-ink3">Pasting more rows adds to the list. Applying replaces the current groups.</span>
              <button type="button" className="btn btn-ghost btn-sm text-red-500" onClick={clearAll}><Trash2 size={13} className="inline-block mr-1" />Clear all</button>
            </div>
          </>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!verify.groups.length}>
            <Check size={16} /> Apply groups
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Create / Edit Modal ───────────────────────────────────────────────
function ActivityFormModal({ act, onClose }) {
  const { classes, students, db, fbReady, semester, rubricLibrary, saveRubricToLibrary, deleteLibraryRubric } = useData()
  const { toast } = useUI()
  const isEdit = !!act
  const [showLib, setShowLib] = useState(false)

  // Group case-study mode
  const [isGroup, setIsGroup] = useState(act?.isGroup || false)
  const [casePrompt, setCasePrompt] = useState(act?.casePrompt || '')
  const [groups, setGroups] = useState(() => act?.groups?.length ? act.groups : [])
  const [groupSize, setGroupSize] = useState(3)
  const [autoForming, setAutoForming] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)

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
  const [smartBusyInstr, setAiBusyInstr] = useState(false)
  const [smartBusyRubric, setAiBusyRubric] = useState(false)
  const [tab, setTab] = useState('details') // 'details' | 'rubric'

  // Warm the shared on-device Smart model when the form opens so the rubric
  // suggestion isn't a cold wait.
  useEffect(() => { prewarmActivitySmart() }, [])

  const selectedClass = classes.find(c => c.id === classId)

  // Roster for the selected class (registered students), for group building.
  const roster = useMemo(
    () => sortByLastName((students || []).filter(s => s.classId === classId && s.account?.registered)),
    [students, classId]
  )
  const assignedIds = useMemo(() => new Set(groups.flatMap(g => g.memberIds || [])), [groups])

  function addGroup() {
    setGroups(g => [...g, { id: 'g_' + Date.now() + '_' + g.length, name: groupName(g.length), memberIds: [] }])
  }
  function removeGroup(id) { setGroups(g => g.filter(x => x.id !== id)) }
  function renameGroup(id, name) { setGroups(g => g.map(x => x.id === id ? { ...x, name } : x)) }
  function toggleMember(groupId, sid) {
    setGroups(g => g.map(x => {
      if (x.id === groupId) {
        const has = (x.memberIds || []).includes(sid)
        return { ...x, memberIds: has ? x.memberIds.filter(i => i !== sid) : [...(x.memberIds || []), sid] }
      }
      // A student can be in only one group - strip them from every other group.
      return { ...x, memberIds: (x.memberIds || []).filter(i => i !== sid) }
    }))
  }
  async function autoForm() {
    if (!roster.length) { toast('Select a class with students first.', 'warn'); return }
    setAutoForming(true)
    try {
      const formed = await autoFormGroups(roster.map(s => ({ id: s.id, name: s.name })), groupSize)
      setGroups(formed)
      toast(`Formed ${formed.length} balanced group${formed.length === 1 ? '' : 's'}.`, 'green')
    } catch {
      toast('Could not auto-form groups.', 'warn')
    } finally { setAutoForming(false) }
  }

  // Deadline quick-presets
  function presetDeadline(kind) {
    const d = new Date()
    if (kind === 'eod') { d.setHours(23, 59, 0, 0) }
    else if (kind === '3d') { d.setDate(d.getDate() + 3) }
    else if (kind === '1w') { d.setDate(d.getDate() + 7) }
    setDeadline(fmtLocalInput(d))
  }

  // Instructions - on-device smart template (instant, no Gemini).
  async function suggestInstructions() {
    if (!title.trim()) { toast('Add a title first.', 'warn'); return }
    setAiBusyInstr(true)
    try {
      const text = await smartInstructions(title, subject)
      if (text) setInstructions(text)
    } finally { setAiBusyInstr(false) }
  }

  // Rubric - on-device semantic match to the best-fit archetype.
  async function suggestRubric() {
    if (!title.trim()) { toast('Add a title first.', 'warn'); return }
    setAiBusyRubric(true)
    try {
      const r = await smartRubric(title, subject, instructions)
      setRubric(r.length ? r : deviceRubric(title, subject))
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

  // ── Rubric library ──────────────────────────────────────────────────────
  const [libName, setLibName] = useState('')
  function saveCurrentToLibrary() {
    if (!rubric.length) { toast('Add rubric criteria first.', 'dark'); return }
    const name = libName.trim() || title.trim() || 'Untitled rubric'
    const entry = {
      id: 'rub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name,
      criteria: rubric.map(c => ({ name: (c.name || '').trim(), points: parseFloat(c.points) || 0 })).filter(c => c.name),
      createdAt: Date.now(),
    }
    if (!entry.criteria.length) { toast('Name your criteria before saving.', 'dark'); return }
    saveRubricToLibrary(entry)
    setLibName('')
    toast(`Saved "${name}" to rubric library.`, 'green')
  }
  function insertLibraryRubric(entry) {
    setRubric((entry.criteria || []).map((c, i) => ({
      id: 'c' + Date.now() + '_' + i + '_' + Math.random().toString(36).slice(2, 5),
      name: c.name, points: c.points,
    })))
    setShowLib(false)
    toast(`Inserted "${entry.name}".`, 'green')
  }

  async function handleSave() {
    setErr('')
    if (!title.trim())   { setTab('details'); setErr('Activity title is required.'); return }
    if (!classId)        { setTab('details'); setErr('Please select a class.'); return }
    if (!subject)        { setTab('details'); setErr('Please select a subject.'); return }
    if (!deadline)       { setTab('details'); setErr('Please set a deadline.'); return }
    const dlTs = new Date(deadline).getTime()
    if (isNaN(dlTs))     { setTab('details'); setErr('Invalid deadline date.'); return }

    // Validate rubric if used
    if (rubric.length) {
      for (const c of rubric) {
        if (!c.name.trim()) { setTab('rubric'); setErr('Each rubric criterion must have a name.'); return }
        const pts = parseFloat(c.points)
        if (isNaN(pts) || pts < 1) { setTab('rubric'); setErr('Each criterion must have at least 1 point.'); return }
      }
      if (maxScore < 1 || maxScore > 1000) { setTab('rubric'); setErr('Rubric total must be between 1 and 1000.'); return }
    }

    // Validate groups for a group case-study activity.
    const cleanGroups = isGroup
      ? groups.map(g => ({ id: g.id, name: (g.name || '').trim() || 'Group', memberIds: g.memberIds || [] })).filter(g => g.memberIds.length)
      : []
    if (isGroup) {
      if (!cleanGroups.length) { setTab('groups'); setErr('Add at least one group with members.'); return }
    }

    if (!fbReady || !db.current) { setErr('Firebase is required to post activities.'); return }

    const cleanRubric = rubric.map(c => ({ id: c.id, name: c.name.trim(), points: parseFloat(c.points) || 0 }))

    setSaving(true)
    try {
      if (isEdit) {
        await updateDoc(doc(db.current, 'activities', act.id), {
          title: title.trim(), classId, subject, maxScore, deadline: dlTs,
          instructions: instructions.trim(), rubric: cleanRubric,
          isGroup, casePrompt: isGroup ? casePrompt.trim() : '', groups: cleanGroups,
        })
      } else {
        const id = actId()
        await setDoc(doc(db.current, 'activities', id), {
          id, title: title.trim(), classId, subject, maxScore, deadline: dlTs,
          instructions: instructions.trim(), rubric: cleanRubric,
          isGroup, casePrompt: isGroup ? casePrompt.trim() : '', groups: cleanGroups,
          createdAt: Date.now(), createdBy: 'admin', submissions: {}, groupSubmissions: {},
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

      {/* Tabs: Details · Rubric */}
      <div className="inline-flex bg-[var(--surface2)] border border-[var(--border)] rounded-full p-0.5 mb-3">
        {[
          { id: 'details', label: 'Details' },
          { id: 'rubric', label: `Rubric${rubric.length ? ` · ${rubric.length}` : ''}` },
          ...(isGroup ? [{ id: 'groups', label: `Groups${groups.length ? ` · ${groups.length}` : ''}` }] : []),
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`text-xs font-medium px-3.5 py-1.5 rounded-full transition-colors ${
              tab === t.id ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm' : 'text-[var(--ink3)] hover:text-[var(--ink2)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
      <>
      <div className="field mb-3">
        <label className="text-xs font-semibold text-ink2 mb-1 block">Title <span className="text-red-500">*</span></label>
        <input className="input w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Lab Report 1" autoFocus />
      </div>

      <div className="input-row mb-3">
        <div className="field flex-1">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Class <span className="text-red-500">*</span></label>
          <select className="input w-full" value={classId} onChange={e => handleClassChange(e.target.value)} disabled={isEdit}>
            <option value="">- Select Class -</option>
            {classes.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{courseShort(c.name)} {c.section}</option>)}
          </select>
        </div>
        <div className="field flex-1">
          <label className="text-xs font-semibold text-ink2 mb-1 block">Subject <span className="text-red-500">*</span></label>
          <select className="input w-full" value={subject} onChange={e => setSubject(e.target.value)} disabled={isEdit}>
            <option value="">- Select Subject -</option>
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
          <button type="button" className="btn btn-ghost btn-xs" onClick={suggestInstructions} disabled={smartBusyInstr}>
            <Sparkles size={12} className="inline-block mr-1" />{smartBusyInstr ? 'Writing…' : 'Auto-write'}
          </button>
        </div>
        <textarea className="input w-full" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Brief instructions for students…" />
      </div>

      {/* Group case-study mode */}
      <div className="field mb-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
        <label className="flex items-center gap-2" style={{ cursor: isEdit ? 'not-allowed' : 'pointer' }}>
          <input type="checkbox" checked={isGroup} disabled={isEdit} onChange={e => setIsGroup(e.target.checked)} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Group case-study activity</span>
        </label>
        <p className="text-xs text-ink3 mt-1" style={{ marginLeft: 24 }}>
          Students work in teams; each group submits one analysis. On-device Smart grading drafts a rubric score per group, which you review and apply to all members.
        </p>
        {isGroup && (
          <div className="mt-2" style={{ marginLeft: 24 }}>
            <label className="text-xs font-semibold text-ink2 mb-1 block">Case prompt / scenario</label>
            <textarea className="input w-full" rows={3} value={casePrompt} onChange={e => setCasePrompt(e.target.value)}
              placeholder="Describe the case or scenario the groups must analyze…" />
            <p className="text-xs text-ink3 mt-1">Used to check each group actually addresses the case. Set up teams in the <strong>Groups</strong> tab.</p>
          </div>
        )}
      </div>
      </>
      )}

      {/* Rubric builder */}
      {tab === 'rubric' && (
      <div className="field mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-ink2">
            Grading Rubric <span className="font-normal text-ink3">(optional)</span>
          </label>
          <div className="flex gap-1.5">
            <button type="button" className={`btn btn-sm ${showLib ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowLib(v => !v)} title="Reusable rubric library">
              <ClipboardList size={13} className="inline-block mr-1" />Library{rubricLibrary?.length ? ` (${rubricLibrary.length})` : ''}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={suggestRubric} disabled={smartBusyRubric}>
              <Wand2 size={13} className="inline-block mr-1" />{smartBusyRubric ? 'Suggesting…' : 'Suggest rubric'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCriterion}>+ Add Criterion</button>
          </div>
        </div>

        {showLib && (
          <div className="mb-2 px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            {/* Save current rubric */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Name this rubric…" value={libName}
                onChange={e => setLibName(e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={saveCurrentToLibrary} disabled={!rubric.length}>
                <Save size={13} className="inline-block mr-1" />Save current
              </button>
            </div>
            {/* Saved rubrics */}
            {rubricLibrary?.length ? (
              <div className="flex flex-col gap-1" style={{ maxHeight: 160, overflowY: 'auto' }}>
                {rubricLibrary.map(entry => (
                  <div key={entry.id} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: 'var(--surface)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-xs font-semibold text-ink truncate">{entry.name}</div>
                      <div className="text-xs text-ink3 truncate">{(entry.criteria || []).length} criteria · {(entry.criteria || []).reduce((s, c) => s + (c.points || 0), 0)} pts</div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => insertLibraryRubric(entry)}>Insert</button>
                    <button type="button" className="btn btn-ghost btn-sm text-red-500" onClick={() => deleteLibraryRubric(entry.id)} title="Remove from library"><X size={14} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink3">No saved rubrics yet. Build a rubric below and click “Save current”.</p>
            )}
          </div>
        )}

        {rubric.length === 0 ? (
          <p className="text-xs text-ink3">No rubric set - max score defaults to 100.</p>
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
      )}

      {/* Groups builder */}
      {tab === 'groups' && (
      <div className="field mb-3">
        {roster.length === 0 ? (
          <p className="text-xs text-ink3">Select a class on the Details tab to load students.</p>
        ) : (
          <>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <label className="text-xs font-semibold text-ink2">{assignedIds.size} of {roster.length} students grouped</label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-ink3">Size</span>
              <input className="input" type="number" min={2} max={10} style={{ width: 56 }} value={groupSize}
                onChange={e => setGroupSize(Math.max(2, Math.min(10, parseInt(e.target.value) || 3)))} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={autoForm} disabled={autoForming}>
                <Sparkles size={12} className="inline-block mr-1" />{autoForming ? 'Forming…' : 'Auto-form'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addGroup}>+ Add group</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasteOpen(true)} style={{ color: 'var(--accent)' }}>
                <ClipboardPaste size={12} className="inline-block mr-1" />Custom groups
              </button>
            </div>
          </div>

          {roster.filter(s => !assignedIds.has(s.id)).length > 0 && (
            <div className="mb-2 px-3 py-2 rounded-lg" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <div className="text-xs text-ink3 mb-1">Unassigned students</div>
              <div className="flex flex-wrap gap-1">
                {roster.filter(s => !assignedIds.has(s.id)).map(s => (
                  <span key={s.id} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>{s.name}</span>
                ))}
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <p className="text-xs text-ink3">No groups yet - click “Auto-form” or “+ Add group”, then click student names to assign them.</p>
          ) : (
            <div className="flex flex-col gap-2" style={{ maxHeight: '48vh', overflowY: 'auto', paddingRight: 4 }}>
              {groups.map(g => (
                <div key={g.id} className="px-3 py-2.5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <input className="input" style={{ flex: 1, fontSize: 13, fontWeight: 600 }} value={g.name} onChange={e => renameGroup(g.id, e.target.value)} />
                    <span className="text-xs text-ink3">{(g.memberIds || []).length}</span>
                    <button type="button" className="btn btn-ghost btn-sm text-red-500" onClick={() => removeGroup(g.id)}><X size={14} /></button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {roster.map(s => {
                      const inGroup = (g.memberIds || []).includes(s.id)
                      const elsewhere = !inGroup && assignedIds.has(s.id)
                      return (
                        <button key={s.id} type="button" onClick={() => toggleMember(g.id, s.id)}
                          title={elsewhere ? 'In another group - click to move here' : ''}
                          style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                            background: inGroup ? 'var(--accent-l)' : 'var(--surface2)',
                            color: inGroup ? 'var(--accent)' : elsewhere ? 'var(--ink3)' : 'var(--ink2)',
                            border: `1px solid ${inGroup ? 'var(--accent)' : 'var(--border)'}`,
                            opacity: elsewhere ? 0.55 : 1,
                          }}>
                          {s.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          </>
        )}
      </div>
      )}

      {pasteOpen && (
        <CustomGroupsPanel
          roster={roster}
          allStudents={students}
          classes={classes}
          semester={semester}
          classMeta={{ courseName: selectedClass?.name, subject, section: selectedClass?.section }}
          onApply={g => { setGroups(g); setPasteOpen(false) }}
          onClose={() => setPasteOpen(false)}
        />
      )}

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
  const { students, activities, saveStudents, db, fbReady, logAudit, latePolicy } = useData()
  const { toast, openDialog } = useUI()
  const [scores,        setScores]       = useState({})
  const [feedbacks,     setFeedbacks]    = useState({}) // { [studentId]: string } - professor feedback
  const [rubricChecks,  setRubricChecks] = useState({}) // { [studentId]: { [criterionId]: bool } }
  const [waived,        setWaived]       = useState({}) // { [studentId]: bool } - late penalty waived
  const [smartFor,    setAiFor]    = useState(null)  // studentId for grading assist
  const [smartText,   setAiText]   = useState('')
  const [smartBusy,   setAiBusy]   = useState(false)
  const [smartResult, setAiResult] = useState(null)  // { score, feedback, criteria }
  const [docFetching, setDocFetching] = useState(false) // pulling text from a pasted Doc link
  const [saving,        setSaving]       = useState({})
  const [savingAll,     setSavingAll]    = useState(false)
  const [fbSaveState,   setFbSaveState]  = useState({}) // sid → 'saving' | 'saved' (feedback note autosave)
  const [scoreSaveState, setScoreSaveState] = useState({}) // sid → 'saving' | 'saved' (score autosave)
  const fbTimers = useRef({})            // sid → debounce timer id for feedback autosave
  const scoreTimers = useRef({})         // sid → debounce timer id for score autosave
  const saveScoreRef = useRef(null)      // always points at the latest handleSaveScore (fresh state)
  // Cancel any pending autosaves when the modal closes.
  useEffect(() => () => {
    Object.values(fbTimers.current).forEach(t => clearTimeout(t))
    Object.values(scoreTimers.current).forEach(t => clearTimeout(t))
  }, [])

  // Group case-study grading state
  const isGroupAct = !!act.isGroup
  const [groupText, setGroupText] = useState(() => {
    const m = {}
    ;(act.groups || []).forEach(g => { m[g.id] = act.groupSubmissions?.[g.id]?.text || '' })
    return m
  })
  const [groupResults, setGroupResults] = useState({}) // { [groupId]: { score, feedback, relevance, copies, criteria } }
  const [gradingGroups, setGradingGroups] = useState(false)

  const hasRubric = !!(act.rubric?.length)

  const now    = Date.now()
  const isPast = act.deadline < now
  const cls    = act.classId
  const dlLabel = new Date(act.deadline).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

  const enrolledStudents = useMemo(
    () => sortByLastName(students.filter(s => s.classId === act.classId && s.account?.registered)),
    [students, act.classId]
  )
  const idName = useMemo(() => Object.fromEntries((students || []).map(s => [s.id, s.name])), [students])

  const submitted = Object.values(act.submissions || {}).filter(s => s.link).length
  const graded    = Object.values(act.submissions || {}).filter(s => s.score != null).length

  const timeLeft = useMemo(() => {
    if (isPast) return null
    const mins = Math.max(0, Math.floor((act.deadline - now) / 60000))
    if (mins >= 1440) { const d = Math.floor(mins / 1440); const h = Math.floor((mins % 1440) / 60); return h ? `${d}d ${h}h` : `${d}d` }
    if (mins >= 60)   { const h = Math.floor(mins / 60); const m = mins % 60; return m ? `${h}h ${m}m` : `${h}h` }
    return mins + 'm'
  }, [act.deadline, isPast, now])

  function toggleRubricCheck(studentId, criterionId) {
    setRubricChecks(prev => {
      const cur = prev[studentId] || {}
      const updated = { ...cur, [criterionId]: !cur[criterionId] }
      const autoScore = act.rubric.reduce((s, c) => s + (updated[c.id] ? (parseFloat(c.points) || 0) : 0), 0)
      setScores(s => ({ ...s, [studentId]: String(autoScore) }))
      return { ...prev, [studentId]: updated }
    })
    const stud = enrolledStudents.find(x => x.id === studentId)
    if (stud) scheduleScoreSave(stud)
  }

  // Save a student's score. `silent` (autosave) reports via the Saving/Saved chip
  // instead of a toast, and does NOT flush the feedback field (feedback has its
  // own autosave, so a stale value here could clobber it). Failures always toast,
  // since a dropped grade write must never be invisible.
  async function handleSaveScore(s, { silent = false } = {}) {
    const raw = scores[s.id]
    if (raw === undefined || raw === '') return
    const score = parseFloat(raw)
    if (isNaN(score) || score < 0 || score > act.maxScore) {
      if (!silent) toast('Score must be 0-' + act.maxScore, 'red')
      return
    }
    if (!fbReady || !db.current) { if (!silent) toast('Firebase not connected.', 'red'); return }

    const rubricSnapshot = hasRubric ? (rubricChecks[s.id] || {}) : undefined

    // Late penalty: deduct from the entered score unless the deadline was met or
    // the professor waived it. The effective (penalized) score is what gets stored.
    const sub = (act.submissions || {})[s.id] || {}
    const li  = lateInfo(sub, act, latePolicy)
    const eff = applyLatePenalty(score, sub, act, latePolicy, waived[s.id])
    const penalized = li.late && !waived[s.id] && eff !== score
    const wasUngraded = sub.score == null

    if (silent) setScoreSaveState(prev => ({ ...prev, [s.id]: 'saving' }))
    else setSaving(prev => ({ ...prev, [s.id]: true }))
    try {
      const update = {
        [`submissions.${s.id}.score`]:  eff,
        [`submissions.${s.id}.graded`]: true,
        // Record the penalty for transparency, or clear a stale one.
        [`submissions.${s.id}.latePenalty`]: penalized ? { percent: li.percent, days: li.days, rawScore: score } : null,
      }
      if (rubricSnapshot !== undefined) update[`submissions.${s.id}.rubricChecks`] = rubricSnapshot
      // Only an explicit (non-silent) save also flushes a touched feedback field.
      if (!silent && feedbacks[s.id] !== undefined) update[`submissions.${s.id}.feedback`] = feedbacks[s.id].trim()
      await updateDoc(doc(db.current, 'activities', act.id), update)
      // Recompute the student's grade against the effective score (patch the
      // in-memory activity so the new score is reflected immediately).
      const patchedActs = activities.map(a => a.id === act.id
        ? { ...a, submissions: { ...(a.submissions || {}), [s.id]: { ...sub, score: eff, graded: true } } }
        : a)
      const updated = buildUpdatedStudent(s, act.subject, act.classId, patchedActs, students)
      if (updated) await saveStudents(students.map(x => x.id === s.id ? updated : x), [s.id])
      // Notify the student once, only on the first grade (autosave tweaks don't
      // re-notify); the grade also shows live in their Activities tab.
      if (fbReady && db.current && wasUngraded) {
        pushStudentNotif(db.current, s.id, `Activity graded: ${act.title}`, `${act.subject} - Score: ${eff}/${act.maxScore}${penalized ? ` (late −${li.percent}%)` : ''}`, 'act_grade', 'activities')
      }
      if (silent) {
        setScoreSaveState(prev => ({ ...prev, [s.id]: 'saved' }))
        setTimeout(() => setScoreSaveState(prev => { const n = { ...prev }; if (n[s.id] === 'saved') delete n[s.id]; return n }), 2000)
      } else {
        toast(penalized ? `Saved with late penalty (−${li.percent}%): ${eff}/${act.maxScore}` : 'Score saved!', 'green')
      }
    } catch (e) {
      if (silent) setScoreSaveState(prev => { const n = { ...prev }; delete n[s.id]; return n })
      toast('Could not save score: ' + e.message, 'red')
    } finally {
      if (!silent) setSaving(prev => ({ ...prev, [s.id]: false }))
    }
  }
  // Keep the ref pointing at THIS render's handleSaveScore so the debounced timer
  // always runs against fresh state (scores/waived/rubricChecks), never a stale closure.
  saveScoreRef.current = handleSaveScore

  // Debounced score autosave: ~900ms after the last score/rubric/waive change.
  function scheduleScoreSave(s) {
    clearTimeout(scoreTimers.current[s.id])
    scoreTimers.current[s.id] = setTimeout(() => { saveScoreRef.current?.(s, { silent: true }) }, 900)
  }
  function onScoreChange(s, val) {
    setScores(prev => ({ ...prev, [s.id]: val }))
    if (val !== '' && !isNaN(parseFloat(val))) scheduleScoreSave(s)
  }

  // Auto-save professor feedback notes ~1.1s after typing stops (debounced),
  // independent of the Score button. Writes ONLY the feedback field, so it can
  // never touch the grade. A per-student chip shows Saving.../Saved.
  function onFeedbackChange(sid, val) {
    setFeedbacks(prev => ({ ...prev, [sid]: val }))
    clearTimeout(fbTimers.current[sid])
    fbTimers.current[sid] = setTimeout(async () => {
      if (!fbReady || !db.current) return
      setFbSaveState(prev => ({ ...prev, [sid]: 'saving' }))
      try {
        await updateDoc(doc(db.current, 'activities', act.id), { [`submissions.${sid}.feedback`]: val.trim() })
        setFbSaveState(prev => ({ ...prev, [sid]: 'saved' }))
        setTimeout(() => setFbSaveState(prev => { const n = { ...prev }; if (n[sid] === 'saved') delete n[sid]; return n }), 2000)
      } catch {
        setFbSaveState(prev => { const n = { ...prev }; delete n[sid]; return n })
      }
    }, 1100)
  }

  async function handleApplyDefault() {
    const missed = enrolledStudents.filter(s => !(act.submissions || {})[s.id]?.link)
    if (!missed.length) { toast('All registered students have already submitted.', 'green'); return }
    // Never exceed the activity's max (rubric totals can be < 50, and a score
    // above max would push the activity component over 100%).
    const defScore = Math.min(50, act.maxScore || 100)
    const ok = await openDialog({
      title: 'Apply default score?',
      msg: `This will give ${missed.length} student${missed.length !== 1 ? 's' : ''} a score of ${defScore}/${act.maxScore}.`,
      type: 'warning',
      confirmLabel: 'Apply Score',
      showCancel: true,
    })
    if (!ok) return

    const updates = {}
    missed.forEach(s => {
      updates[`submissions.${s.id}.score`]      = defScore
      updates[`submissions.${s.id}.graded`]     = true
      updates[`submissions.${s.id}.autoGraded`] = true
    })
    try {
      await updateDoc(doc(db.current, 'activities', act.id), updates)
      const updatedStudents = students.map(s => {
        if (!missed.find(x => x.id === s.id)) return s
        const updatedActs = activities.map(a =>
          a.id === act.id
            ? { ...a, submissions: { ...a.submissions, [s.id]: { ...(a.submissions || {})[s.id], score: defScore, graded: true } } }
            : a
        )
        const updated = buildUpdatedStudent(s, act.subject, act.classId, updatedActs, students)
        return updated || s
      })
      await saveStudents(updatedStudents, missed.map(s => s.id))
      toast(`Applied score of ${defScore} to ${missed.length} student${missed.length !== 1 ? 's' : ''}.`, 'green')
      if (fbReady && db.current) {
        for (const s of missed) {
          pushStudentNotif(db.current, s.id, `Activity graded: ${act.title}`, `${act.subject} - Score: ${defScore}/${act.maxScore}`, 'act_grade', 'activities')
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
      const effById = {}        // effective (penalized) score per student
      let penalizedCount = 0
      toSave.forEach(s => {
        const score = parseFloat(scores[s.id])
        const sub   = (act.submissions || {})[s.id] || {}
        const li    = lateInfo(sub, act, latePolicy)
        const eff   = applyLatePenalty(score, sub, act, latePolicy, waived[s.id])
        const penalized = li.late && !waived[s.id] && eff !== score
        if (penalized) penalizedCount++
        effById[s.id] = eff
        update[`submissions.${s.id}.score`]  = eff
        update[`submissions.${s.id}.graded`] = true
        update[`submissions.${s.id}.latePenalty`] = penalized ? { percent: li.percent, days: li.days, rawScore: score } : null
        if (hasRubric) update[`submissions.${s.id}.rubricChecks`] = rubricChecks[s.id] || {}
        if (feedbacks[s.id] !== undefined) update[`submissions.${s.id}.feedback`] = feedbacks[s.id].trim()
      })
      await updateDoc(doc(db.current, 'activities', act.id), update)
      // Patch this activity's submissions with the effective scores so the
      // grade recompute reflects the penalties immediately.
      const patchedSubs = { ...(act.submissions || {}) }
      toSave.forEach(s => { patchedSubs[s.id] = { ...(patchedSubs[s.id] || {}), score: effById[s.id], graded: true } })
      const patchedActs = activities.map(a => a.id === act.id ? { ...a, submissions: patchedSubs } : a)
      const updatedStudents = students.map(s => {
        if (!toSave.find(x => x.id === s.id)) return s
        const updated = buildUpdatedStudent(s, act.subject, act.classId, patchedActs, students)
        return updated || s
      })
      await saveStudents(updatedStudents, toSave.map(s => s.id))
      toast(`Saved grades for ${toSave.length} student${toSave.length !== 1 ? 's' : ''}.${penalizedCount ? ` ${penalizedCount} late-penalized.` : ''}`, 'green')
      if (fbReady && db.current) {
        for (const s of toSave) {
          pushStudentNotif(db.current, s.id, `Activity graded: ${act.title}`, `${act.subject} - Score: ${effById[s.id]}/${act.maxScore}`, 'act_grade', 'activities')
        }
      }
    } catch (e) {
      toast('Save failed: ' + e.message, 'red')
    } finally {
      setSavingAll(false)
    }
  }

  async function runAiGrade(studentId, textOverride) {
    const text = (textOverride != null ? textOverride : smartText).trim()
    if (!text) { toast('Paste the student\'s submission text first.', 'warn'); return }
    setAiBusy(true); setAiResult(null)
    try {
      const res = await smartGrade({
        title: act.title, subject: act.subject, instructions: act.instructions,
        rubric: act.rubric, maxScore: act.maxScore, submissionText: text,
      })
      if (res) setAiResult(res)
      else toast('On-device Smart grading is unavailable on this device. Grade manually against the rubric.', 'warn', 7000)
    } catch (e) {
      toast('Smart grading error: ' + e.message, 'error', 7000)
    } finally { setAiBusy(false) }
  }

  // Phase B fallback for pasted-link submissions (no uploaded file to read):
  // ask the serverless proxy for the link's content, then grade. Google
  // Docs/Slides/Sheets come back as plain `text`; a Drive image/PDF comes back
  // as `binary` (base64) which we OCR/parse on-device with the SAME pipeline the
  // student-upload path uses, so a pasted Drive file link still gets scanned.
  async function fetchFromLink(link) {
    if (!link) return
    setDocFetching(true)
    try {
      const r = await fetch('/api/extract-doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link }) })
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.text) {
        setAiText(data.text)
        runAiGrade(smartFor, data.text)
        return
      }
      if (r.ok && data.binary) {
        const file = base64ToFile(data.binary, data.name || 'submission', data.mime || 'application/octet-stream')
        const ex = file ? await extractSubmissionText(file).catch(() => null) : null
        if (ex?.text) {
          setAiText(ex.text)
          runAiGrade(smartFor, ex.text)
        } else {
          toast('Could not read text from that file. Open it to grade manually, or paste the text.', 'warn', 7000)
        }
        return
      }
      toast(data.error || 'Could not read text from that link. Make sure it is shared, or paste it manually.', 'warn', 7000)
    } catch (e) {
      toast('Could not reach the text reader. Paste the work manually.', 'warn', 6000)
    } finally { setDocFetching(false) }
  }

  function applyAiGrade(studentId) {
    if (!smartResult) return
    const stud = enrolledStudents.find(x => x.id === studentId)
    setScores(prev => ({ ...prev, [studentId]: String(smartResult.score) }))
    // Pre-fill the feedback box with the Smart notes (autosaves like any feedback edit).
    if (smartResult.feedback) onFeedbackChange(studentId, smartResult.feedback)
    if (hasRubric && Array.isArray(smartResult.criteria)) {
      const checks = {}
      act.rubric.forEach(c => {
        const m = smartResult.criteria.find(x => (x.name || '').toLowerCase().trim() === c.name.toLowerCase().trim())
        if (m && m.met) checks[c.id] = true
      })
      setRubricChecks(prev => ({ ...prev, [studentId]: checks }))
    }
    if (stud) scheduleScoreSave(stud) // autosave the applied score + rubric
    setAiFor(null); setAiText(''); setAiResult(null)
    toast('Smart grade applied and saved.', 'green')
  }

  // Warm the on-device model when the grading modal opens.
  useEffect(() => { prewarmActivitySmart() }, [])

  // Auto-grade every group at once, then pre-fill each member's score/feedback/
  // rubric so the existing Save-All path persists it (per-member adjustable).
  async function runGroupGrade() {
    const groupsForAI = (act.groups || [])
      .map(g => ({ id: g.id, name: g.name, text: (groupText[g.id] || '').trim() }))
      .filter(g => g.text)
    if (!groupsForAI.length) { toast('Paste each group\'s submission text first.', 'warn'); return }
    setGradingGroups(true)
    try {
      const res = await smartGradeGroups({
        title: act.title, subject: act.subject, casePrompt: act.casePrompt,
        rubric: act.rubric, maxScore: act.maxScore, groups: groupsForAI,
      })
      if (!res) { toast('On-device Smart grading is unavailable on this device. Grade groups manually.', 'warn', 7000); return }
      const byId = {}; res.forEach(r => { byId[r.groupId] = r })
      setGroupResults(byId)
      const nextScores = {}, nextFb = {}, nextChecks = {}
      ;(act.groups || []).forEach(g => {
        const r = byId[g.id]; if (!r) return
        const checks = {}
        if (hasRubric && Array.isArray(r.criteria)) act.rubric.forEach(c => {
          const m = r.criteria.find(x => (x.name || '').toLowerCase().trim() === c.name.toLowerCase().trim())
          if (m && m.met) checks[c.id] = true
        })
        ;(g.memberIds || []).forEach(mid => {
          nextScores[mid] = String(r.score)
          nextFb[mid] = r.feedback
          if (hasRubric) nextChecks[mid] = checks
        })
      })
      setScores(prev => ({ ...prev, ...nextScores }))
      setFeedbacks(prev => ({ ...prev, ...nextFb }))
      if (hasRubric) setRubricChecks(prev => ({ ...prev, ...nextChecks }))
      toast('Draft group scores filled below - review, adjust members, then Save All.', 'green', 6000)
    } finally { setGradingGroups(false) }
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

  async function handleClone() {
    try {
      const id = actId()
      const copy = {
        ...act, id,
        title: `${act.title} (Copy)`,
        submissions: {},   // a fresh activity - no carried-over submissions
        createdAt: Date.now(),
        deadline: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }
      await setDoc(doc(db.current, 'activities', id), copy)
      logAudit?.({
        action: 'activity.clone',
        target: copy.title,
        summary: `Duplicated activity "${act.title}"`,
        meta: { from: act.id, to: id, subject: act.subject || null },
      })
      toast('Activity duplicated - due in 7 days. Edit to adjust.', 'green')
      onClose()
    } catch (e) {
      toast('Duplicate failed: ' + e.message, 'red')
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
      ? `${act.subject} - this activity is past due. Please submit as soon as you can.`
      : `${act.subject} - due ${dlLabel}. Don't forget to submit.`
    // In-app notifications (reliable) + best-effort web push.
    if (fbReady && db.current) {
      for (const id of ids) pushStudentNotif(db.current, id, title, body, 'act_grade', 'activities')
      sendPushToOwners(db.current, ids, { title, body }, { url: 'activities', tag: 'deadline-reminder' })
    }
    toast(`Reminder sent to ${ids.length} student${ids.length === 1 ? '' : 's'}.`, 'green')
  }

  return (
    <Modal onClose={onClose} size="lg">
      <div className="mb-1 pr-8">
        <h3 className="text-lg font-bold text-ink"><ClipboardList size={18} /> {act.title}</h3>
        <p className="text-xs text-ink2 mt-0.5">
          {act.subject} · Max {act.maxScore} pts · Deadline: {dlLabel}
        </p>
        <p className="text-xs text-ink2">
          {submitted}/{enrolledStudents.length} submitted · {graded} graded
        </p>
      </div>

      {/* Deadline banner */}
      {isPast ? (
        <div style={{ background: 'var(--red-l)', color: 'var(--red)', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <AlarmClock size={14} /> <strong>Deadline passed.</strong> Students can no longer submit.
        </div>
      ) : (
        <div style={{ background: 'var(--green-l)', color: 'var(--green)', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, fontWeight: 600, padding: '10px 14px', marginBottom: 12 }}>
          <CircleDot size={14} /> <strong>Open - {timeLeft} remaining.</strong> Students can still submit.
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

      {/* Group case-study panel */}
      {isGroupAct && (
        <div className="mb-3" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-xs font-semibold text-ink2"><Users size={14} className="inline-block mr-1" />Case-study groups · {(act.groups || []).length}</div>
            <button className="btn btn-primary btn-sm" onClick={runGroupGrade} disabled={gradingGroups}>
              <Sparkles size={13} className="inline-block mr-1" />{gradingGroups ? 'Grading…' : 'Smart grade all groups'}
            </button>
          </div>
          {act.casePrompt && (
            <div className="text-xs text-ink2 mb-2 p-2 rounded" style={{ background: 'var(--surface2)' }}><strong>Case:</strong> {act.casePrompt}</div>
          )}
          <div className="flex flex-col gap-2" style={{ maxHeight: '40vh', overflowY: 'auto', paddingRight: 4 }}>
            {(act.groups || []).map(g => {
              const r = groupResults[g.id]
              const memberNames = (g.memberIds || []).map(id => idName[id] || id)
              return (
                <div key={g.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-ink">{g.name}</span>
                    {r && <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>{r.score}/{act.maxScore}</span>}
                  </div>
                  <div className="text-xs text-ink3 mb-1.5">{memberNames.join(', ') || 'No members'}</div>
                  <textarea className="input w-full" rows={3} style={{ fontSize: 12 }}
                    placeholder="Paste this group's analysis (or it loads from their submission)…"
                    value={groupText[g.id] || ''} onChange={e => setGroupText(t => ({ ...t, [g.id]: e.target.value }))} />
                  {r && (
                    <div className="mt-1.5 text-xs" style={{ color: 'var(--ink2)' }}>
                      {r.relevance != null && (
                        <span style={{ marginRight: 8 }}>Case relevance: <strong style={{ color: r.relevance >= 0.5 ? 'var(--green)' : 'var(--yellow)' }}>{Math.round(r.relevance * 100)}%</strong></span>
                      )}
                      {r.copies?.length > 0 && (
                        <span style={{ color: 'var(--red)' }}><Copy size={11} className="inline-block mr-0.5" />Similar to {r.copies.join(', ')}</span>
                      )}
                      <div className="mt-1" style={{ color: 'var(--ink3)' }}>{r.feedback}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-ink3 mt-2">Draft scores fill each member's row below - review, adjust individuals if needed, then <strong>Save All</strong>.</p>
        </div>
      )}

      {/* Submissions table */}
      {!enrolledStudents.length ? (
        <EmptyState compact title="No registered students in this class yet." />
      ) : (
        <div className="act-review-list mb-3">
          {enrolledStudents.map(s => {
            const sub    = (act.submissions || {})[s.id] || {}
            const hasLink = !!sub.link
            const curScore = sub.score != null ? sub.score : ''
            const subDate = sub.submittedAt
              ? new Date(sub.submittedAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
              : null
            const inputVal = scores[s.id] !== undefined ? scores[s.id] : String(curScore)
            const checks = rubricChecks[s.id] || {}
            const li = lateInfo(sub, act, latePolicy)
            const fbState = fbSaveState[s.id]
            const scoreState = scoreSaveState[s.id]
            return (
              <div className="act-review-card" key={s.id}>
                <div className="flex items-center gap-2.5">
                  <div className="ar-avatar">{getInitials(s.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ar-name">{s.name}</div>
                    <div className="ar-sub">{s.id}{subDate ? ` · submitted ${subDate}` : ''}</div>
                  </div>
                  {hasLink
                    ? <Badge variant="green"><CheckCircle2 size={14} /> Submitted</Badge>
                    : <Badge variant="gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{isPast ? <><AlertCircle size={11} />Missed</> : <><Clock size={11} />Pending</>}</Badge>}
                </div>

                {hasLink && (
                  <div style={{ marginTop: 10 }}>
                    <SubmissionPreview link={sub.link} name={`${s.name} - ${act.title}`} compact fallbackLabel="Open submission" />
                  </div>
                )}

                {hasRubric && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ marginTop: 10 }}>
                    {act.rubric.map(c => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={!!(checks[c.id])} onChange={() => toggleRubricCheck(s.id, c.id)} style={{ accentColor: 'var(--c-accent)' }} />
                        {c.name} <span style={{ color: 'var(--ink3)' }}>({c.points}pt{c.points !== 1 ? 's' : ''})</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="flex gap-3 items-start flex-wrap" style={{ marginTop: 10 }}>
                  <div style={{ width: 130 }}>
                    <div className="ar-lbl flex items-center justify-between" style={{ gap: 6 }}>
                      <span>Score</span>
                      {scoreState === 'saving' && <span className="ar-save">Saving…</span>}
                      {scoreState === 'saved' && <span className="ar-save ar-save-ok"><Check size={11} /> Saved</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number" min="0" max={act.maxScore} value={inputVal}
                        className="ar-score-input"
                        onChange={e => onScoreChange(s, e.target.value)}
                        aria-label={`Score for ${s.name}`}
                        style={{ width: 64, padding: '6px 8px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 13, textAlign: 'center', background: 'var(--surface)', color: 'var(--ink)' }}
                        placeholder="-"
                      />
                      <span className="text-xs text-ink3">/ {act.maxScore}</span>
                    </div>
                    {li.late && (
                      <div style={{ marginTop: 5, fontSize: 10.5, lineHeight: 1.4, color: waived[s.id] ? 'var(--ink3)' : 'var(--red)' }}>
                        <AlarmClock size={10} /> {li.days}d late · −{li.percent}%
                        {inputVal !== '' && !isNaN(parseFloat(inputVal)) && !waived[s.id] && (
                          <span> → <strong>{applyLatePenalty(parseFloat(inputVal), sub, act, latePolicy, false)}</strong></span>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2, color: 'var(--ink2)', cursor: 'pointer', fontWeight: 600 }}>
                          <input type="checkbox" checked={!!waived[s.id]} onChange={() => { setWaived(p => ({ ...p, [s.id]: !p[s.id] })); scheduleScoreSave(s) }} style={{ width: 'auto', margin: 0 }} />
                          Waive penalty
                        </label>
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div className="ar-lbl flex items-center justify-between">
                      <span>Feedback note</span>
                      {fbState === 'saving' && <span className="ar-save">Saving…</span>}
                      {fbState === 'saved' && <span className="ar-save ar-save-ok"><Check size={11} /> Saved</span>}
                    </div>
                    <textarea
                      value={feedbacks[s.id] !== undefined ? feedbacks[s.id] : (sub.feedback || '')}
                      onChange={e => onFeedbackChange(s.id, e.target.value)}
                      placeholder="Notes save automatically as you type…"
                      aria-label={`Feedback for ${s.name}`}
                      rows={2}
                      style={{ width: '100%', padding: '6px 8px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12.5, lineHeight: 1.45, background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </div>
                </div>

                {hasLink && (
                  <div className="flex gap-1.5 items-center justify-end" style={{ marginTop: 10 }}>
                    <button className="btn btn-ghost btn-sm" title="Smart grading assistant" onClick={() => {
                      const t = sub.contentText || ''
                      setAiFor(s.id); setAiText(t); setAiResult(null)
                      if (t) runAiGrade(s.id, t) // auto-grade from the extracted submission text - no paste needed
                    }}>
                      <Sparkles size={13} /> Smart grade
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-ink3 mb-4">Scores and feedback notes save automatically as you type. The student's grade components update right away.</p>

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
        <button className="btn btn-ghost btn-sm" onClick={handleClone}><Copy size={16} /> Duplicate</button>
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>Close</button>
        <button className="btn btn-primary btn-sm" onClick={handleSaveAll} disabled={savingAll}>
          {savingAll ? 'Saving…' : <><Save size={16} /> Save All Grades</>}
        </button>
      </div>

      {smartFor && (() => {
        const stud = enrolledStudents.find(x => x.id === smartFor)
        const sub = (act.submissions || {})[smartFor] || {}
        return (
          <Modal onClose={() => setAiFor(null)} size="md">
            <h3 className="text-lg font-bold mb-1"><Sparkles size={16} className="inline-block mr-1 align-text-bottom" />Grading Assist <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'var(--green-l)', padding: '2px 8px', borderRadius: 999, marginLeft: 6, verticalAlign: 'middle' }}>on-device</span></h3>
            <p className="modal-sub">{stud?.name} · {act.title}</p>
            {sub.contentText ? (
              <div style={{ fontSize: 12, color: 'var(--green)', background: 'var(--green-l)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', margin: '8px 0 12px' }}>
                <Check size={13} className="inline-block mr-1 align-text-bottom" />Read automatically from the submitted file{sub.contentMeta?.method ? ` (${sub.contentMeta.method === 'ocr' ? 'image OCR' : sub.contentMeta.method.toUpperCase()})` : ''}. The score below is drafted from it - review and edit before applying. Nothing is uploaded.
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--ink2)', background: 'var(--accent-l)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', margin: '8px 0 12px' }}>
                This submission has no auto-read text (it is a pasted link, not an uploaded file). Open it, paste the work below, or pull the text from the link. On-device Smart grading drafts a score you review before saving. Nothing is uploaded.
              </div>
            )}
            {sub.link && (
              <div className="mb-2">
                <SubmissionPreview link={sub.link} name={`${stud?.name || 'Submission'} - ${act.title}`} compact fallbackLabel="Open submission" />
              </div>
            )}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {!sub.contentText && isDocLink(sub.link) && (
                <button className="btn btn-ghost btn-sm" onClick={() => fetchFromLink(sub.link)} disabled={docFetching}>
                  <ClipboardPaste size={13} className="inline-block mr-1" />{docFetching ? 'Reading…' : 'Pull text from link'}
                </button>
              )}
            </div>
            <textarea
              className="input w-full"
              rows={6}
              placeholder="Paste the student's submission text here…"
              value={smartText}
              onChange={e => setAiText(e.target.value)}
            />
            <div className="flex gap-2 mt-2">
              <button className="btn btn-primary btn-sm" onClick={() => runAiGrade(smartFor)} disabled={smartBusy || !smartText.trim()}>
                <Sparkles size={13} className="inline-block mr-1" />{smartBusy ? 'Assessing…' : (smartResult ? 'Re-run' : 'Suggest grade')}
              </button>
            </div>
            {smartResult && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  Suggested score: <span style={{ color: 'var(--accent)' }}>{smartResult.score} / {act.maxScore}</span>
                </div>
                {smartResult.feedback && <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, lineHeight: 1.6 }}>{smartResult.feedback}</div>}
                {hasRubric && smartResult.criteria?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {smartResult.criteria.map((c, i) => (
                      <div key={i} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: c.met ? 'var(--green)' : 'var(--ink3)', fontWeight: 700 }}>{c.met ? <Check size={14} /> : <X size={14} />}</span>{c.name}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <button className="btn btn-primary btn-sm" onClick={() => applyAiGrade(smartFor)}>Apply to score</button>
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

  // O(1) lookups instead of classes.find()/students.filter() per activity card.
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes])
  const studsByClass = useMemo(() => {
    const m = new Map()
    students.forEach(s => {
      if (!s.account?.registered) return
      const arr = m.get(s.classId); if (arr) arr.push(s); else m.set(s.classId, [s])
    })
    return m
  }, [students])

  const sorted = useMemo(
    () => [...activities].sort((a, b) => b.createdAt - a.createdAt),
    [activities]
  )

  const activeActs   = useMemo(() => sorted.filter(a => !classMap.get(a.classId)?.archived), [sorted, classMap])
  const archivedActs = useMemo(() => sorted.filter(a =>  classMap.get(a.classId)?.archived), [sorted, classMap])

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
    const cls       = classMap.get(act.classId)
    const subs      = studsByClass.get(act.classId) || []
    const isPast    = act.deadline < now
    const submitted = Object.values(act.submissions || {}).filter(s => s.link).length
    const graded    = Object.values(act.submissions || {}).filter(s => s.score != null).length
    const groupCount     = act.isGroup ? (act.groups || []).length : 0
    const groupsSubmitted = act.isGroup ? Object.values(act.groupSubmissions || {}).filter(g => g?.text).length : 0
    const dlLabel   = new Date(act.deadline).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    return (
      <div className="card card-pad">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <strong style={{ fontSize: 14 }}>{act.title}</strong>
              <Badge variant={isPast ? 'red' : 'green'}>{isPast ? 'Closed' : 'Open'}</Badge>
              <Badge variant="blue">{act.subject}</Badge>
              {act.isGroup && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--accent-l)', color: 'var(--accent)' }}>
                  <Users size={11} /> Group
                </span>
              )}
              {readOnly && <Badge variant="yellow">Archived</Badge>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
              {cls ? courseShort(cls.name) + ' ' + cls.section : '-'} · Max: {act.maxScore} pts
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>
              Deadline: {dlLabel} · {act.isGroup ? `${groupsSubmitted}/${groupCount} group${groupCount === 1 ? '' : 's'} submitted` : `${submitted}/${subs.length} submitted`} · {graded} graded
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
        <EmptyState
          Icon={ClipboardList}
          title="No activities posted yet"
          text='Click "New Activity" to get started.'
        />
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
