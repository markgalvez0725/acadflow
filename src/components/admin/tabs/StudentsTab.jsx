import React, { useState, useMemo, useRef, lazy, Suspense } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { hashPassword } from '@/utils/crypto'
import { validateSnum } from '@/utils/validate'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'
import Modal from '@/components/primitives/Modal'
import { Download, Upload, FileDown } from 'lucide-react'

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
  const [mobile, setMobile]     = useState('')
  const [dob, setDob]           = useState('')
  const [classId, setClassId]   = useState('')
  const [extraIds, setExtraIds] = useState([])
  const [setPass, setSetPass]   = useState(false)
  const [initPass, setInitPass] = useState('')
  const [initEmail, setInitEmail] = useState('')
  const [err, setErr]           = useState('')
  const [passErr, setPassErr]   = useState('')
  const [saving, setSaving]     = useState(false)

  const otherClasses = classes.filter(c => c.id !== classId)

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
    if (students.find(s => s.id === id)) { setErr(`⛔ Student number "${id}" already exists.`); return }
    if (name && dob && students.find(s => s.name.toLowerCase() === name.trim().toLowerCase() && s.dob === dob)) {
      setErr('⛔ A student with this name and date of birth already exists.'); return
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

    setSaving(true)
    try {
      const newStudent = { id, name: name.trim(), course: course.trim(), year, mobile: mobile.trim(), dob, classId: classId || null, classIds: allClassIds, grades, attendance, excuse, gradeComponents, account }
      await saveStudents([...students, newStudent], [id])
      toast('Student added!', 'green')
      onClose()
    } catch (e) {
      setErr('❌ Failed to save student: ' + e.message)
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
          <input value={course} onChange={e => setCourse(e.target.value)} placeholder="BS Computer Science" />
        </div>
        <div className="field">
          <label>Year Level</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            <option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option>
          </select>
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Date of Birth</label>
          <input type="date" value={dob} onChange={e => setDob(e.target.value)} />
        </div>
        <div className="field">
          <label>Mobile Number</label>
          <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="+63 900 000 0000" />
        </div>
      </div>
      <div className="field">
        <label>Primary Class <span className="font-normal text-ink3">(home class for grades &amp; attendance)</span></label>
        <select value={classId} onChange={e => { setClassId(e.target.value); setExtraIds(prev => prev.filter(x => x !== e.target.value)) }}>
          <option value="">— Select Class —</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.section}</option>)}
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
            <div className="text-xs font-bold text-ink">🔑 Initial Password</div>
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
          {saving ? 'Adding…' : '➕ Add Student'}
        </button>
      </div>
    </Modal>
  )
}

