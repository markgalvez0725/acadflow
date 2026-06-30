import React, { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { useRedirectHighlight } from '@/navigation/useRedirectHighlight'
import { sortByLastName, fmtDateShort } from '@/utils/format'
import { getHeldDays } from '@/utils/grades'
import { classTag, courseShort } from '@/utils/groupChat'
import { triageExcuses } from '@/utils/excuseTriage'
import { prewarmEmbeddings } from '@/utils/embeddings'
import { subjectSessionDates, trailingAbsenceStreak } from '@/utils/attendanceRisk'
import Modal from '@/components/primitives/Modal'
import Avatar from '@/components/primitives/Avatar'
import Pagination from '@/components/primitives/Pagination'
import QRCode from '@/components/primitives/QRCode'
import KebabMenu from '@/components/primitives/KebabMenu'
import EmptyState from '@/components/ds/EmptyState'
import PageHeader from '@/components/ds/PageHeader'
import { Download, Upload, AlertTriangle, Shuffle, RefreshCw, CalendarDays, Check, ClipboardList, X, ClipboardCheck, Archive, ArchiveRestore, UserCheck, UserX, Radio, Copy, ListFilter, Radar, TrendingDown, Star } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'

const ExportPreviewModal = lazy(() => import('@/components/admin/modals/ExportPreviewModal'))

const ATT_PER_PAGE = 10
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Small pill used by excuse triage (#26) to tag a request.
function ExcuseChip({ text, bg, fg }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: bg, color: fg, border: '1px solid var(--border)' }}>
      {text}
    </span>
  )
}

