import React, { useState, useMemo, useRef, lazy, Suspense } from 'react'
import { doc, setDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { hashPassword } from '@/utils/crypto'
import { validateSnum } from '@/utils/validate'
import { getFbAuth } from '@/firebase/firebaseInit'
import { notifyStudentsBroadcast } from '@/firebase/messageNotify'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'
import Modal from '@/components/primitives/Modal'
import KebabMenu from '@/components/primitives/KebabMenu'
import { Download, Upload, FileDown, KeyRound, GraduationCap, CheckCircle2, Pencil, Plus, Save, BookOpen, Check, Users, ClipboardList, Hourglass, Send } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
import { buildStudentReportCard } from '@/export/reportCard'
import { exportStudentRosterExcel, exportStudentImportTemplate, parseStudentImportExcel } from '@/export/excelExport'
import { courseOptions } from '@/constants/courses'

const ExportPreviewModal = lazy(() => import('@/components/admin/modals/ExportPreviewModal'))

const PER_PAGE = 50
const DEFAULT_PASS = 'Welcome@2026'

// ── Add Student Modal ─────────────────────────────────────────────────
function AddStudentModal({ onClose }) {
  const { classes, students, saveStudents } = useData()
  const { toast } = useUI()

  const [name, setName]         = useState('')
  const [snum, setSnum]         = useState('')
  const [course, setCourse]     = useState('')
  const [year, setYear]         = useState('1st Year')
  const [section, setSection]   = useState('')
  const [classId, setClassId]   = useState('')
  const [extraIds, setExtraIds] = useState([])
  const [setPass, setSetPass]   = useState(false)
  const [initPass, setInitPass] = useState('')
  const [initEmail, setInitEmail] = useState('')
  const [err, setErr]           = useState('')
  const [passErr, setPassErr]   = useState('')
  const [saving, setSaving]     = useState(false)

  const otherClasses = classes.filter(c => !c.archived && c.id !== classId)

  function toggleExtra(cid) {
    setExtraIds(prev => prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid])
  }

  async function handleAdd() {
    setErr(''); setPassErr('')
    const id = snum.trim().toUpperCase()
    if (!name.trim()) { setErr('Full name is required.'); return }
    if (!id) { setErr('Student number is required.'); return }
    const snumErr = validateSnum(id)
    if (snumErr) { setErr(snumErr); return }
    if (!course.trim()) { setErr('Course/Program is required.'); return }
    if (students.find(s => s.id === id)) { setErr(`Student number "${id}" already exists.`); return }
    if (name && students.find(s => s.name.toLowerCase() === name.trim().toLowerCase())) {
      setErr('A student with this name already exists.'); return
    }

    let account
    if (setPass) {
      if (!initPass) { setPassErr('Please enter an initial password.'); return }
      if (initPass.length < 8) { setPassErr('Password must be at least 8 characters.'); return }
      if (!/[A-Z]/.test(initPass) || !/[0-9]/.test(initPass)) { setPassErr('Password must include at least one uppercase letter and one number.'); return }
      if (initEmail && !initEmail.includes('@')) { setPassErr('Please enter a valid email address.'); return }
      account = { registered: true, pass: await hashPassword(initPass), email: initEmail || '', _tempPass: true }
    } else {
      account = { registered: true, pass: await hashPassword(DEFAULT_PASS), email: '', _tempPass: true }
    }

    const allClassIds = [...new Set([classId, ...extraIds].filter(Boolean))]
    const grades = {}, attendance = {}, excuse = {}, gradeComponents = {}
    allClassIds.forEach(cid => {
      const cls = classes.find(c => c.id === cid)
      if (!cls) return
      cls.subjects.forEach(sub => {
        if (grades[sub] === undefined) grades[sub] = null
        if (!attendance[sub]) attendance[sub] = new Set()
        if (!excuse[sub]) excuse[sub] = new Set()
      })
    })

    // Section: explicit value, else inherit from the chosen primary class.
    const primaryCls = classes.find(c => c.id === classId)
    const finalSection = section.trim() || primaryCls?.section || ''

    setSaving(true)
    try {
      const newStudent = { id, name: name.trim().toUpperCase(), course: course.trim(), year, section: finalSection, classId: classId || null, classIds: allClassIds, grades, attendance, excuse, gradeComponents, account }
      await saveStudents([...students, newStudent], [id])
      toast('Student added!', 'green')
      onClose()
    } catch (e) {
      setErr('Failed to save student: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth={600}>
      <h3>Add New Student</h3>
      <p className="modal-sub">Fill in the student's details below.</p>
      {err && <div className="err-msg mb-3">{err}</div>}
      <div className="input-row">
        <div className="field">
          <label>Full Name <span className="text-red-500">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Juan dela Cruz" />
        </div>
        <div className="field">
          <label>Student Number <span className="text-red-500">*</span></label>
          <input value={snum} onChange={e => setSnum(e.target.value)} placeholder="2024-10001" maxLength={10} />
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Course / Program <span className="text-red-500">*</span></label>
          <select value={course} onChange={e => setCourse(e.target.value)}>
            <option value="">— Select course —</option>
            {courseOptions(course).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Year Level</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            <option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Section <span className="font-normal text-ink3">(used to verify enrollment — leave blank to inherit from primary class)</span></label>
        <input value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. 2A" maxLength={10} />
      </div>
      <div className="field">
        <label>Primary Class <span className="font-normal text-ink3">(home class for grades &amp; attendance)</span></label>
        <select value={classId} onChange={e => { setClassId(e.target.value); setExtraIds(prev => prev.filter(x => x !== e.target.value)) }}>
          <option value="">— Select Class —</option>
          {classes.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name} · {c.section}</option>)}
        </select>
      </div>

      {otherClasses.length > 0 && (
        <div className="field mb-2">
          <label className="flex items-center justify-between">
            <span>Additional Classes <span className="font-normal text-ink3">(also enrolled in)</span></span>
            <span className="text-xs text-ink3 font-normal">Tick all that apply</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5 bg-bg border border-border rounded-lg p-2 mt-1 max-h-40 overflow-y-auto">
            {otherClasses.map(c => (
              <label key={c.id} className="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-bg2 text-xs">
                <input type="checkbox" checked={extraIds.includes(c.id)} onChange={() => toggleExtra(c.id)} style={{ width: 'auto', margin: 0, marginTop: 2, flexShrink: 0 }} />
                <span>
                  <span className="font-semibold text-ink block">{c.name} · {c.section}</span>
                  <span className="text-ink3">{c.subjects?.join(', ') || 'No subjects'}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Initial Password */}
      <div className="border-t border-border mt-2 pt-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs font-bold text-ink"><KeyRound size={14} /> Initial Password</div>
            <div className="text-xs text-ink3 mt-0.5">
              Default: <code className="font-mono text-ink">Welcome@2026</code> — student must change on first login.
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-accent cursor-pointer">
            <input type="checkbox" checked={setPass} onChange={e => setSetPass(e.target.checked)} style={{ width: 'auto', margin: 0 }} />
            Set custom password
          </label>
        </div>
        {setPass && (
          <div className="input-row">
            <div className="field">
              <label>Initial Password <span className="text-red-500">*</span></label>
              <input type="text" value={initPass} onChange={e => setInitPass(e.target.value)} placeholder="e.g. Welcome@2026" autoComplete="new-password" />
              <div className="text-xs text-ink3 mt-1">Min. 8 chars · 1 uppercase · 1 number</div>
            </div>
            <div className="field">
              <label>Student Email</label>
              <input type="email" value={initEmail} onChange={e => setInitEmail(e.target.value)} placeholder="student@email.com" />
              <div className="text-xs text-ink3 mt-1">Enables forgot-password via OTP</div>
            </div>
          </div>
        )}
        {passErr && <div className="err-msg">{passErr}</div>}
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
          {saving ? 'Adding…' : <><Plus size={16} /> Add Student</>}
        </button>
      </div>
    </Modal>
  )
}

// ── Edit Student Modal ────────────────────────────────────────────────
function EditStudentModal({ student, onClose }) {
  const { classes, students, saveStudents, deleteStudent } = useData()
  const { toast } = useUI()

  const [name, setName]       = useState(student.name || '')
  const [snum, setSnum]       = useState(student.id || '')
  const isRegistered = !!student.account?.registered
  const [course, setCourse]   = useState(student.course || '')
  const [year, setYear]       = useState(student.year || '1st Year')
  const [section, setSection] = useState(student.section || '')
  const [classId, setClassId] = useState(student.classId || '')
  const [extraIds, setExtraIds] = useState(
    (student.classIds || []).filter(id => id !== student.classId)
  )
  const [err, setErr]         = useState('')
  const [saving, setSaving]   = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])
  const otherClasses  = useMemo(() => activeClasses.filter(c => c.id !== classId), [activeClasses, classId])

  const allSubjects = useMemo(() => {
    const allIds = [...new Set([classId, ...extraIds].filter(Boolean))]
    const subs = new Set()
    allIds.forEach(cid => { const c = classes.find(x => x.id === cid); if (c) c.subjects?.forEach(s => subs.add(s)) })
    return [...subs]
  }, [classId, extraIds, classes])

  function toggleExtra(cid) {
    setExtraIds(prev => prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid])
  }

  async function handleSave() {
    setErr('')
    const trimName = name.trim()
    const trimSnum = snum.trim().toUpperCase()
    if (!trimName) { setErr('Full name is required.'); return }
    if (!course.trim()) { setErr('Course is required.'); return }

    // Student number can only be changed before the student has an account,
    // because their login email is derived from it.
    const snumChanged = !isRegistered && trimSnum !== student.id
    if (snumChanged) {
      const sErr = validateSnum(trimSnum)
      if (sErr) { setErr(sErr); return }
      if (students.some(s => s.id === trimSnum)) { setErr(`Student number "${trimSnum}" already exists.`); return }
    }

    const newClassId = classId || null
    const allClassIds = [...new Set([newClassId, ...extraIds].filter(Boolean))]
    const finalId = snumChanged ? trimSnum : student.id

    const primaryCls = classes.find(c => c.id === newClassId)
    const finalSection = section.trim() || primaryCls?.section || ''
    const ns = { ...student, id: finalId, name: trimName.toUpperCase(), course: course.trim(), year, section: finalSection, classId: newClassId, classIds: allClassIds, grades: { ...student.grades }, attendance: { ...student.attendance }, excuse: { ...student.excuse } }
    if (student.gradeComponents) ns.gradeComponents = { ...student.gradeComponents }
    allClassIds.forEach(cid => {
      const cls = classes.find(c => c.id === cid)
      if (!cls) return
      cls.subjects.forEach(sub => {
        if (ns.grades[sub] === undefined)  ns.grades[sub] = null
        if (!ns.attendance[sub])           ns.attendance[sub] = new Set()
        if (!ns.excuse[sub])               ns.excuse[sub] = new Set()
      })
    })

    setSaving(true)
    try {
      if (snumChanged) {
        // Re-key the record: remove the old doc, write under the new number.
        const newList = students.filter(s => s.id !== student.id).concat(ns)
        await deleteStudent(student.id)
        await saveStudents(newList, [finalId])
      } else {
        const updatedStudents = students.map(s => s.id === student.id ? ns : s)
        await saveStudents(updatedStudents, [finalId])
      }
      toast('Student updated!', 'green')
      onClose()
    } catch (e) {
      setErr('Saved locally but Firebase sync failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth={600}>
      <h3><Pencil size={18} /> Edit Student</h3>
      <p className="modal-sub">Update student information.{isRegistered ? ' The student number is locked once the student has an account.' : ''}</p>
      {err && <div className="err-msg mb-3">{err}</div>}
      <div className="input-row">
        <div className="field">
          <label>Full Name <span className="text-red-500">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Juan dela Cruz" />
        </div>
        <div className="field">
          <label>Student Number {isRegistered
            ? <span className="text-ink3 font-normal">(locked — student has an account)</span>
            : <span className="text-red-500">*</span>}</label>
          <input
            value={snum}
            onChange={e => setSnum(e.target.value)}
            readOnly={isRegistered}
            maxLength={15}
            style={isRegistered ? { background: 'var(--border)', color: 'var(--ink2)', cursor: 'not-allowed' } : {}}
          />
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Course / Program <span className="text-red-500">*</span></label>
          <select value={course} onChange={e => setCourse(e.target.value)}>
            <option value="">— Select course —</option>
            {courseOptions(course).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Year Level</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            <option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label>Section <span className="font-normal text-ink3">(used to verify enrollment — leave blank to inherit from primary class)</span></label>
        <input value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. 2A" maxLength={10} />
      </div>

      <div className="field">
        <label>Primary Class <span className="font-normal text-ink3">(home class for grades &amp; attendance)</span></label>
        <select value={classId} onChange={e => { setClassId(e.target.value); setExtraIds(prev => prev.filter(x => x !== e.target.value)) }}>
          <option value="">— Unassigned —</option>
          {activeClasses.map(c => <option key={c.id} value={c.id}>{c.name} · {c.section}</option>)}
        </select>
      </div>

      {otherClasses.length > 0 && (
        <div className="field mb-2">
          <label className="flex items-center justify-between">
            <span>Additional Classes <span className="font-normal text-ink3">(also enrolled in)</span></span>
            <span className="text-xs text-ink3 font-normal">Tick all that apply</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5 bg-bg border border-border rounded-lg p-2 mt-1 max-h-40 overflow-y-auto">
            {otherClasses.map(c => (
              <label key={c.id} className="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-bg2 text-xs">
                <input type="checkbox" checked={extraIds.includes(c.id)} onChange={() => toggleExtra(c.id)} style={{ width: 'auto', margin: 0, marginTop: 2, flexShrink: 0 }} />
                <span>
                  <span className="font-semibold text-ink block">{c.name} · {c.section}</span>
                  <span className="text-ink3">{c.subjects?.join(', ') || 'No subjects'}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {allSubjects.length > 0 && (
        <div className="text-xs text-ink2 bg-accent-l rounded-lg px-3 py-2 mb-3">
          <strong className="text-accent"><BookOpen size={14} /> Enrolled subjects ({allSubjects.length}):</strong>{' '}
          {allSubjects.map(s => (
            <span key={s} className="inline-block bg-surface border border-border rounded px-1.5 py-0.5 mx-0.5">{s}</span>
          ))}
        </div>
      )}

      <div className="field">
        <label>Account Status</label>
        <div className="py-2">
          {!student.account?.registered
            ? <Badge variant="gray">No account yet</Badge>
            : student.account?.activated
              ? <Badge variant="green"><CheckCircle2 size={14} /> Active ({student.account.email || '—'})</Badge>
              : <Badge variant="yellow"><Hourglass size={14} /> Pending — not yet activated</Badge>}
          {student.account?.firstLoginAt && (
            <div className="text-xs text-ink3 mt-1">
              First login: {new Date(student.account.firstLoginAt).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })}
            </div>
          )}
        </div>
      </div>

      {/* Academic History */}
      {(student.archivedSemesters?.length > 0) && (
        <div className="border-t border-border pt-3 mt-1">
          <button
            type="button"
            className="flex items-center gap-2 text-xs font-semibold text-ink2 hover:text-ink transition-colors mb-2"
            onClick={() => setHistoryOpen(v => !v)}
          >
            <span>{historyOpen ? '▾' : '▸'}</span>
            <ClipboardList size={14} /> Academic History ({student.archivedSemesters.length} archived semester{student.archivedSemesters.length !== 1 ? 's' : ''})
          </button>
          {historyOpen && (
            <div className="flex flex-col gap-3">
              {[...student.archivedSemesters].reverse().map((entry, i) => (
                <div key={i} className="bg-surface2 border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                    <div>
                      <div className="text-xs font-bold text-ink">{entry.semester}</div>
                      <div className="text-xs text-ink3">{entry.className} · {entry.section}</div>
                    </div>
                    <div className="text-xs text-ink3">
                      Archived {new Date(entry.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(entry.subjects || {}).map(([sub, data]) => (
                      <div key={sub} className="text-xs bg-bg border border-border rounded px-2 py-1">
                        <span className="font-semibold text-ink">{sub}</span>
                        {data.grade != null && (
                          <span className="ml-1.5 text-ink2">
                            {typeof data.grade === 'number' ? data.grade.toFixed(2) : data.grade}
                          </span>
                        )}
                        {data._att?.length > 0 && (
                          <span className="ml-1 text-ink3">· {data._att.length} attendance records</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : <><Save size={16} /> Save Changes</>}
        </button>
      </div>
    </Modal>
  )
}

// ── Reset Password Modal ──────────────────────────────────────────────
// Live, coordinated reset. The teacher opens a short reset window for one
// student; the student's own device claims a fresh temporary password and is
// signed in automatically. No password is shown to or stored by the teacher.
function ResetPasswordModal({ student, onClose }) {
  const { toast } = useUI()

  const [saving, setSaving] = useState(false)
  const [opened, setOpened] = useState(false)
  const [err, setErr]       = useState('')

  async function handleOpenSession() {
    setSaving(true)
    setErr('')
    try {
      const user = getFbAuth()?.currentUser
      if (!user) throw new Error('Your session expired. Please sign in again.')
      const idToken = await user.getIdToken()

      const r = await fetch('/api/admin-open-reset-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, studentNumber: student.id }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Could not open reset session')

      setOpened(true)
      toast('Reset window opened. The student can now claim it (valid 10 minutes).', 'green')
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth={440}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={20} />Reset Password</h3>

      {!opened ? (
        <>
          <p className="modal-sub">
            This starts a live reset for <strong>{student.name}</strong> (#{student.id}).
            The student sets their own new password on their device — you never have to
            handle or share one.
          </p>

          <div className="field mb-4 p-3 rounded-xl bg-bg2 text-sm text-ink2" style={{ lineHeight: 1.6 }}>
            <strong className="text-ink">Before you click:</strong> ask the student to open the
            login screen → <em>Forgot Password</em> → enter their student number and tap
            <em> Start</em>. Then open the window below. Within a few seconds they'll be prompted
            to choose a new password, then signed in.
          </div>

          {err && <div className="err-msg mb-3">{err}</div>}

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleOpenSession} disabled={saving}>
              {saving ? 'Opening…' : 'Open Reset Window'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="modal-sub" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--green)' }} />
            <span>
              Reset window is <strong>open for 10 minutes</strong>. As soon as
              <strong> {student.name}</strong> taps <em>Start</em> on their Forgot Password screen,
              they'll be prompted to set a new password and signed in automatically.
            </span>
          </p>
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── CSV helpers ───────────────────────────────────────────────────────
function exportRosterCSV(students, classes) {
  const headers = ['Student No.', 'Full Name', 'Course', 'Year Level', 'Date of Birth', 'Mobile', 'Primary Class', 'Email', 'Account Status']
  const rows = students.map(s => {
    const cls = classes.find(c => c.id === s.classId)
    return [s.id, (s.name || '').toUpperCase(), s.course || '', s.year || '', s.dob || '', s.mobile || '', cls ? `${cls.name} ${cls.section}` : '', s.account?.email || '', !s.account?.registered ? 'No Account' : s.account?.activated ? 'Active' : 'Pending']
  })
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `students_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const parseRow = (line) => {
    const result = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
      else if (c === ',' && !inQ) { result.push(cur.trim()); cur = '' }
      else cur += c
    }
    result.push(cur.trim())
    return result
  }
  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const colMap = { id: ['studentno', 'sno', 'id', 'studentnumber', 'stuno'], name: ['fullname', 'name', 'studentname'], course: ['course', 'courseprogram', 'program', 'coursename'], year: ['yearlevel', 'year', 'yearlvl'], dob: ['dateofbirth', 'dob', 'birthdate', 'birthday'], mobile: ['mobile', 'mobilenumber', 'phone', 'contact'] }
  function getCol(key) { return colMap[key].reduce((found, alias) => found ?? headers.indexOf(alias), undefined) }
  const idxs = Object.fromEntries(Object.keys(colMap).map(k => [k, getCol(k)]))
  return lines.slice(1).map(line => {
    const v = parseRow(line)
    return Object.fromEntries(Object.keys(idxs).map(k => [k, idxs[k] >= 0 ? (v[idxs[k]] || '').trim() : '']))
  }).filter(r => Object.values(r).some(v => v))
}

// ── Import Students Modal ─────────────────────────────────────────────
function ImportStudentsModal({ onClose }) {
  const { classes, students, saveStudents } = useData()
  const { toast } = useUI()
  const fileRef = useRef(null)
  const [rows, setRows]     = useState([])
  const [errors, setErrors] = useState({})
  const [fileName, setFileName] = useState('')
  const [saving, setSaving] = useState(false)

  function validateRows(parsed) {
    const errs = {}
    parsed.forEach((r, i) => {
      const id = (r.id || '').toUpperCase()
      if (!id)                        errs[i] = 'Missing student number'
      else if (!r.name)               errs[i] = 'Missing full name'
      else if (!r.course)             errs[i] = 'Missing course'
      else if (validateSnum(id))      errs[i] = validateSnum(id)
      else if (students.find(s => s.id === id)) errs[i] = `Student no. "${id}" already exists`
      else {
        const dupIdx = parsed.findIndex((x, j) => j < i && (x.id || '').toUpperCase() === id)
        if (dupIdx >= 0) errs[i] = `Duplicate student no. in file (row ${dupIdx + 2})`
      }
    })
    setRows(parsed)
    setErrors(errs)
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    const isExcel = /\.xlsx?$/i.test(file.name)
    try {
      if (isExcel) {
        const XLSX = window.XLSX
        if (!XLSX) { toast('Excel reader (SheetJS) not loaded.', 'red'); return }
        const buf = await file.arrayBuffer()
        const wb  = XLSX.read(buf, { type: 'array' })
        validateRows(parseStudentImportExcel(wb))
      } else {
        const text = await file.text()
        validateRows(parseCSV(text))
      }
    } catch (err) {
      toast('Could not read file: ' + err.message, 'red')
    }
  }

  const validRows  = rows.filter((_, i) => !errors[i])
  const invalidRows = rows.filter((_, i) => errors[i])

  async function handleImport() {
    if (!validRows.length) return
    setSaving(true)
    try {
      const newStudents = await Promise.all(validRows.map(async r => {
        const id = r.id.toUpperCase()
        const allClassIds = []
        const grades = {}, attendance = {}, excuse = {}, gradeComponents = {}
        return { id, name: (r.name || '').toUpperCase(), course: r.course, year: r.year || '1st Year', section: r.section || '', mobile: r.mobile || '', dob: r.dob || '', classId: null, classIds: allClassIds, grades, attendance, excuse, gradeComponents, account: { registered: true, pass: await hashPassword(DEFAULT_PASS), email: '', _tempPass: true } }
      }))
      await saveStudents([...students, ...newStudents], newStudents.map(s => s.id))
      toast(`Imported ${newStudents.length} student${newStudents.length !== 1 ? 's' : ''}!`, 'green')
      onClose()
    } catch (e) {
      toast('Import failed: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth={680}>
      <h3>Import Students</h3>
      <p className="modal-sub">Download the Excel template, fill in one student per row, then upload it here. CSV files also work.</p>

      {/* Template download */}
      <div className="bg-accent-l border border-accent/20 rounded-lg px-3 py-2.5 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-ink2">
          <strong className="text-accent">Columns:</strong> Student No., Full Name, Course, Year Level, Section, Date of Birth, Mobile
        </div>
        <div className="flex gap-2 shrink-0">
          <button className="btn btn-primary btn-sm" onClick={() => exportStudentImportTemplate({ classes })} title="Download a ready-to-fill Excel template">
            <Download size={13} /> Excel template
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const csv = '"Student No.","Full Name","Course","Year Level","Section","Date of Birth","Mobile"\n"2024-10001","Juan dela Cruz","BS Computer Science","1st Year","2A","2005-06-15","+63 900 000 0000"\n'
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = 'students_template.csv'; a.click(); URL.revokeObjectURL(url)
          }}>
            CSV
          </button>
        </div>
      </div>

      {/* File picker */}
      <div
        className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-accent transition-colors mb-4"
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={24} className="mx-auto mb-2 text-ink3" />
        <div className="text-sm font-medium text-ink">{fileName || 'Click to choose an Excel or CSV file'}</div>
        {!fileName && <div className="text-xs text-ink3 mt-1">Supports .xlsx and .csv files</div>}
        <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={handleFile} />
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-2 text-xs font-semibold">
            <span className="text-green-600">{validRows.length} valid</span>
            {invalidRows.length > 0 && <span className="text-red-500">{invalidRows.length} with errors</span>}
          </div>
          <div className="tbl-wrap max-h-52 overflow-y-auto">
            <table className="tbl text-xs">
              <thead>
                <tr><th>#</th><th>Student No.</th><th>Name</th><th>Course</th><th>Year</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={errors[i] ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                    <td className="text-ink3">{i + 2}</td>
                    <td className="font-mono">{r.id || '—'}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.course || '—'}</td>
                    <td>{r.year || '1st Year'}</td>
                    <td>{errors[i] ? <span className="text-red-500">{errors[i]}</span> : <span className="text-green-600"><Check size={14} /> OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {invalidRows.length > 0 && (
            <div className="text-xs text-ink3 mt-1.5">Rows with errors will be skipped. Fix the CSV and re-upload to include them.</div>
          )}
        </div>
      )}

      {/* Default password reminder */}
      <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800/50 rounded-lg px-3 py-2 mb-3 text-xs text-yellow-800 dark:text-yellow-300">
        <strong>Default password for imported students:</strong>{' '}
        <code className="font-mono bg-yellow-100 dark:bg-yellow-900/50 px-1 rounded">Welcome@2026</code>
        {' '}— students will be required to change it on first login.
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleImport} disabled={saving || !validRows.length}>
          {saving ? 'Importing…' : <><Upload size={13} /> Import {validRows.length > 0 ? `${validRows.length} Student${validRows.length !== 1 ? 's' : ''}` : 'Students'}</>}
        </button>
      </div>
    </Modal>
  )
}

// ── Message Selected Modal ────────────────────────────────────────────
// Fans out an individual direct message to each selected student (so each
// gets their own thread in Messages) plus an in-app badge + best-effort push.
function MessageSelectedModal({ recipients, onClose }) {
  const { db, fbReady } = useData()
  const { toast } = useUI()
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState('')
  const [err, setErr]         = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    setErr('')
    if (!subject.trim()) { setErr('Subject is required.'); return }
    if (!body.trim())    { setErr('Message body is required.'); return }
    if (subject.length > 200) { setErr('Subject too long (max 200 characters).'); return }
    if (body.length > 3000)   { setErr('Message too long (max 3000 characters).'); return }
    if (!fbReady || !db.current) { setErr('Firebase is not connected.'); return }

    setSending(true)
    try {
      const ts  = Date.now()
      const ids = recipients.map(s => s.id)
      await Promise.all(recipients.map((s, i) => {
        const id = `msg_${ts}_${i}_${Math.random().toString(36).slice(2, 7)}`
        return setDoc(doc(db.current, 'messages', id), {
          id, from: 'admin', to: s.id,
          subject: subject.trim(), body: body.trim(),
          ts, read: [], adminRead: true, replies: [], type: 'direct', classId: null,
        })
      }))
      notifyStudentsBroadcast(db.current, ids, subject.trim())
      toast(`Message sent to ${ids.length} student${ids.length === 1 ? '' : 's'}.`, 'green')
      onClose()
    } catch (e) {
      setErr('Failed to send: ' + e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal onClose={onClose} maxWidth={520}>
      <h3><Send size={18} /> Message {recipients.length} student{recipients.length === 1 ? '' : 's'}</h3>
      <p className="modal-sub">Each recipient gets their own direct message thread. They can reply individually.</p>

      <div className="field mb-3">
        <label>Subject <span className="text-red-500">*</span></label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Reminder" maxLength={200} />
      </div>
      <div className="field mb-2">
        <label>Message <span className="text-red-500">*</span></label>
        <textarea rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="Type your message…" maxLength={3000} />
      </div>

      {err && <div className="err-msg mb-2">{err}</div>}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
          {sending ? 'Sending…' : <><Send size={16} /> Send to {recipients.length}</>}
        </button>
      </div>
    </Modal>
  )
}

// ── Students Tab ──────────────────────────────────────────────────────
export default function StudentsTab() {
  const { classes, students, saveStudents, deleteStudent, restoreStudents, eqScale, semester, fbReady } = useData()
  const { toast, toastAction, openDialog, openStudentProfile } = useUI()

  const [search, setSearch]       = useState('')
  const [perPage, setPerPage]     = useState(50)
  const [page, setPage]           = useState(1)
  const [sortCol, setSortCol]     = useState('name')
  const [sortDir, setSortDir]     = useState('asc')
  const [showAdd, setShowAdd]             = useState(false)
  const [showImport, setShowImport]       = useState(false)
  const [editStudent, setEditStudent]     = useState(null)
  const [exportStudent, setExportStudent] = useState(null)
  const [resetStudent, setResetStudent]   = useState(null)
  const [selected, setSelected]           = useState(() => new Set())
  const [showMessage, setShowMessage]     = useState(false)
  const [statusFilter, setStatusFilter]   = useState('all') // 'all' | 'assigned' | 'unassigned'

  // A student is "assigned" when they're enrolled in at least one existing class.
  const isAssigned = (s) => {
    const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    return ids.some(id => classes.some(c => c.id === id))
  }

  const counts = useMemo(() => {
    let assigned = 0
    students.forEach(s => { if (isAssigned(s)) assigned++ })
    return { all: students.length, assigned, unassigned: students.length - assigned }
  }, [students, classes])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return students.filter(s => {
      if (statusFilter === 'assigned'   && !isAssigned(s)) return false
      if (statusFilter === 'unassigned' &&  isAssigned(s)) return false
      return (
        s.name?.toLowerCase().includes(q) ||
        s.id?.toLowerCase().includes(q) ||
        (s.course || '').toLowerCase().includes(q) ||
        (s.account?.email || '').toLowerCase().includes(q)
      )
    })
  }, [students, search, statusFilter, classes])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let va, vb
      switch (sortCol) {
        case 'id':     va = a.id.toLowerCase(); vb = b.id.toLowerCase(); break
        case 'course': va = ((a.course || '') + (a.year || '')).toLowerCase(); vb = ((b.course || '') + (b.year || '')).toLowerCase(); break
        case 'class': {
          const ca = classes.find(c => c.id === a.classId); const cb = classes.find(c => c.id === b.classId)
          va = ca ? (ca.name + ca.section).toLowerCase() : 'zzz'; vb = cb ? (cb.name + cb.section).toLowerCase() : 'zzz'; break
        }
        case 'email':   va = (a.account?.email || '').toLowerCase(); vb = (b.account?.email || '').toLowerCase(); break
        case 'account': {
          const rank = s => !s.account?.registered ? 0 : s.account?.activated ? 2 : 1
          va = String(rank(a)); vb = String(rank(b)); break
        }
        default:        va = a.name?.toLowerCase() || ''; vb = b.name?.toLowerCase() || ''
      }
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }, [filtered, sortCol, sortDir, classes])

  const totalPages = perPage >= 9999 ? 1 : Math.max(1, Math.ceil(sorted.length / perPage))
  const safePage   = Math.min(page, totalPages)
  const start      = perPage >= 9999 ? 0 : (safePage - 1) * perPage
  const slice      = perPage >= 9999 ? sorted : sorted.slice(start, start + perPage)

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
    setPage(1)
  }

  function SortIcon({ col }) {
    if (sortCol !== col) return <span className="stu-sort-icon">↕</span>
    return <span className={`stu-sort-icon ${sortDir}`}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // ── Bulk selection ────────────────────────────────────────────────────
  const allPageSelected = slice.length > 0 && slice.every(s => selected.has(s.id))
  function toggleOne(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllPage() {
    setSelected(prev => {
      const n = new Set(prev)
      if (slice.every(s => n.has(s.id))) slice.forEach(s => n.delete(s.id))
      else slice.forEach(s => n.add(s.id))
      return n
    })
  }
  function clearSelection() { setSelected(new Set()) }

  function handleExportSelected() {
    exportRosterCSV(students.filter(s => selected.has(s.id)), classes)
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    if (!ids.length) return
    const ok = await openDialog({
      title: `Delete ${ids.length} student${ids.length === 1 ? '' : 's'}?`,
      msg: 'All grades and attendance records for the selected students will be permanently deleted. This cannot be undone.',
      type: 'danger',
      confirmLabel: `Delete ${ids.length}`,
      showCancel: true,
    })
    if (!ok) return
    // Snapshot the full records before deletion so Undo can restore them.
    const removed = students.filter(s => selected.has(s.id))
    let done = 0
    for (const id of ids) {
      try { await deleteStudent(id); done++ } catch (e) {}
    }
    clearSelection()
    setPage(1)
    if (done) {
      toastAction(`Deleted ${done} student${done === 1 ? '' : 's'}.`, {
        label: 'Undo',
        type: 'green',
        onAction: () => restoreStudents(removed),
      })
    } else {
      toast('Could not delete the selected students.', 'red')
    }
  }

  async function handleDelete(s) {
    const ok = await openDialog({
      title: `Remove ${s.name}?`,
      msg: 'All grades and attendance records will be permanently deleted. This cannot be undone.',
      type: 'danger',
      confirmLabel: 'Delete Student',
      showCancel: true,
    })
    if (!ok) return
    try {
      await deleteStudent(s.id)
      if (safePage > 1 && slice.length === 1) setPage(p => p - 1)
      toastAction(`Deleted ${s.name || s.id}.`, {
        label: 'Undo',
        type: 'green',
        onAction: () => restoreStudents([s]),
      })
    } catch (e) {
      toast('Could not delete student: ' + e.message, 'red')
    }
  }

  if (!fbReady) return <SkeletonTable />

  return (
    <div>
      {/* Header */}
      <div className="stu-panel-hdr mb-3">
        <div>
          <div className="stu-panel-title">Student Roster</div>
          <div className="stu-panel-sub">{students.length} student{students.length !== 1 ? 's' : ''} total</div>
        </div>
        <div className="stu-panel-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => exportStudentRosterExcel({ students: sorted, classes })} title="Export student roster as Excel (.xlsx)">
            <Download size={13} /> Excel
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => exportRosterCSV(sorted, classes)} title="Export student roster as CSV">
            <Download size={13} /> CSV
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)} title="Import students from Excel or CSV">
            <Upload size={13} /> Import
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}><Plus size={16} /> Add Student</button>
        </div>
      </div>

      {/* Status segments — separate assigned vs unassigned students */}
      <div className="seg-filter mb-3">
        {[['all', 'All', counts.all], ['assigned', 'With Class', counts.assigned], ['unassigned', 'Unassigned', counts.unassigned]].map(([k, label, n]) => (
          <button
            key={k}
            className={`seg-btn${statusFilter === k ? ' active' : ''}`}
            onClick={() => { setStatusFilter(k); setPage(1) }}
          >
            {label} <span className="seg-count">{n}</span>
          </button>
        ))}
      </div>

      {/* Search + per-page */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          className="input flex-1 min-w-48"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search by name, student no., course or email…"
        />
        <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }} className="stu-perpage-select">
          <option value={10}>10 / page</option>
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={9999}>All</option>
        </select>
      </div>

      {/* Bulk action bar — appears when one or more students are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--accent-l)', border: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{selected.size} selected</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowMessage(true)} title="Send a message to the selected students">
            <Send size={13} /> Message selected
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportSelected} title="Export selected students as CSV">
            <Download size={13} /> Export selected
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>Delete selected</button>
          <button className="btn btn-ghost btn-sm" onClick={clearSelection} style={{ marginLeft: 'auto' }}>Clear</button>
        </div>
      )}

      {/* Table */}
      {!sorted.length ? (
        <div className="empty"><div className="empty-icon"><Users size={40} /></div>{search ? 'No students match your search.' : 'No students yet.'}</div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 32, textAlign: 'center' }}>
                    <input type="checkbox" aria-label="Select all students on this page" checked={allPageSelected} onChange={toggleAllPage} style={{ width: 'auto', margin: 0, cursor: 'pointer' }} />
                  </th>
                  <th onClick={() => toggleSort('name')} style={{ cursor: 'pointer' }}>Name <SortIcon col="name" /></th>
                  <th onClick={() => toggleSort('id')} style={{ cursor: 'pointer' }}>Stn. No. <SortIcon col="id" /></th>
                  <th onClick={() => toggleSort('course')} style={{ cursor: 'pointer' }}>Course <SortIcon col="course" /></th>
                  <th onClick={() => toggleSort('class')} style={{ cursor: 'pointer' }}>Class <SortIcon col="class" /></th>
                  <th onClick={() => toggleSort('email')} style={{ cursor: 'pointer' }}>Email <SortIcon col="email" /></th>
                  <th onClick={() => toggleSort('account')} style={{ cursor: 'pointer', textAlign: 'center' }}>Account <SortIcon col="account" /></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {slice.map(s => {
                  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
                  const enrolledClasses = enrolledIds.map(id => classes.find(c => c.id === id)).filter(Boolean)
                  const initial = (s.name || '?').charAt(0).toUpperCase()
                  return (
                    <tr key={s.id} style={selected.has(s.id) ? { background: 'var(--accent-l)' } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} style={{ width: 'auto', margin: 0, cursor: 'pointer' }} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="stu-name-cell"
                          onClick={() => openStudentProfile(s.id)}
                          title={`View ${s.name}'s profile`}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}
                        >
                          <div className="stu-avatar">{initial}</div>
                          <div>
                            <div className="stu-name-text" style={{ color: 'var(--accent)' }}>{s.name}</div>
                            <div className="stu-year-text">{s.year || ''}</div>
                          </div>
                        </button>
                      </td>
                      <td><span className="stu-id-pill">{s.id}</span></td>
                      <td><span className="stu-course-cell">{s.course || '—'}</span></td>
                      <td>
                        {!enrolledClasses.length ? (
                          <span style={{ color: 'var(--ink3)', fontStyle: 'italic', fontSize: 12 }}>Unassigned</span>
                        ) : enrolledClasses.length === 1 ? (
                          <span style={{ fontSize: 12 }}>{enrolledClasses[0].name} {enrolledClasses[0].section}</span>
                        ) : (
                          <span>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>
                              {(enrolledClasses.find(c => c.id === s.classId) || enrolledClasses[0]).name}{' '}
                              {(enrolledClasses.find(c => c.id === s.classId) || enrolledClasses[0]).section}
                            </span>
                            {enrolledClasses.filter(c => c.id !== s.classId).map(c => (
                              <span key={c.id} style={{ display: 'block', fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>+{c.name} {c.section}</span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td>
                        {s.account?.email
                          ? <span className="stu-email-cell">{s.account.email}</span>
                          : <span style={{ color: 'var(--ink3)', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {!s.account?.registered
                          ? <Badge variant="gray" style={{ fontSize: 11 }}>No Account</Badge>
                          : s.account?.activated
                            ? <Badge variant="green" style={{ fontSize: 11 }}><Check size={12} /> Active</Badge>
                            : <Badge variant="yellow" style={{ fontSize: 11 }}><Hourglass size={12} /> Pending</Badge>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <KebabMenu label={`Actions for ${s.name}`} items={[
                          { label: 'View profile', onClick: () => openStudentProfile(s.id) },
                          { label: 'Edit', onClick: () => setEditStudent(s) },
                          s.account?.registered && { label: 'Reset password', onClick: () => setResetStudent(s) },
                          { label: 'Export report', onClick: () => setExportStudent(s) },
                          { label: 'Report card (PDF)', onClick: () => buildStudentReportCard(s, { classes, students, eqScale, semester }) },
                          { label: 'Delete', onClick: () => handleDelete(s), danger: true },
                        ]} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {perPage < 9999 && (
            <Pagination total={sorted.length} perPage={perPage} page={safePage} onChange={setPage} />
          )}
        </>
      )}

      {/* Modals */}
      {showAdd      && <AddStudentModal onClose={() => setShowAdd(false)} />}
      {showImport   && <ImportStudentsModal onClose={() => setShowImport(false)} />}
      {showMessage  && <MessageSelectedModal recipients={students.filter(s => selected.has(s.id))} onClose={() => setShowMessage(false)} />}
      {editStudent  && <EditStudentModal student={editStudent} onClose={() => setEditStudent(null)} />}
      {resetStudent && <ResetPasswordModal student={resetStudent} onClose={() => setResetStudent(null)} />}
      {exportStudent && (
        <Suspense fallback={null}>
          <ExportPreviewModal
            type="student"
            student={exportStudent}
            onClose={() => setExportStudent(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