// ── Edit Student Modal ────────────────────────────────────────────────
function EditStudentModal({ student, onClose }) {
  const { classes, students, saveStudents } = useData()
  const { toast } = useUI()

  const [name, setName]       = useState(student.name)
  const [course, setCourse]   = useState(student.course || '')
  const [year, setYear]       = useState(student.year || '1st Year')
  const [mobile, setMobile]   = useState(student.mobile || '')
  const [dob, setDob]         = useState(student.dob || '')
  const [classId, setClassId] = useState(student.classId || '')
  const [extraIds, setExtraIds] = useState(
    (student.classIds || []).filter(id => id !== student.classId)
  )
  const [err, setErr]     = useState('')
  const [saving, setSaving] = useState(false)

  const otherClasses = useMemo(() => classes.filter(c => c.id !== classId), [classes, classId])

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
    if (!name.trim() || !course.trim()) { setErr('Name and course are required.'); return }
    if (dob) {
      const dup = students.find(x => x.id !== student.id && x.name.toLowerCase() === name.trim().toLowerCase() && x.dob === dob)
      if (dup) { setErr(`⛔ Another student named "${dup.name}" with this DOB already exists (${dup.id}).`); return }
    }

    const newClassId = classId || null
    const allClassIds = [...new Set([newClassId, ...extraIds].filter(Boolean))]

    const updatedStudents = students.map(s => {
      if (s.id !== student.id) return s
      const ns = { ...s, name: name.trim(), course: course.trim(), year, mobile: mobile.trim(), dob, classId: newClassId, classIds: allClassIds, grades: { ...s.grades }, attendance: { ...s.attendance }, excuse: { ...s.excuse } }
      if (s.gradeComponents) ns.gradeComponents = { ...s.gradeComponents }
      allClassIds.forEach(cid => {
        const cls = classes.find(c => c.id === cid)
        if (!cls) return
        cls.subjects.forEach(sub => {
          if (ns.grades[sub] === undefined)  ns.grades[sub] = null
          if (!ns.attendance[sub])           ns.attendance[sub] = new Set()
          if (!ns.excuse[sub])               ns.excuse[sub] = new Set()
        })
      })
      return ns
    })

    setSaving(true)
    try {
      await saveStudents(updatedStudents, [student.id])
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
      <h3>✏️ Edit Student</h3>
      <p className="modal-sub">Update student information. Student number cannot be changed.</p>
      {err && <div className="err-msg mb-3">{err}</div>}
      <div className="input-row">
        <div className="field">
          <label>Full Name <span className="text-red-500">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Juan dela Cruz" />
        </div>
        <div className="field">
          <label>Student Number <span className="text-ink3 font-normal">(read-only)</span></label>
          <input value={student.id} readOnly style={{ background: 'var(--border)', color: 'var(--ink2)', cursor: 'not-allowed' }} />
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Course / Program <span className="text-red-500">*</span></label>
          <input value={course} onChange={e => setCourse(e.target.value)} placeholder="BS Computer Science" />
        </div>
        <div className="field">
          <label>Year Level</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            <option>1st Year</option><option>2nd Year</option><option>3rd Year</option><option>4th Year</option>
          </select>
        </div>
      </div>
      <div className="input-row">
        <div className="field">
          <label>Date of Birth</label>
          <input type="date" value={dob} onChange={e => setDob(e.target.value)} />
        </div>
        <div className="field">
          <label>Mobile Number</label>
          <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="+63 900 000 0000" />
        </div>
      </div>

      <div className="field">
        <label>Primary Class <span className="font-normal text-ink3">(home class for grades &amp; attendance)</span></label>
        <select value={classId} onChange={e => { setClassId(e.target.value); setExtraIds(prev => prev.filter(x => x !== e.target.value)) }}>
          <option value="">— Unassigned —</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.section}</option>)}
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
          <strong className="text-accent">📚 Enrolled subjects ({allSubjects.length}):</strong>{' '}
          {allSubjects.map(s => (
            <span key={s} className="inline-block bg-surface border border-border rounded px-1.5 py-0.5 mx-0.5">{s}</span>
          ))}
        </div>
      )}

      <div className="field">
        <label>Account Status</label>
        <div className="py-2">
          {student.account?.registered
            ? <Badge variant="green">✅ Active Account ({student.account.email || '—'})</Badge>
            : <Badge variant="gray">No account yet</Badge>}
        </div>
      </div>

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save Changes'}
        </button>
      </div>
    </Modal>
  )
}

