import React, { useState, useMemo, useRef, lazy, Suspense } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { sortByLastName } from '@/utils/format'
import { fmtDateShort } from '@/utils/format'
import { getHeldDays } from '@/utils/grades'
import Modal from '@/components/primitives/Modal'
import Pagination from '@/components/primitives/Pagination'

const ExportPreviewModal = lazy(() => import('@/components/admin/modals/ExportPreviewModal'))

const ATT_PER_PAGE = 10
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
    // M/D/YYYY or D/M/YYYY — treat as M/D/YYYY (common in PH Excel exports)
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
      toast(`Imported attendance for ${changedIds.size} student(s) — ${preview.dates.length} date(s).`, 'green')
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
          <h3 className="mb-0">📥 Import Attendance</h3>
          <p className="modal-sub mb-0">{subject}</p>
        </div>
        <button className="btn btn-ghost text-xs" onClick={downloadTemplate}>
          ⬇ Download Template
        </button>
      </div>

      {/* Format hint */}
      <div className="rounded-lg p-3 mb-4 text-xs" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <strong>Expected format:</strong> Column A = Student No., remaining columns = dates (header: YYYY-MM-DD or M/D/YYYY).
        Cell values: <strong>P</strong> / Present, <strong>E</strong> / Excuse, <strong>A</strong> / Absent (or blank).
        Sheet name should match the subject name for auto-detection.
        <br /><strong>Tip:</strong> Download the template above — it's pre-filled with your students and today's dates.
      </div>

      {/* File picker */}
      <div className="mb-3">
        <label className="block text-xs font-semibold text-ink2 mb-1">Select Excel / CSV file</label>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
          className="input" style={{ paddingTop: 6, paddingBottom: 6 }}
          onChange={handleFile} />
      </div>

      {parsing && <div className="text-sm text-ink2 mb-3">Parsing file…</div>}
      {error   && <div className="rounded-lg p-3 mb-3 text-sm" style={{ background: 'var(--red-l)', color: 'var(--red)' }}>⚠ {error}</div>}

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
              { val: 'merge',   label: '🔀 Merge',   desc: 'Add imported dates; keep existing records' },
              { val: 'replace', label: '♻ Replace',  desc: 'Overwrite this subject\'s attendance entirely' },
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
function AttendanceCalendarModal({ classId, subject, onClose }) {
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
      toast('Saved locally — sync failed: ' + e.message, 'red')
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
          <h3 className="mb-0">📅 Attendance</h3>
          <p className="modal-sub mb-0">{subject} · {cls?.name} {cls?.section}</p>
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
                    <div key={dateStr} className={cls2} style={{ position: 'relative', cursor: 'pointer' }}
                      onClick={() => openDay(dateStr)}
                      title={`${dateStr} — Click to mark attendance`}>
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
            <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>📅 Click any day to mark attendance</span>
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
              <div className="font-bold text-sm text-white">📅 {selDateLabel}</div>
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
            <button className="btn btn-green btn-sm" onClick={() => setAll('present')}>✓ All Present</button>
            <button className="btn btn-sm" style={{ background: 'var(--purple-l)', color: 'var(--purple)' }}
              onClick={() => setAll('excuse')}>📋 All Excused</button>
            <button className="btn btn-danger btn-sm" onClick={() => setAll('absent')}>✗ All Absent</button>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
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
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                      style={{ background: iconBg, color: iconColor, transition: '.2s' }}>
                      {(s.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{s.name}</div>
                      <div className="text-xs text-ink2">{s.id}</div>
                    </div>
                  </div>
                  <div className="att-toggle flex gap-1">
                    {(['present', 'excuse', 'absent']).map(opt => {
                      const active = st === opt
                      const label = opt === 'present' ? '✓ Present' : opt === 'excuse' ? '📋 Excuse' : '✗ Absent'
                      const activeCls = opt === 'present' ? 'active-present' : opt === 'excuse' ? 'active-excuse' : 'active-absent'
                      return (
                        <button key={opt} type="button"
                          className={`att-toggle-btn ${active ? activeCls : ''}`}
                          onClick={() => setStatus(s.id, opt)}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-ink2 mt-2.5">Toggle each student's status then click Save. 📋 Excused counts separately from absent.</p>

          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setView('calendar')}>← Back</button>
            <button className="btn btn-primary" onClick={saveDay} disabled={saving}>
              {saving ? 'Saving…' : 'Save Attendance'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── Sort icon ─────────────────────────────────────────────────────────────────
function SortIcon({ col, sort }) {
  if (sort.col !== col) return <span className="th-sort-icon">↕</span>
  return <span className={`th-sort-icon ${sort.dir === 'asc' ? 'asc' : 'desc'}`}>↕</span>
}

// ── SubjectAttCard ─────────────────────────────────────────────────────────────
function SubjectAttCard({ classId, sub, studs, onCalendar, onExport, onImport }) {
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' })
  const [page, setPage] = useState(1)

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
    : '—'

  const total     = allStats.length
  const withRec   = allStats.filter(() => held > 0)
  const excellent = withRec.filter(s => s.rate >= 90).length
  const good      = withRec.filter(s => s.rate >= 80 && s.rate < 90).length
  const poor      = withRec.filter(s => s.rate < 80).length
  const exPct     = total ? Math.round(excellent / total * 100) : 0
  const goPct     = total ? Math.round(good      / total * 100) : 0
  const poPct     = total ? Math.round(poor      / total * 100) : 0

  function toggleSort(col) {
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }))
    setPage(1)
  }

  const sorted = useMemo(() => {
    return [...allStats].sort((a, b) => {
      let av, bv
      if (sort.col === 'name')    { av = a.name;    bv = b.name }
      else if (sort.col === 'present') { av = a.present; bv = b.present }
      else if (sort.col === 'excuse')  { av = a.excuse;  bv = b.excuse }
      else if (sort.col === 'absent')  { av = a.absent;  bv = b.absent }
      else if (sort.col === 'rate')    { av = a.rate;    bv = b.rate }
      else { av = a.name; bv = b.name }
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? av - bv : bv - av
    })
  }, [allStats, sort])

  const slice = sorted.slice((page - 1) * ATT_PER_PAGE, page * ATT_PER_PAGE)

  return (
    <div className="card card-pad mb-3">
      {/* Header */}
      <div className="sec-hdr mb-2 flex-wrap gap-2">
        <strong style={{ fontSize: 15 }}>{sub}</strong>
        <div className="flex gap-1.5">
          <button className="btn btn-primary btn-sm" onClick={() => onCalendar(sub)}>📅 Calendar</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onImport(sub)} title="Import attendance from Excel">📥 Import</button>
          <button className="btn btn-ghost btn-sm" onClick={() => onExport(sub)} title="Export attendance">📤 Export</button>
        </div>
      </div>

      {/* Distribution */}
      <div className="rounded-lg p-3 mb-3" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1.5">
          <div className="text-xs font-bold text-ink2 uppercase" style={{ letterSpacing: '.06em' }}>Attendance Distribution</div>
          <div className="flex gap-2.5 text-xs text-ink2 flex-wrap">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--green)' }} />≥90%: {excellent}</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--yellow)' }} />80–89%: {good}</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: 'var(--red)' }} />&lt;80%: {poor}</span>
          </div>
        </div>
        <div className="flex h-2.5 rounded-md overflow-hidden" style={{ background: 'var(--border)' }}>
          {exPct > 0 && <div style={{ width: `${exPct}%`, background: 'var(--green)', transition: 'width .4s' }} />}
          {goPct > 0 && <div style={{ width: `${goPct}%`, background: 'var(--yellow)', transition: 'width .4s' }} />}
          {poPct > 0 && <div style={{ width: `${poPct}%`, background: 'var(--red)',   transition: 'width .4s' }} />}
        </div>
        <div className="mt-1.5 text-xs text-ink3">
          Sessions held: <strong className="text-ink">{held}</strong> · Avg. rate: <strong className="text-ink">{avgRate}{held > 0 ? '%' : ''}</strong>
        </div>
      </div>

      {/* Table */}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {[
                { col: 'name',    label: 'Student' },
                { col: 'present', label: 'Present' },
                { col: 'excuse',  label: 'Excused' },
                { col: 'absent',  label: 'Absent' },
                { col: 'rate',    label: 'Rate' },
              ].map(({ col, label }) => (
                <th key={col} className="th-sort" onClick={() => toggleSort(col)}>
                  {label} <SortIcon col={col} sort={sort} />
                </th>
              ))}
              <th>Recent Dates</th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr><td colSpan={6}><div className="empty">No students.</div></td></tr>
            )}
            {slice.map(st => {
              const rBadge = held === 0 ? 'badge-gray' : st.rate >= 90 ? 'badge-green' : st.rate >= 80 ? 'badge-yellow' : 'badge-red'
              const rateDisplay = held === 0 ? '—' : `${st.rate}%`
              const recentDates = [...st.dates].sort().slice(-4)
              return (
                <tr key={st.id}>
                  <td>
                    <strong>{st.name}</strong><br />
                    <small className="text-ink2">{st.id}</small>
                  </td>
                  <td><span className="badge badge-green">{st.present}</span></td>
                  <td><span className="badge badge-yellow">{st.excuse}</span></td>
                  <td><span className="badge badge-red">{st.absent}</span></td>
                  <td><span className={`badge ${rBadge}`}>{rateDisplay}</span></td>
                  <td style={{ fontSize: 12 }}>
                    {recentDates.length > 0
                      ? recentDates.map(d => (
                          <span key={d} className="badge badge-green" style={{ margin: 1 }}>{fmtDateShort(d)}</span>
                        ))
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination total={allStats.length} perPage={ATT_PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}

// ── AttendanceTab ──────────────────────────────────────────────────────────────
export default function AttendanceTab() {
  const { classes, students } = useData()
  const [selClassId,   setSelClassId]   = useState(() => classes[0]?.id || null)
  const [search,       setSearch]       = useState('')
  const [calModal,     setCalModal]     = useState(null) // subject string
  const [exportModal,  setExportModal]  = useState(null) // subject string
  const [importModal,  setImportModal]  = useState(null) // subject string

  const cls = classes.find(c => c.id === selClassId) || classes[0] || null
  const effectiveId = cls?.id || null

  const filteredStuds = useMemo(() => {
    const base = sortByLastName(students.filter(s => s.classId === effectiveId || s.classIds?.includes(effectiveId)))
    if (!search.trim()) return base
    const q = search.toLowerCase()
    return base.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
  }, [students, effectiveId, search])

  return (
    <div>
      <div className="sec-hdr mb-3">
        <div className="sec-title">Attendance</div>
      </div>

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
        <div className="empty"><div className="empty-icon">📋</div>No classes yet.</div>
      ) : !cls?.subjects?.length ? (
        <div className="empty">This class has no subjects.</div>
      ) : (
        cls.subjects.map(sub => (
          <SubjectAttCard
            key={sub}
            classId={effectiveId}
            sub={sub}
            studs={filteredStuds}
            onCalendar={sub => setCalModal(sub)}
            onExport={sub => setExportModal(sub)}
            onImport={sub => setImportModal(sub)}
          />
        ))
      )}

      {calModal && (
        <AttendanceCalendarModal
          classId={effectiveId}
          subject={calModal}
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