// ── ImportAttendanceModal ──────────────────────────────────────────────────────
// Accepts an Excel file (.xlsx / .xls / .csv) where:
//   - Column A  : Student No. (matches student.id)
//   - Column B+ : Date columns (header = YYYY-MM-DD)
//                 Cell values: "P" / "present"  → present
//                              "E" / "excuse"   → excused
//                              "A" / "absent"   → absent (or empty)
// The sheet name should be the subject name, or the user selects the subject.
function ImportAttendanceModal({ classId, subject, onClose }) {
  const { students, saveStudents } = useData()
  const { toast } = useUI()
  const fileRef = useRef(null)

  const [file,    setFile]    = useState(null)
  const [preview, setPreview] = useState(null)  // { rows, dates, matched, unmatched }
  const [error,   setError]   = useState(null)
  const [mode,    setMode]    = useState('merge') // 'merge' | 'replace'
  const [saving,  setSaving]  = useState(false)
  const [parsing, setParsing] = useState(false)

  const studs = useMemo(
    () => students.filter(s => s.classId === classId || s.classIds?.includes(classId)),
    [students, classId]
  )

  function reset() {
    setFile(null); setPreview(null); setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function normaliseStatus(raw) {
    if (!raw) return 'absent'
    const v = String(raw).trim().toLowerCase()
    if (v === 'p' || v === 'present' || v === '1') return 'present'
    if (v === 'e' || v === 'excuse' || v === 'excused') return 'excuse'
    return 'absent'
  }

  function isDateHeader(val) {
    if (!val) return false
    // Accept YYYY-MM-DD, M/D/YYYY, D/M/YYYY, or Excel date serials (number)
    if (typeof val === 'number') return val > 1000  // Excel serial
    const s = String(val).trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)
  }

  function toDateStr(val) {
    if (typeof val === 'number') {
      // Excel serial → JS Date
      const d = new Date(Math.round((val - 25569) * 86400 * 1000))
      return d.toISOString().slice(0, 10)
    }
    const s = String(val).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    // M/D/YYYY or D/M/YYYY - treat as M/D/YYYY (common in PH Excel exports)
    const parts = s.split('/')
    if (parts.length === 3) {
      const [m, d, y] = parts
      return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    }
    return null
  }

  async function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f); setError(null); setPreview(null)
    setParsing(true)
    try {
      const XLSX = window.XLSX
      if (!XLSX) throw new Error('SheetJS not loaded. Check your internet connection.')

      const buf  = await f.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array', cellDates: false })

      // Try to find the sheet matching the subject name; fallback to first sheet
      const sheetName = wb.SheetNames.find(n => n.toLowerCase() === subject.toLowerCase())
        ?? wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      if (raw.length < 2) throw new Error('Sheet appears empty.')

      const header = raw[0]
      // Find student-id column (first column with "id", "no", "student no", or column index 0)
      let idCol = header.findIndex(h => /student.?no|id|student.?id/i.test(String(h)))
      if (idCol < 0) idCol = 0

      // Find date columns
      const dateCols = []
      header.forEach((h, i) => {
        if (i === idCol) return
        const ds = toDateStr(h)
        if (ds) dateCols.push({ col: i, date: ds })
      })

      if (dateCols.length === 0) throw new Error('No date columns found. Headers must be YYYY-MM-DD or M/D/YYYY.')

      // Build preview rows
      const byId = {}
      studs.forEach(s => { byId[s.id] = s })

      const rows     = []
      const matched  = new Set()
      const unmatched = []

      for (let r = 1; r < raw.length; r++) {
        const row = raw[r]
        const sid = String(row[idCol] || '').trim()
        if (!sid) continue

        const student = byId[sid]
        const statuses = {}
        dateCols.forEach(({ col, date }) => {
          statuses[date] = normaliseStatus(row[col])
        })

        if (student) {
          matched.add(sid)
          rows.push({ student, statuses })
        } else {
          unmatched.push(sid)
        }
      }

      setPreview({ rows, dates: dateCols.map(d => d.date), matched: [...matched], unmatched })
    } catch (err) {
      setError(err.message)
    } finally {
      setParsing(false)
    }
  }

  async function applyImport() {
    if (!preview || preview.rows.length === 0) return
    setSaving(true)
    try {
      const changedIds = new Set()
      const studentsMap = {}
      students.forEach(s => { studentsMap[s.id] = { ...s, attendance: { ...(s.attendance || {}) }, excuse: { ...(s.excuse || {}) } } })

      preview.rows.forEach(({ student, statuses }) => {
        const ns = studentsMap[student.id]
        if (!ns) return

        const attSet = new Set(mode === 'merge' ? (ns.attendance[subject] || new Set()) : [])
        const excSet = new Set(mode === 'merge' ? (ns.excuse[subject]    || new Set()) : [])

        Object.entries(statuses).forEach(([date, status]) => {
          // Always clear the date first, then re-apply
          attSet.delete(date)
          excSet.delete(date)
          if (status === 'present') attSet.add(date)
          else if (status === 'excuse') excSet.add(date)
        })

        ns.attendance[subject] = attSet
        ns.excuse[subject]     = excSet
        changedIds.add(student.id)
      })

      const updated = students.map(s => studentsMap[s.id] || s)
      await saveStudents(updated, [...changedIds])
      toast(`Imported attendance for ${changedIds.size} student(s) - ${preview.dates.length} date(s).`, 'green')
      onClose()
    } catch (err) {
      toast('Import failed: ' + err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  const STATUS_COLORS = { present: 'var(--green)', excuse: 'var(--purple)', absent: 'var(--red)' }
  const STATUS_LABELS = { present: 'P', excuse: 'E', absent: 'A' }

  function downloadTemplate() {
    const XLSX = window.XLSX
    if (!XLSX) { toast('SheetJS not loaded. Check your internet connection.', 'red'); return }

    const sorted = sortByLastName([...studs])
    // Header row: Student No., Name, then 5 blank date placeholders
    const today = new Date()
    const dateCols = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      return d.toISOString().slice(0, 10)
    })
    const header = ['Student No.', 'Name', ...dateCols]
    const rows = sorted.map(s => [s.id, s.name, ...dateCols.map(() => '')])

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])

    // Style header row bold + freeze top row
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C })
      if (!ws[addr]) continue
      ws[addr].s = { font: { bold: true } }
    }
    ws['!freeze'] = { xSplit: 2, ySplit: 1 }

    // Auto column widths
    ws['!cols'] = [
      { wch: 16 },
      { wch: 28 },
      ...dateCols.map(() => ({ wch: 14 })),
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, subject.slice(0, 31))
    XLSX.writeFile(wb, `Attendance_Template_${subject.replace(/\s+/g, '_')}.xlsx`)
  }

  return (
    <Modal onClose={onClose} size="xl">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="mb-0"><Download size={16} className="inline-block mr-1 align-text-bottom" />Import Attendance</h3>
          <p className="modal-sub mb-0">{subject}</p>
        </div>
        <button className="btn btn-ghost text-xs" onClick={downloadTemplate}>
          <Download size={13} className="inline-block mr-1" />Download Template
        </button>
      </div>

      {/* Format hint */}
      <div className="rounded-lg p-3 mb-4 text-xs" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <strong>Expected format:</strong> Column A = Student No., remaining columns = dates (header: YYYY-MM-DD or M/D/YYYY).
        Cell values: <strong>P</strong> / Present, <strong>E</strong> / Excuse, <strong>A</strong> / Absent (or blank).
        Sheet name should match the subject name for auto-detection.
        <br /><strong>Tip:</strong> Download the template above - it's pre-filled with your students and today's dates.
      </div>

      {/* File picker */}
      <div className="mb-3">
        <label className="block text-xs font-semibold text-ink2 mb-1">Select Excel / CSV file</label>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
          className="input" style={{ paddingTop: 6, paddingBottom: 6 }}
          onChange={handleFile} />
      </div>

      {parsing && <div className="text-sm text-ink2 mb-3">Parsing file…</div>}
      {error   && <div className="rounded-lg p-3 mb-3 text-sm" style={{ background: 'var(--red-l)', color: 'var(--red)' }}><AlertTriangle size={14} className="inline-block mr-1 align-text-bottom" />{error}</div>}

      {preview && (
        <>
          {/* Match summary */}
          <div className="flex gap-3 mb-3 flex-wrap">
            <div className="rounded-lg p-2.5 text-xs flex-1" style={{ background: 'var(--green-l)', border: '1px solid var(--green)' }}>
              <strong style={{ color: 'var(--green)' }}>{preview.matched.length}</strong>
              <span className="text-ink2 ml-1">student(s) matched</span>
            </div>
            <div className="rounded-lg p-2.5 text-xs flex-1" style={{ background: preview.unmatched.length ? 'var(--yellow-l)' : 'var(--bg)', border: `1px solid ${preview.unmatched.length ? 'var(--yellow)' : 'var(--border)'}` }}>
              <strong style={{ color: preview.unmatched.length ? 'var(--yellow)' : 'var(--ink2)' }}>{preview.unmatched.length}</strong>
              <span className="text-ink2 ml-1">unmatched ID(s)</span>
              {preview.unmatched.length > 0 && (
                <div className="mt-1 text-ink3">{preview.unmatched.join(', ')}</div>
              )}
            </div>
            <div className="rounded-lg p-2.5 text-xs flex-1" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
              <strong className="text-ink">{preview.dates.length}</strong>
              <span className="text-ink2 ml-1">date(s) detected</span>
            </div>
          </div>

          {/* Import mode */}
          <div className="flex gap-3 mb-3">
            {[
              { val: 'merge',   label: <><Shuffle size={13} className="inline-block mr-1" />Merge</>,   desc: 'Add imported dates; keep existing records' },
              { val: 'replace', label: <><RefreshCw size={13} className="inline-block mr-1" />Replace</>, desc: 'Overwrite this subject\'s attendance entirely' },
            ].map(opt => (
              <label key={opt.val} className="flex items-start gap-2 cursor-pointer flex-1 rounded-lg p-2.5"
                style={{ border: `1.5px solid ${mode === opt.val ? 'var(--accent)' : 'var(--border)'}`, background: mode === opt.val ? 'var(--accent-l)' : 'var(--surface)' }}>
                <input type="radio" name="att-import-mode" value={opt.val}
                  checked={mode === opt.val} onChange={() => setMode(opt.val)}
                  className="mt-0.5" />
                <div>
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-xs text-ink2">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>

          {/* Preview table (first 5 students, first 8 dates) */}
          {preview.rows.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-ink2 mb-1 uppercase tracking-wider">Preview (first {Math.min(5, preview.rows.length)} rows)</div>
              <div className="tbl-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th>Student</th>
                      {preview.dates.slice(0, 8).map(d => <th key={d}>{fmtDateShort(d)}</th>)}
                      {preview.dates.length > 8 && <th>+{preview.dates.length - 8} more</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map(({ student, statuses }) => (
                      <tr key={student.id}>
                        <td><strong>{student.name}</strong><br /><small className="text-ink2">{student.id}</small></td>
                        {preview.dates.slice(0, 8).map(d => (
                          <td key={d} style={{ textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block', width: 22, height: 22, borderRadius: 4,
                              background: STATUS_COLORS[statuses[d]] + '33',
                              color: STATUS_COLORS[statuses[d]],
                              fontSize: 11, fontWeight: 700, lineHeight: '22px'
                            }}>{STATUS_LABELS[statuses[d]]}</span>
                          </td>
                        ))}
                        {preview.dates.length > 8 && <td className="text-ink3">…</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        {preview && preview.matched.length > 0 && (
          <button className="btn btn-primary" onClick={applyImport} disabled={saving}>
            {saving ? 'Importing…' : `Import ${preview.matched.length} Student(s)`}
          </button>
        )}
        {!preview && (
          <button className="btn btn-ghost" onClick={reset} disabled={!file}>Clear</button>
        )}
      </div>
    </Modal>
  )
}

// ── AttendanceCalendarModal ────────────────────────────────────────────────────
// Two views: 'calendar' and 'day'
function AttendanceCalendarModal({ classId, subject, readOnly, onClose }) {
  const { students, classes, saveStudents } = useData()
  const { toast } = useUI()

  const cls   = classes.find(c => c.id === classId)
  const studs = useMemo(() => sortByLastName(students.filter(s => s.classId === classId || s.classIds?.includes(classId))), [students, classId])

  const today = new Date()
  const [year,  setYear]  = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [view,  setView]  = useState('calendar') // 'calendar' | 'day'
  const [selDate, setSelDate] = useState(null)    // 'YYYY-MM-DD'
  const [statuses, setStatuses] = useState({})     // { studentId: 'present'|'excuse'|'absent' }
  const [saving, setSaving] = useState(false)

  // ── Calendar data ───────────────────────────────────────────────────────
  const dayPresCount = useMemo(() => {
    const c = {}
    studs.forEach(s => (s.attendance?.[subject] || new Set()).forEach(d => { c[d] = (c[d] || 0) + 1 }))
    return c
  }, [studs, subject])

  const dayExcCount = useMemo(() => {
    const c = {}
    studs.forEach(s => (s.excuse?.[subject] || new Set()).forEach(d => { c[d] = (c[d] || 0) + 1 }))
    return c
  }, [studs, subject])

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function openDay(dateStr) {
    const init = {}
    studs.forEach(s => {
      const isPresent = (s.attendance?.[subject] || new Set()).has(dateStr)
      const isExcuse  = !isPresent && (s.excuse?.[subject] || new Set()).has(dateStr)
      init[s.id] = isPresent ? 'present' : isExcuse ? 'excuse' : 'absent'
    })
    setStatuses(init)
    setSelDate(dateStr)
    setView('day')
  }

  function setStatus(studentId, status) {
    setStatuses(prev => ({ ...prev, [studentId]: status }))
  }

  function setAll(status) {
    const next = {}
    studs.forEach(s => { next[s.id] = status })
    setStatuses(next)
  }

  async function saveDay() {
    setSaving(true)
    const updated = students.map(s => {
      if (s.classId !== classId && !s.classIds?.includes(classId)) return s
      const ns = { ...s, attendance: { ...(s.attendance || {}) }, excuse: { ...(s.excuse || {}) } }
      const attSet = new Set(ns.attendance[subject] || [])
      const excSet = new Set(ns.excuse[subject] || [])
      // Clean this date then re-add
      attSet.delete(selDate)
      excSet.delete(selDate)
      const st = statuses[s.id] || 'absent'
      if (st === 'present') attSet.add(selDate)
      else if (st === 'excuse') excSet.add(selDate)
      ns.attendance[subject] = attSet
      ns.excuse[subject]     = excSet
      return ns
    })
    try {
      await saveStudents(updated, studs.map(s => s.id))
      toast('Attendance saved!', 'green')
      setView('calendar')
    } catch (e) {
      toast('Saved locally - sync failed: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  // ── Counts for day view header ───────────────────────────────────────────
  const presentCount = Object.values(statuses).filter(v => v === 'present').length
  const excuseCount  = Object.values(statuses).filter(v => v === 'excuse').length
  const absentCount  = studs.length - presentCount - excuseCount

  // ── Calendar grid ────────────────────────────────────────────────────────
  const monthName    = new Date(year, month, 1).toLocaleString('default', { month: 'long' })
  const firstDay     = new Date(year, month, 1).getDay()
  const daysInMonth  = new Date(year, month + 1, 0).getDate()
  const calDays      = []
  for (let i = 0; i < firstDay; i++) calDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d)

  const selDateLabel = selDate
    ? new Date(selDate + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : ''
  const selDateIsWeekend = selDate ? ([0, 6].includes(new Date(selDate + 'T00:00:00').getDay())) : false

  return (
    <Modal onClose={onClose} size="lg">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="mb-0"><CalendarDays size={16} className="inline-block mr-1 align-text-bottom" />Attendance</h3>
          <p className="modal-sub mb-0">{subject} · <span title={cls?.name || ''}>{courseShort(cls?.name)}</span> {cls?.section}</p>
        </div>
      </div>

      {view === 'calendar' && (
        <>
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button className="btn btn-ghost btn-sm" onClick={prevMonth}>◀</button>
            <h4 className="font-bold">{monthName} {year}</h4>
            <button className="btn btn-ghost btn-sm" onClick={nextMonth}>▶</button>
          </div>

          {/* Day header */}
          <div className="cal-wrap">
            <div className="cal-grid">
              <div className="cal-days-header">
                {DAY_NAMES.map((d, i) => (
                  <div key={d} className="cal-day-name" style={i === 0 || i === 6 ? { color: 'var(--accent)' } : {}}>{d}</div>
                ))}
              </div>
              <div className="cal-days">
                {calDays.map((d, i) => {
                  if (!d) return <div key={`e${i}`} className="cal-day cal-empty" />
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                  const dow = new Date(year, month, d).getDay()
                  const isWeekend = dow === 0 || dow === 6
                  const isToday   = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d
                  const pCnt = dayPresCount[dateStr] || 0
                  const eCnt = dayExcCount[dateStr] || 0

                  let cls2 = 'cal-day'
                  if (isWeekend) cls2 += ' cal-weekend'
                  if (isToday)   cls2 += ' cal-today'
                  if (pCnt > 0)  cls2 += ' cal-has-present'
                  else if (eCnt > 0) cls2 += ' cal-has-excuse'

                  return (
                    <div key={dateStr} className={cls2} style={{ position: 'relative', cursor: readOnly ? 'default' : 'pointer' }}
                      onClick={() => !readOnly && openDay(dateStr)}
                      title={readOnly ? dateStr : `${dateStr} - Click to mark attendance`}>
                      {d}
                      {pCnt > 0 && (
                        <span style={{ position: 'absolute', top: 2, right: 2, fontSize: 8, fontWeight: 700,
                          background: 'var(--green)', color: '#fff', borderRadius: 10, padding: '0 4px', lineHeight: '14px' }}>
                          {pCnt}
                        </span>
                      )}
                      {pCnt === 0 && eCnt > 0 && (
                        <span style={{ position: 'absolute', top: 2, right: 2, fontSize: 8, fontWeight: 700,
                          background: 'var(--purple)', color: '#fff', borderRadius: 10, padding: '0 4px', lineHeight: '14px' }}>
                          {eCnt}E
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {[
              { color: 'var(--green-l)', border: 'var(--green)', label: 'Present' },
              { color: 'var(--purple-l)', border: 'var(--purple)', label: 'Excused' },
              { color: 'var(--border)', border: 'transparent', label: 'Absent / No record' },
            ].map(({ color, border, label }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs text-ink2">
                <span style={{ width: 12, height: 12, borderRadius: 3, background: color, border: `1px solid ${border}`, display: 'inline-block' }} />
                {label}
              </div>
            ))}
            <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{readOnly ? '(archived - read-only)' : <><CalendarDays size={12} className="inline-block mr-1 align-text-bottom" />Click any day to mark attendance</>}</span>
          </div>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </>
      )}

      {view === 'day' && selDate && (
        <>
          {/* Day header banner */}
          <div className="rounded-lg p-3 mb-3 flex items-center justify-between flex-wrap gap-2"
            style={{ background: 'var(--accent)' }}>
            <div>
              <div className="font-bold text-sm text-white"><CalendarDays size={14} className="inline-block mr-1 align-text-bottom" />{selDateLabel}</div>
              {selDateIsWeekend && <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,.7)' }}>Weekend session</div>}
            </div>
            <div className="flex gap-2">
              {[
                { count: presentCount, label: 'PRESENT' },
                { count: excuseCount,  label: 'EXCUSED' },
                { count: absentCount,  label: 'ABSENT' },
                { count: studs.length, label: 'TOTAL' },
              ].map(({ count, label }) => (
                <div key={label} className="text-center rounded-lg px-3.5 py-1.5"
                  style={{ background: 'rgba(255,255,255,.15)' }}>
                  <div className="text-lg font-bold text-white">{count}</div>
                  <div className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,.7)' }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bulk actions */}
          <div className="flex gap-2 mb-3 flex-wrap">
            {!readOnly && <button className="btn btn-green btn-sm" onClick={() => setAll('present')}><Check size={13} className="inline-block mr-1" />All Present</button>}
            {!readOnly && <button className="btn btn-sm" style={{ background: 'var(--purple-l)', color: 'var(--purple)' }}
              onClick={() => setAll('excuse')}><ClipboardList size={13} className="inline-block mr-1" />All Excused</button>}
            {!readOnly && <button className="btn btn-danger btn-sm" onClick={() => setAll('absent')}><X size={13} className="inline-block mr-1" />All Absent</button>}
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: readOnly ? undefined : 'auto' }}
              onClick={() => setView('calendar')}>← Back</button>
          </div>

          {/* Student list */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-ink2 grid"
              style={{ background: 'var(--bg)', gridTemplateColumns: '1fr auto', borderBottom: '1px solid var(--border)' }}>
              <span>Student</span><span>Status</span>
            </div>
            {studs.length === 0 && (
              <div className="p-5 text-center text-ink3">No students in this class.</div>
            )}
            {studs.map(s => {
              const st = statuses[s.id] || 'absent'
              const iconBg    = st === 'present' ? 'var(--green-l)' : st === 'excuse' ? 'var(--purple-l)' : 'var(--red-l)'
              const iconColor = st === 'present' ? 'var(--green)' : st === 'excuse' ? 'var(--purple)' : 'var(--red)'
              return (
                <div key={s.id} className="att-row-item flex items-center justify-between gap-3 px-3.5 py-2"
                  style={{ borderBottom: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar photo={s.photo} className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                      style={{ background: iconBg, color: iconColor, transition: '.2s' }}>
                      {(s.name || '?').charAt(0).toUpperCase()}
                    </Avatar>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{s.name}</div>
                      <div className="text-xs text-ink2">{s.id}</div>
                    </div>
                  </div>
                  <div className="att-toggle flex gap-1">
                    {(['present', 'excuse', 'absent']).map(opt => {
                      const active = st === opt
                      const label = opt === 'present' ? <><Check size={11} className="inline-block mr-0.5" />Present</> : opt === 'excuse' ? <><ClipboardList size={11} className="inline-block mr-0.5" />Excuse</> : <><X size={11} className="inline-block mr-0.5" />Absent</>

                      const activeCls = opt === 'present' ? 'active-present' : opt === 'excuse' ? 'active-excuse' : 'active-absent'
                      return (
                        <button key={opt} type="button"
                          className={`att-toggle-btn ${active ? activeCls : ''}`}
                          onClick={() => !readOnly && setStatus(s.id, opt)}
                          disabled={readOnly}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-ink2 mt-2.5">{readOnly ? 'This class is archived - attendance records are read-only.' : <>Toggle each student's status then click Save. <ClipboardList size={12} className="inline-block mx-0.5 align-text-bottom" />Excused counts separately from absent.</>}</p>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setView('calendar')}>← Back</button>
            {!readOnly && (
              <button className="btn btn-primary" onClick={saveDay} disabled={saving}>
                {saving ? 'Saving…' : 'Save Attendance'}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

// ── SetRepModal ───────────────────────────────────────────────────────────────
function SetRepModal({ classId, subject, studs, onClose }) {
  const { classes, setSubjectRep } = useData()
  const { toast } = useUI()
  const [saving, setSaving] = useState(false)

  const cls     = classes.find(c => c.id === classId)
  const current = cls?.reps?.[subject] || null

  async function assign(studentId) {
    setSaving(true)
    try {
      await setSubjectRep(classId, subject, studentId)
      const name = studs.find(s => s.id === studentId)?.name || studentId
      toast(`${name} set as representative for ${subject}`, 'green')
      onClose()
    } catch (e) {
      toast('Failed to save: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function clearRep() {
    setSaving(true)
    try {
      await setSubjectRep(classId, subject, null)
      toast(`Representative cleared for ${subject}`, 'green')
      onClose()
    } catch (e) {
      toast('Failed to clear: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} size="sm">
      <div className="flex items-center gap-2 mb-1">
        <UserCheck size={16} />
        <h3 className="mb-0">Set Attendance Representative</h3>
      </div>
      <p className="modal-sub mb-4">{subject} · <span title={cls?.name || ''}>{courseShort(cls?.name)}</span> {cls?.section}</p>

      {current && (
        <div className="rounded-lg p-3 mb-3 flex items-center justify-between gap-2"
          style={{ background: 'var(--accent-l)', border: '1px solid var(--accent)' }}>
          <div className="text-sm">
            <span className="font-semibold text-accent">Current rep: </span>
            <span>{studs.find(s => s.id === current)?.name || current}</span>
          </div>
          <button className="btn btn-ghost btn-sm text-xs" onClick={clearRep} disabled={saving}>
            <UserX size={12} className="inline-block mr-1" />Clear
          </button>
        </div>
      )}

      <div className="text-xs font-bold text-ink2 uppercase tracking-wider mb-2">Select a student</div>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)', maxHeight: 300, overflowY: 'auto' }}>
        {studs.length === 0 && (
          <div className="p-4 text-center text-sm text-ink3">No students in this class.</div>
        )}
        {sortByLastName(studs).map(s => {
          const isRep = s.id === current
          return (
            <button key={s.id} type="button" disabled={saving}
              className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[var(--bg)] transition-colors"
              style={{ borderBottom: '1px solid var(--border)', background: isRep ? 'var(--accent-l)' : undefined }}
              onClick={() => assign(s.id)}>
              <div>
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="text-xs text-ink2">{s.id}</div>
              </div>
              {isRep && <span className="badge badge-blue text-xs">Rep</span>}
            </button>
          )
        })}
      </div>
      <div className="modal-footer">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}

// Tone → app CSS-var colors (light/dark aware). Used by the monitor + cards.
const TONE = {
  danger:  { fg: 'var(--red)',    bg: 'var(--red-l)',    bd: 'var(--red)' },
  warning: { fg: 'var(--gold-var, #ca8a04)', bg: 'var(--yellow-l, #fef9c3)', bd: 'var(--yellow, #ca8a04)' },
  success: { fg: 'var(--green)',  bg: 'var(--green-l)',  bd: 'var(--green)' },
  neutral: { fg: 'var(--ink2)',   bg: 'var(--bg)',       bd: 'var(--border)' },
}

const STREAK_THRESHOLD = 3 // consecutive missed sessions before we flag

// ── SubjectAttCard ─────────────────────────────────────────────────────────────
function SubjectAttCard({ classId, sub, studs, readOnly, onCalendar, onExport, onImport }) {
  const { classes, attendanceSessions, openCheckIn, closeCheckIn } = useData()
  const { toast } = useUI()
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all') // 'all' | 'atrisk' | 'excellent'
  const [repModal, setRepModal] = useState(false)
  const [busyCI, setBusyCI] = useState(false)

  const liveSession = attendanceSessions?.find(s => s.classId === classId && s.subject === sub && s.status === 'open') || null
  const checkedInIds = liveSession ? Object.keys(liveSession.checkedIn || {}) : []

  async function startCheckIn() {
    setBusyCI(true)
    try { await openCheckIn({ classId, subject: sub }); toast('Check-in opened. Share the code with your class.', 'green') }
    catch (e) { toast('Could not open check-in: ' + e.message, 'red') }
    finally { setBusyCI(false) }
  }
  async function endCheckIn() {
    setBusyCI(true)
    try { await closeCheckIn(liveSession); toast('Check-in closed. Students who did not check in are marked absent for today.', 'blue') }
    catch (e) { toast('Could not close check-in: ' + e.message, 'red') }
    finally { setBusyCI(false) }
  }

  const repId   = classes.find(c => c.id === classId)?.reps?.[sub] || null
  const repName = studs.find(s => s.id === repId)?.name || null

  const held = getHeldDays(classId, sub, studs)

  const allStats = useMemo(() => studs.map(s => {
    const present = (s.attendance?.[sub] || new Set()).size
    const excuse  = (s.excuse?.[sub]    || new Set()).size
    const absent  = Math.max(0, held - present - excuse)
    const rate    = held > 0 ? parseFloat(((present / held) * 100).toFixed(1)) : 0
    return { s, name: s.name, id: s.id, present, excuse, absent, rate, dates: s.attendance?.[sub] || new Set() }
  }), [studs, sub, held])

  const avgRate = allStats.length
    ? (allStats.reduce((a, b) => a + b.rate, 0) / allStats.length).toFixed(1)
    : '-'

  const total     = allStats.length
  const excellent = held > 0 ? allStats.filter(s => s.rate >= 90).length : 0
  const poor      = held > 0 ? allStats.filter(s => s.rate < 80).length : 0

  // ── On-device attendance monitor (deterministic, $0) ───────────────────────
  // Recomputes from the same numbers the cards show, so it can never disagree.
  // Per-student flag priority: absence streak → below 80% → perfect attendance.
  const monitor = useMemo(() => {
    const sessionDates = subjectSessionDates(classId, sub, studs)
    const flags = {}     // studentId → { tone, Icon, text, sortKey }
    let onStreak = 0
    allStats.forEach(({ s, rate }) => {
      const streak = held > 0 ? trailingAbsenceStreak(s, sub, sessionDates) : 0
      if (streak >= STREAK_THRESHOLD) {
        flags[s.id] = { tone: 'danger', Icon: AlertTriangle, text: `${streak} sessions missed in a row`, short: `${streak} absent in a row`, sortKey: 100 + streak }
        onStreak++
      } else if (held > 0 && rate < 80) {
        flags[s.id] = { tone: 'warning', Icon: TrendingDown, text: 'Below 80% - watch', short: `${rate}%, falling`, sortKey: 50 - rate }
      } else if (held > 0 && rate >= 100) {
        flags[s.id] = { tone: 'success', Icon: Star, text: s.id === repId ? 'Perfect attendance · rep' : 'Perfect attendance', short: 'perfect', sortKey: -1 }
      }
    })
    const flagged = Object.entries(flags)
      .filter(([, f]) => f.tone !== 'success')
      .map(([id, f]) => ({ id, name: studs.find(x => x.id === id)?.name || id, ...f }))
      .sort((a, b) => b.sortKey - a.sortKey)
    const onTrack = total - flagged.length
    const health = avgRate === '-' ? '' : avgRate >= 90 ? 'excellent' : avgRate >= 80 ? 'healthy' : avgRate >= 70 ? 'needs a push' : 'concerning'
    return { flags, flagged, onStreak, onTrack, health }
  }, [allStats, studs, classId, sub, held, repId, avgRate, total])

  const filtered = useMemo(() => {
    if (filter === 'atrisk')    return allStats.filter(s => held > 0 && s.rate < 80)
    if (filter === 'excellent') return allStats.filter(s => held > 0 && s.rate >= 90)
    return allStats
  }, [allStats, filter, held])

  const slice = filtered.slice((page - 1) * ATT_PER_PAGE, page * ATT_PER_PAGE)

  function setFilterReset(f) { setFilter(f); setPage(1) }

  // Avatar/rate color tier by rate (gray when no sessions yet).
  function tierColor(rate) {
    if (held === 0) return { fg: 'var(--ink2)', bg: 'var(--bg)' }
    if (rate >= 90) return { fg: 'var(--green)', bg: 'var(--green-l)' }
    if (rate >= 80) return { fg: 'var(--gold-var, #ca8a04)', bg: 'var(--yellow-l, #fef9c3)' }
    return { fg: 'var(--red)', bg: 'var(--red-l)' }
  }

  return (
    <div className="card card-pad mb-3">
      {/* Header - Check-in stays out front; the rest live in the ⋮ menu */}
      <div className="sec-hdr mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 15 }}>{sub}</strong>
          {repName && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'var(--accent-l)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
              <UserCheck size={11} />Rep: {repName}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 items-center">
          {!readOnly && !liveSession && (
            <button className="btn btn-success btn-sm" onClick={startCheckIn} disabled={busyCI} title="Open a live self check-in code for today">
              <Radio size={13} className="inline-block mr-1" />Check-in
            </button>
          )}
          <KebabMenu
            label={`Actions for ${sub}`}
            items={[
              { label: <><CalendarDays size={13} className="inline-block mr-2 align-text-bottom" />Calendar</>, onClick: () => onCalendar(sub) },
              !readOnly && { label: <><UserCheck size={13} className="inline-block mr-2 align-text-bottom" />Set rep</>, onClick: () => setRepModal(true) },
              !readOnly && onImport && { label: <><Download size={13} className="inline-block mr-2 align-text-bottom" />Import</>, onClick: () => onImport(sub) },
              { label: <><Upload size={13} className="inline-block mr-2 align-text-bottom" />Export</>, onClick: () => onExport(sub) },
            ]}
          />
        </div>
      </div>

      {/* Attendance monitor - on-device, recomputed live from the cards below */}
      <div className="rounded-xl mb-3" style={{ background: 'var(--accent-l)', border: '1px solid var(--accent)', padding: 14 }}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Radar size={16} style={{ color: 'var(--accent)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--accent)' }}>Attendance monitor</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>on-device · live</span>
        </div>
        <p className="text-sm mb-0" style={{ color: 'var(--ink)', lineHeight: 1.55 }}>
          {held === 0
            ? <>No sessions recorded yet. Open a check-in or mark a day on the calendar to start tracking.</>
            : <>{held} session{held !== 1 ? 's' : ''} held. Class average is <strong>{avgRate}%</strong>{monitor.health ? <> - {monitor.health}</> : null}.{' '}
                {monitor.flagged.length === 0
                  ? <>Everyone is on track.</>
                  : <><strong>{monitor.flagged.length} student{monitor.flagged.length !== 1 ? 's' : ''}</strong> need{monitor.flagged.length === 1 ? 's' : ''} attention{monitor.onStreak > 0 ? <> - {monitor.onStreak} on an absence streak</> : null}.</>}
              </>}
        </p>
        {(monitor.flagged.length > 0 || (held > 0 && monitor.onTrack > 0)) && (
          <div className="flex gap-1.5 flex-wrap mt-2.5">
            {monitor.flagged.slice(0, 4).map(f => {
              const t = TONE[f.tone]
              return (
                <button key={f.id} type="button" onClick={() => setFilterReset('atrisk')} title="Show at-risk students"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold"
                  style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, padding: '4px 10px', borderRadius: 999, cursor: 'pointer' }}>
                  <f.Icon size={12} />{f.name.split(',')[0] || f.name} · {f.short}
                </button>
              )
            })}
            {monitor.flagged.length > 4 && (
              <button type="button" onClick={() => setFilterReset('atrisk')}
                className="inline-flex items-center text-xs font-semibold"
                style={{ background: 'var(--bg)', color: 'var(--ink2)', border: '1px solid var(--border)', padding: '4px 10px', borderRadius: 999, cursor: 'pointer' }}>
                +{monitor.flagged.length - 4} more
              </button>
            )}
            {held > 0 && monitor.onTrack > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold"
                style={{ background: 'var(--green-l)', color: 'var(--green)', border: '1px solid var(--green)', padding: '4px 10px', borderRadius: 999 }}>
                <Check size={12} />{monitor.onTrack} on track
              </span>
            )}
          </div>
        )}
      </div>

      {/* Live check-in panel */}
      {liveSession && (
        <div style={{ background: 'var(--green-l)', border: '1px solid var(--green)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--green)', textTransform: 'uppercase' }}>
                <Radio size={13} /> Live check-in
              </span>
              <button
                onClick={() => { try { navigator.clipboard?.writeText(liveSession.code); toast('Code copied.', 'green') } catch (e) {} }}
                title="Click to copy"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 30, fontWeight: 700, letterSpacing: '.18em', color: 'var(--ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {liveSession.code}<Copy size={16} style={{ color: 'var(--ink3)' }} />
              </button>
              <span style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 600 }}>
                {checkedInIds.length} / {studs.length} checked in
              </span>
            </div>
            <button className="btn btn-danger btn-sm" onClick={endCheckIn} disabled={busyCI}>
              <X size={13} className="inline-block mr-1" />Close session
            </button>
          </div>
          {/* Scan-to-check-in QR - opens AcadFlow with the code pre-filled */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            <QRCode value={`${window.location.origin}/?checkin=${liveSession.code}`} size={132} />
            <div style={{ fontSize: 12, color: 'var(--ink2)', flex: 1, minWidth: 180 }}>
              Students can <strong>scan this QR with their phone camera</strong> to check in instantly - or enter the code
              <strong> {liveSession.code}</strong> on their Attendance tab. Closing the session marks everyone who did not check in as absent.
            </div>
          </div>
          {checkedInIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {checkedInIds.map(id => {
                const st = studs.find(x => x.id === id)
                return (
                  <span key={id} className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Check size={11} />{st?.name || id}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {repModal && (
        <SetRepModal
          classId={classId}
          subject={sub}
          studs={studs}
          onClose={() => setRepModal(false)}
        />
      )}

      {/* Summary metric cards - trimmed to the three that matter */}
      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <div className="text-xs text-ink2">Avg attendance</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{held > 0 ? `${avgRate}%` : '-'}</div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <div className="text-xs text-ink2">Sessions held</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{held}</div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
          <div className="text-xs text-ink2">At-risk &lt;80%</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: poor ? 'var(--red)' : 'var(--ink)' }}>{poor}</div>
        </div>
      </div>

      {/* Quick filters */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        {[
          { k: 'all',       label: 'All',       n: total },
          { k: 'atrisk',    label: 'At-risk',   n: poor },
          { k: 'excellent', label: 'Excellent', n: excellent },
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

      {/* Roster - one responsive card grid for every screen size */}
      <div className="att-card-grid">
        {slice.length === 0 && <div style={{ gridColumn: '1 / -1' }}><EmptyState compact title="No students." /></div>}
        {slice.map(st => {
          const flag = monitor.flags[st.id]
          const tier = tierColor(st.rate)
          const rateDisplay = held === 0 ? '-' : `${st.rate}%`
          const initial = (st.name || '?').charAt(0).toUpperCase()
          return (
            <div key={st.id} className="rounded-xl p-3"
              style={{ background: 'var(--surface)', border: `1px solid ${flag?.tone === 'danger' ? 'var(--red)' : 'var(--border)'}` }}>
              <div className="flex items-center gap-2.5">
                <Avatar photo={st.photo} className="flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ width: 38, height: 38, borderRadius: '50%', background: tier.bg, color: tier.fg }}>
                  {initial}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{st.name}</div>
                  <div className="text-xs text-ink3 truncate" style={{ fontFamily: 'var(--font-mono)' }}>{st.id}</div>
                </div>
                <span className="font-bold text-sm flex-shrink-0" style={{ color: tier.fg }}>{rateDisplay}</span>
              </div>

              {flag && (
                <div className="flex items-center gap-1.5 mt-2.5 text-xs font-semibold"
                  style={{ background: TONE[flag.tone].bg, color: TONE[flag.tone].fg, padding: '3px 8px', borderRadius: 6 }}>
                  <flag.Icon size={12} className="flex-shrink-0" />
                  <span className="truncate">{flag.text}</span>
                </div>
              )}

              <div className="grid mt-2.5 pt-2.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                <div><div style={{ fontSize: 17, fontWeight: 800, color: 'var(--green)' }}>{st.present}</div><div className="text-xs text-ink3">Present</div></div>
                <div><div style={{ fontSize: 17, fontWeight: 800, color: 'var(--gold-var, #ca8a04)' }}>{st.excuse}</div><div className="text-xs text-ink3">Excused</div></div>
                <div><div style={{ fontSize: 17, fontWeight: 800, color: 'var(--red)' }}>{st.absent}</div><div className="text-xs text-ink3">Absent</div></div>
              </div>
            </div>
          )
        })}
      </div>

      <Pagination total={filtered.length} perPage={ATT_PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}

// ── AttendanceTab ──────────────────────────────────────────────────────────────
export default function AttendanceTab() {
  const { classes, students, fbReady, excuseRequests, decideExcuseRequest } = useData()
  const { toast, pendingExcuse, clearPendingExcuse } = useUI()
  const excuseHighlightId = useRedirectHighlight('excuse')
  const [showArchived,  setShowArchived]  = useState(false)
  const [excuseBusy, setExcuseBusy] = useState('')
  const activeClasses   = useMemo(() => classes.filter(c => !c.archived), [classes])
  const archivedClasses = useMemo(() => classes.filter(c =>  c.archived), [classes])
  const visibleClasses  = showArchived ? archivedClasses : activeClasses

  const [selKey,       setSelKey]       = useState(null) // `${classId}|||${subject}`
  const [search,       setSearch]       = useState('')
  const [calModal,     setCalModal]     = useState(null) // subject string
  const [exportModal,  setExportModal]  = useState(null) // subject string
  const [importModal,  setImportModal]  = useState(null) // subject string

  // One option per class+subject pair - mirrors the Grades subject dropdown.
  const subjectOptions = useMemo(() =>
    visibleClasses.flatMap(c => (c.subjects || []).map(sub => ({
      key: `${c.id}|||${sub}`, classId: c.id, sub,
      label: `${sub} - ${classTag(c)}`,
    }))), [visibleClasses])

  const selected    = subjectOptions.find(o => o.key === selKey) || subjectOptions[0] || null
  const cls         = selected ? (visibleClasses.find(c => c.id === selected.classId) || null) : null
  const effectiveId = cls?.id || null
  const selSub      = selected?.sub || null

  const filteredStuds = useMemo(() => {
    const base = sortByLastName(students.filter(s => s.classId === effectiveId || s.classIds?.includes(effectiveId)))
    if (!search.trim()) return base
    const q = search.toLowerCase()
    return base.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  }, [students, effectiveId, search])

  const pendingExcuses = useMemo(
    () => (excuseRequests || []).filter(r => r.status === 'pending' && r.classId === effectiveId),
    [excuseRequests, effectiveId]
  )

  // Deep-linked from a "new excuse request" notification: select the excuse's
  // class+subject so it shows in the (class-filtered) review list, then the
  // useRedirectHighlight('excuse') above scrolls it into view and glows it.
  useEffect(() => {
    if (!pendingExcuse) return
    setSelKey(`${pendingExcuse.classId}|||${pendingExcuse.subject}`)
    clearPendingExcuse()
  }, [pendingExcuse]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Triage (#26): on-device ranking + tagging of pending excuses ────────────
  const [triage, setTriage] = useState(null)     // { byId, order, modelUsed } | null
  const [triaging, setTriaging] = useState(false)
  useEffect(() => { prewarmEmbeddings() }, [])
  // Drop a stale triage when the selected class changes.
  useEffect(() => { setTriage(null) }, [effectiveId])

  async function runTriage() {
    setTriaging(true)
    try {
      const res = await triageExcuses(pendingExcuses, excuseRequests || [], { classId: effectiveId })
      setTriage(res)
      const need = Object.values(res.byId).filter(m => m.copy || m.frequent || m.substance === 'Vague' || m.stale).length
      toast(need ? `Sorted ${pendingExcuses.length} request${pendingExcuses.length === 1 ? '' : 's'} - ${need} need${need === 1 ? 's' : ''} a closer look.` : `Sorted ${pendingExcuses.length} request${pendingExcuses.length === 1 ? '' : 's'} - nothing stands out.`, need ? 'dark' : 'green')
    } catch {
      toast('Could not run triage on this device.', 'red')
    } finally {
      setTriaging(false)
    }
  }

  // Apply triage ordering when present (else submission order).
  const orderedExcuses = useMemo(() => {
    if (!triage) return pendingExcuses
    const idx = {}; pendingExcuses.forEach(r => { idx[r.id] = r })
    const seen = new Set()
    const out = triage.order.map(id => idx[id]).filter(Boolean)
    out.forEach(r => seen.add(r.id))
    pendingExcuses.forEach(r => { if (!seen.has(r.id)) out.push(r) }) // any new since triage
    return out
  }, [triage, pendingExcuses])

  async function decideExcuse(req, approve) {
    setExcuseBusy(req.id)
    try {
      await decideExcuseRequest(req, approve)
      toast(approve ? `Excuse approved for ${req.studentName}.` : `Excuse denied.`, approve ? 'green' : 'blue')
    } catch (e) {
      toast('Could not update request: ' + e.message, 'red')
    } finally {
      setExcuseBusy('')
    }
  }

  if (!fbReady) return <SkeletonTable />

  return (
    <div>
      <PageHeader
        title="Attendance"
        actions={
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setShowArchived(v => !v); setSelKey(null); setSearch('') }}
          >
            {showArchived
              ? <><ArchiveRestore size={14} className="inline-block mr-1" />Active Classes</>
              : <><Archive size={14} className="inline-block mr-1" />Archived Classes</>}
          </button>
        }
      />

      {showArchived && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-sm"
          style={{ background: 'var(--yellow-l, #fef9c3)', color: 'var(--yellow-d, #854d0e)', border: '1px solid var(--yellow, #ca8a04)' }}>
          <Archive size={14} className="shrink-0" />
          Viewing archived class data - read-only.
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select className="input" style={{ flex: '1 1 280px', maxWidth: 420 }}
          value={selected?.key || ''}
          onChange={e => { setSelKey(e.target.value); setSearch('') }}>
          <option value="">- Select a subject -</option>
          {subjectOptions.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <input className="input" style={{ flex: '1 1 160px', maxWidth: 220 }}
          aria-label="Search students"
          placeholder="Search student…"
          value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Excuse requests (pending) for this class */}
      {effectiveId && pendingExcuses.length > 0 && (
        <div className="card card-pad mb-3">
          <div className="sec-hdr mb-2">
            <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ClipboardList size={15} /> Excuse Requests
              <span className="badge badge-yellow">{pendingExcuses.length}</span>
            </div>
            {pendingExcuses.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={runTriage} disabled={triaging}
                title="Rank & tag these requests on-device (advisory - Approve/Deny unchanged)">
                <ListFilter size={13} className="inline-block mr-1" />{triaging ? 'Triaging…' : triage ? 'Re-triage' : 'Triage'}
              </button>
            )}
          </div>
          {triage && (
            <p className="text-xs text-ink3 mb-2">Sorted with the ones needing a closer look first. Tags are hints only - your decision stands.</p>
          )}
          <div className="flex flex-col gap-2">
            {orderedExcuses.map(r => {
              const m = triage?.byId[r.id]
              return (
              <div key={r.id} id={`excuse-${r.id}`} className={`flex items-center justify-between gap-3 flex-wrap${excuseHighlightId === r.id ? ' redirect-glow' : ''}`}
                style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {r.studentName} <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>· {r.subject} · {r.date}</span>
                  </div>
                  {r.reason && <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{r.reason}</div>}
                  {m && (
                    <div className="flex flex-wrap gap-1" style={{ marginTop: 5 }}>
                      {m.category !== 'Other' && <ExcuseChip text={m.category} bg="var(--bg)" fg="var(--ink2)" />}
                      <ExcuseChip
                        text={m.substance}
                        bg={m.substance === 'Detailed' ? 'var(--green-l)' : m.substance === 'Vague' ? 'var(--red-l, #fee2e2)' : 'var(--bg)'}
                        fg={m.substance === 'Detailed' ? 'var(--green)' : m.substance === 'Vague' ? 'var(--red)' : 'var(--ink3)'}
                      />
                      {m.frequent && <ExcuseChip text={`${m.freqCount} requests this class`} bg="var(--yellow-l, #fef9c3)" fg="var(--gold-var)" />}
                      {m.stale && <ExcuseChip text={`${Math.round(m.ageDays)}d pending`} bg="var(--yellow-l, #fef9c3)" fg="var(--gold-var)" />}
                      {m.copy && <ExcuseChip text={m.copyWith ? `similar to ${m.copyWith}` : 'possible copy'} bg="var(--red-l, #fee2e2)" fg="var(--red)" />}
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button className="btn btn-success btn-sm" disabled={excuseBusy === r.id} onClick={() => decideExcuse(r, true)}>
                    <Check size={13} className="inline-block mr-1" />Approve
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={excuseBusy === r.id} onClick={() => decideExcuse(r, false)}>
                    <X size={13} className="inline-block mr-1" />Deny
                  </button>
                </div>
              </div>
              )
            })}
          </div>
        </div>
      )}

      {!subjectOptions.length ? (
        <EmptyState Icon={ClipboardCheck} title={showArchived ? 'No archived classes.' : 'No classes yet.'} />
      ) : !selSub ? (
        <EmptyState title="Select a subject to view attendance." />
      ) : (
        <SubjectAttCard
          key={selected.key}
          classId={effectiveId}
          sub={selSub}
          studs={filteredStuds}
          readOnly={showArchived}
          onCalendar={sub => setCalModal(sub)}
          onExport={sub => setExportModal(sub)}
          onImport={showArchived ? null : sub => setImportModal(sub)}
        />
      )}

      {calModal && (
        <AttendanceCalendarModal
          classId={effectiveId}
          subject={calModal}
          readOnly={showArchived}
          onClose={() => setCalModal(null)}
        />
      )}
      {exportModal && (
        <Suspense fallback={null}>
          <ExportPreviewModal
            type="attendance"
            classId={effectiveId}
            subject={exportModal}
            onClose={() => setExportModal(null)}
          />
        </Suspense>
      )}
      {importModal && (
        <ImportAttendanceModal
          classId={effectiveId}
          subject={importModal}
          onClose={() => setImportModal(null)}
        />
      )}
    </div>
  )
}