// ── CSV helpers ───────────────────────────────────────────────────────
function exportRosterCSV(students, classes) {
  const headers = ['Student No.', 'Full Name', 'Course', 'Year Level', 'Date of Birth', 'Mobile', 'Primary Class', 'Email', 'Account Status']
  const rows = students.map(s => {
    const cls = classes.find(c => c.id === s.classId)
    return [s.id, s.name, s.course || '', s.year || '', s.dob || '', s.mobile || '', cls ? `${cls.name} ${cls.section}` : '', s.account?.email || '', s.account?.registered ? 'Active' : 'No Account']
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

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result)
      const errs = {}
      parsed.forEach((r, i) => {
        const id = r.id.toUpperCase()
        if (!id)                        errs[i] = 'Missing student number'
        else if (!r.name)               errs[i] = 'Missing full name'
        else if (!r.course)             errs[i] = 'Missing course'
        else if (validateSnum(id))      errs[i] = validateSnum(id)
        else if (students.find(s => s.id === id)) errs[i] = `Student no. "${id}" already exists`
        else {
          const dupIdx = parsed.findIndex((x, j) => j < i && x.id.toUpperCase() === id)
          if (dupIdx >= 0) errs[i] = `Duplicate student no. in file (row ${dupIdx + 2})`
        }
      })
      setRows(parsed)
      setErrors(errs)
    }
    reader.readAsText(file)
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
        return { id, name: r.name, course: r.course, year: r.year || '1st Year', mobile: r.mobile || '', dob: r.dob || '', classId: null, classIds: allClassIds, grades, attendance, excuse, gradeComponents, account: { registered: true, pass: await hashPassword(DEFAULT_PASS), email: '', _tempPass: true } }
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
      <p className="modal-sub">Upload a CSV file with student data. Download the template to get started.</p>

      {/* Template download */}
      <div className="bg-accent-l border border-accent/20 rounded-lg px-3 py-2.5 mb-4 flex items-center justify-between gap-3">
        <div className="text-xs text-ink2">
          <strong className="text-accent">CSV columns:</strong> Student No., Full Name, Course, Year Level, Date of Birth, Mobile
        </div>
        <button className="btn btn-ghost btn-sm shrink-0" onClick={() => {
          const csv = '"Student No.","Full Name","Course","Year Level","Date of Birth","Mobile"\n"2024-10001","Juan dela Cruz","BS Computer Science","1st Year","2005-06-15","+63 900 000 0000"\n'
          const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a'); a.href = url; a.download = 'students_template.csv'; a.click(); URL.revokeObjectURL(url)
        }}>
          <Download size={13} /> Template
        </button>
      </div>

      {/* File picker */}
      <div
        className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-accent transition-colors mb-4"
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={24} className="mx-auto mb-2 text-ink3" />
        <div className="text-sm font-medium text-ink">{fileName || 'Click to choose a CSV file'}</div>
        {!fileName && <div className="text-xs text-ink3 mt-1">Supports .csv files</div>}
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
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
                    <td>{errors[i] ? <span className="text-red-500">{errors[i]}</span> : <span className="text-green-600">✓ OK</span>}</td>
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

// ── Students Tab ──────────────────────────────────────────────────────
export default function StudentsTab() {
  const { classes, students, saveStudents, deleteStudent } = useData()
  const { toast, openDialog } = useUI()

  const [search, setSearch]       = useState('')
  const [perPage, setPerPage]     = useState(50)
  const [page, setPage]           = useState(1)
  const [sortCol, setSortCol]     = useState('name')
  const [sortDir, setSortDir]     = useState('asc')
  const [showAdd, setShowAdd]             = useState(false)
  const [showImport, setShowImport]       = useState(false)
  const [editStudent, setEditStudent]     = useState(null)
  const [exportStudent, setExportStudent] = useState(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return students.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.id?.toLowerCase().includes(q) ||
      (s.course || '').toLowerCase().includes(q) ||
      (s.account?.email || '').toLowerCase().includes(q)
    )
  }, [students, search])

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
        case 'account': va = a.account?.registered ? '1' : '0'; vb = b.account?.registered ? '1' : '0'; break
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
    } catch (e) {
      toast('Could not delete student: ' + e.message, 'red')
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="stu-panel-hdr mb-3">
        <div>
          <div className="stu-panel-title">Student Roster</div>
          <div className="stu-panel-sub">{students.length} student{students.length !== 1 ? 's' : ''} total</div>
        </div>
        <div className="stu-panel-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => exportRosterCSV(sorted, classes)} title="Export student roster as CSV">
            <Download size={13} /> Export
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)} title="Import students from CSV">
            <Upload size={13} /> Import
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>➕ Add Student</button>
        </div>
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

      {/* Table */}
      {!sorted.length ? (
        <div className="empty"><div className="empty-icon">👥</div>{search ? 'No students match your search.' : 'No students yet.'}</div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
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
                    <tr key={s.id}>
                      <td>
                        <div className="stu-name-cell">
                          <div className="stu-avatar">{initial}</div>
                          <div>
                            <div className="stu-name-text">{s.name}</div>
                            <div className="stu-year-text">{s.year || ''}</div>
                          </div>
                        </div>
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
                        {s.account?.registered
                          ? <Badge variant="green" style={{ fontSize: 11 }}>✓ Active</Badge>
                          : <Badge variant="gray" style={{ fontSize: 11 }}>No Account</Badge>}
                      </td>
                      <td>
                        <div className="stu-actions-cell">
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditStudent(s)} title="Edit">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 12l1.5-.4 7-7a1 1 0 000-1.4L8.8 2.5a1 1 0 00-1.4 0l-7 7L1 12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                            Edit
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setExportStudent(s)} title="Export student report">
                            <FileDown size={13} />
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s)} title="Delete">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 3h10M4.5 3V2h4v1M2.5 3l.6 7.5h5.8l.6-7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                        </div>
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
      {editStudent  && <EditStudentModal student={editStudent} onClose={() => setEditStudent(null)} />}
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
