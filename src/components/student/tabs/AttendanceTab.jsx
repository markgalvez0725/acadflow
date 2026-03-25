import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { CalendarCheck, Calendar, CheckCircle2, FileCheck, XCircle, Award } from 'lucide-react'

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export default function AttendanceTab({ student: s, viewClassId, classes }) {
  const { students } = useData()

  const cls = classes?.find(c => c.id === viewClassId) || null

  // Get all enrolled class IDs for multi-subject support
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allEnrolledSubs = enrolledIds.length
    ? [...new Set(enrolledIds.flatMap(id => classes.find(c => c.id === id)?.subjects || []))]
    : Object.keys(s.attendance || {})

  const subs = allEnrolledSubs.length ? allEnrolledSubs : Object.keys(s.attendance || {})

  const [activeSub, setActiveSub] = useState(() => subs[0] || null)

  // Global totals
  const classMates = enrolledIds.length ? students.filter(x => {
    const xEnrolledIds = x.classIds?.length ? x.classIds : (x.classId ? [x.classId] : [])
    return xEnrolledIds.some(id => enrolledIds.includes(id))
  }) : []
  const { totalPresent, totalExcuse, totalExpected } = useMemo(() => {
    let p = 0, e = 0, exp = 0
    subs.forEach(sub => {
      p   += (s.attendance?.[sub] || new Set()).size
      e   += (s.excuse?.[sub]    || new Set()).size
      const held = [...classMates, s].reduce((mx, x) => {
        const sz = (x.attendance?.[sub] || new Set()).size + (x.excuse?.[sub] || new Set()).size
        return Math.max(mx, sz)
      }, 0)
      exp += held
    })
    return { totalPresent: p, totalExcuse: e, totalExpected: exp }
  }, [s, subs, classMates])
  const totalAbsent = Math.max(0, totalExpected - totalPresent - totalExcuse)
  const globalRate = totalExpected > 0 ? totalPresent / totalExpected * 100 : 0
  const rateColor = globalRate >= 90 ? 'var(--green)' : globalRate >= 80 ? 'var(--yellow)' : 'var(--red)'

  if (!subs.length) {
    return (
      <div className="empty"><div className="empty-icon"><CalendarCheck size={40} /></div>No attendance records yet.</div>
    )
  }

  return (
    <div className="student-attendance">
      {/* Global stats */}
      <div className="sa-stat-row mb-4">
        <div className="sa-stat">
          <div className="sa-stat-val good">{totalPresent}</div>
          <div className="sa-stat-lbl">Present</div>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-val bad">{totalAbsent}</div>
          <div className="sa-stat-lbl">Absent</div>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-val" style={{ color: 'var(--purple)' }}>{totalExcuse}</div>
          <div className="sa-stat-lbl">Excused</div>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-val" style={{ color: rateColor }}>{globalRate.toFixed(1)}%</div>
          <div className="sa-stat-lbl">Rate</div>
        </div>
      </div>

      {/* Subject pills */}
      <div className="sa-sub-pills mb-3">
        {subs.map(sub => {
          const p = (s.attendance?.[sub] || new Set()).size
          const e = (s.excuse?.[sub]    || new Set()).size
          const held = [...classMates, s].reduce((mx, x) => {
            const sz = (x.attendance?.[sub] || new Set()).size + (x.excuse?.[sub] || new Set()).size
            return Math.max(mx, sz)
          }, 0)
          const subRate = held > 0 ? p / held * 100 : 0
          const dot = subRate >= 90 ? 'var(--green)' : subRate >= 80 ? 'var(--yellow)' : 'var(--red)'
          const isActive = sub === activeSub
          return (
            <button
              key={sub}
              className={`sa-sub-pill${isActive ? ' active' : ''}`}
              onClick={() => setActiveSub(sub)}
            >
              <span className="sa-pill-dot" style={{ background: isActive ? '#fff' : dot }} />
              {sub}
            </button>
          )
        })}
      </div>

      {/* Detail */}
      {activeSub && (
        <SubjectDetail
          sub={activeSub}
          student={s}
          cls={cls}
          students={students}
        />
      )}
    </div>
  )
}

function SubjectDetail({ sub, student: s, cls, students }) {
  const presentSet = s.attendance?.[sub] || new Set()
  const excuseSet  = s.excuse?.[sub]     || new Set()

  // Collect all admin-recorded dates for this subject across the class
  const sEnrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allAdminDates = useMemo(() => {
    const set = new Set()
    if (cls) {
      students.filter(x => {
        const xIds = x.classIds?.length ? x.classIds : (x.classId ? [x.classId] : [])
        return xIds.some(id => sEnrolledIds.includes(id))
      }).forEach(x => {
        ;(x.attendance?.[sub] || new Set()).forEach(d => set.add(d))
        ;(x.excuse?.[sub]     || new Set()).forEach(d => set.add(d))
      })
    }
    return set
  }, [sub, s, cls, students, sEnrolledIds])

  const classMates = sEnrolledIds.length
    ? students.filter(x => {
        const xIds = x.classIds?.length ? x.classIds : (x.classId ? [x.classId] : [])
        return xIds.some(id => sEnrolledIds.includes(id))
      })
    : []
  const expected = [...classMates, s].reduce((mx, x) => {
    const sz = (x.attendance?.[sub] || new Set()).size + (x.excuse?.[sub] || new Set()).size
    return Math.max(mx, sz)
  }, 0)
  const absent = Math.max(0, expected - presentSet.size - excuseSet.size)
  const rate = expected > 0 ? presentSet.size / expected * 100 : 0
  const rateColor = rate >= 90 ? 'var(--green)' : rate >= 80 ? 'var(--yellow)' : 'var(--red)'

  const absentDates = useMemo(() =>
    [...allAdminDates].filter(d => !presentSet.has(d) && !excuseSet.has(d)).sort(),
    [allAdminDates, presentSet, excuseSet]
  )

  // Calendar state
  const allDates = [...new Set([...presentSet, ...excuseSet])].sort()
  const months = [...new Set(allDates.map(d => d.slice(0, 7)))].sort()
  if (!months.length) months.push(new Date().toISOString().slice(0, 7))

  const lastMonth = months[months.length - 1].split('-')
  const [calYear, setCalYear]   = useState(() => parseInt(lastMonth[0]))
  const [calMonth, setCalMonth] = useState(() => parseInt(lastMonth[1]) - 1)
  const [viewMode, setViewMode] = useState('calendar')

  function navCal(dir) {
    let m = calMonth + dir
    let y = calYear
    if (m > 11) { m = 0; y++ }
    if (m < 0)  { m = 11; y-- }
    setCalMonth(m)
    setCalYear(y)
  }

  return (
    <div>
      {/* Sub-header */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{sub}</div>
          {cls && <div style={{ fontSize: 11, color: 'var(--ink2)', marginTop: 2 }}>{cls.name} · {cls.section} · {cls.schedule}</div>}
        </div>
        <div style={{ fontSize: '1.6rem', fontWeight: 700, fontFamily: "'Playfair Display', serif", color: rateColor }}>{rate.toFixed(0)}%</div>
      </div>

      {/* Per-subject stats */}
      <div className="sa-stat-row mb-3">
        <div className="sa-stat" style={{ borderColor: '#bbf7d0' }}>
          <div className="sa-stat-val good">{presentSet.size}</div>
          <div className="sa-stat-lbl">Present</div>
          <div className="sa-stat-sub">of {expected} sessions</div>
        </div>
        <div className="sa-stat" style={{ borderColor: '#fecaca' }}>
          <div className="sa-stat-val bad">{absent}</div>
          <div className="sa-stat-lbl">Absent</div>
          <div className="sa-stat-sub">{absentDates.length} recorded days</div>
        </div>
        <div className="sa-stat" style={{ borderColor: '#ddd6fe' }}>
          <div className="sa-stat-val" style={{ color: 'var(--purple)' }}>{excuseSet.size}</div>
          <div className="sa-stat-lbl">Excused</div>
          <div className="sa-stat-sub">valid excuses</div>
        </div>
        <div className="sa-stat">
          <div className="sa-stat-val" style={{ color: rateColor }}>{rate.toFixed(1)}%</div>
          <div className="sa-stat-lbl">Rate</div>
          <div className="sa-stat-sub">{rate >= 90 ? 'Excellent' : rate >= 80 ? 'Good' : rate >= 75 ? 'Fair' : 'Needs attention'}</div>
        </div>
      </div>

      {/* Progress bar */}
      {expected > 0 && (
        <div className="sa-progress-wrap mb-3">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4 }}>
            <span>Attendance Breakdown</span>
            <span style={{ color: rateColor }}>{rate.toFixed(1)}% present</span>
          </div>
          <div className="sa-progress-bar">
            <div className="sa-progress-seg" style={{ background: 'var(--green)',  width: `${Math.min(100, presentSet.size / expected * 100).toFixed(1)}%` }} />
            <div className="sa-progress-seg" style={{ background: 'var(--purple)', width: `${Math.min(100, excuseSet.size  / expected * 100).toFixed(1)}%` }} />
            <div className="sa-progress-seg" style={{ background: 'var(--red-l)', width: `${Math.min(100, absent / expected * 100).toFixed(1)}%` }} />
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 10, fontWeight: 700 }}>
            <span style={{ color: 'var(--green)' }}>● Present {presentSet.size}</span>
            <span style={{ color: 'var(--purple)' }}>● Excused {excuseSet.size}</span>
            <span style={{ color: 'var(--red)' }}>● Absent {absent}</span>
            <span style={{ color: 'var(--ink3)' }}>/ {expected} total sessions</span>
          </div>
        </div>
      )}

      {/* View tabs */}
      <div className="sa-tab-bar mb-3">
        <button className={`sa-tab${viewMode === 'calendar' ? ' active' : ''}`} onClick={() => setViewMode('calendar')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Calendar size={13} />Calendar View</button>
        <button className={`sa-tab${viewMode === 'present'  ? ' active' : ''}`} onClick={() => setViewMode('present')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={13} />Present ({presentSet.size})</button>
        <button className={`sa-tab${viewMode === 'excuse'   ? ' active' : ''}`} onClick={() => setViewMode('excuse')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FileCheck size={13} />Excused ({excuseSet.size})</button>
        <button className={`sa-tab${viewMode === 'absent'   ? ' active' : ''}`} onClick={() => setViewMode('absent')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><XCircle size={13} />Absent ({absentDates.length})</button>
      </div>

      {/* Content */}
      {viewMode === 'calendar' && (
        <CalendarView
          presentSet={presentSet}
          excuseSet={excuseSet}
          adminDates={allAdminDates}
          year={calYear}
          month={calMonth}
          onNav={navCal}
        />
      )}
      {viewMode === 'present' && <DateList dates={[...presentSet].sort().reverse()} type="present" />}
      {viewMode === 'excuse'  && <DateList dates={[...excuseSet].sort().reverse()} type="excuse" />}
      {viewMode === 'absent'  && <DateList dates={absentDates.slice().reverse()} type="absent" />}
    </div>
  )
}

function CalendarView({ presentSet, excuseSet, adminDates, year, month, onNav }) {
  const monthName   = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today       = new Date()
  const days = []
  for (let i = 0; i < firstDay; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)

  return (
    <div className="sa-cal-wrap">
      <div className="sa-cal-header">
        <button className="btn btn-ghost btn-sm" onClick={() => onNav(-1)}>◀</button>
        <strong style={{ fontSize: 13 }}>{monthName}</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => onNav(1)}>▶</button>
      </div>
      <div className="sa-cal-grid" style={{ marginBottom: 6 }}>
        {DAY_LETTERS.map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: i === 0 || i === 6 ? 'var(--accent)' : 'var(--ink2)', padding: '3px 0' }}>{d}</div>
        ))}
      </div>
      <div className="sa-cal-grid">
        {days.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="sa-day sa-empty" />
          const dateStr   = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const dow       = new Date(year, month, d).getDay()
          const isWeekend = dow === 0 || dow === 6
          const isFuture  = new Date(year, month, d) > today
          const isPresent = presentSet.has(dateStr)
          const isExcuse  = excuseSet.has(dateStr)
          const isAbsent  = !isFuture && adminDates.has(dateStr) && !isPresent && !isExcuse
          const isToday   = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d

          let cls = 'sa-day'
          let tip = dateStr
          if (isFuture)       { cls += ' sa-future';  tip += ' — upcoming' }
          else if (isPresent) { cls += ' sa-present'; tip += ' — Present' }
          else if (isExcuse)  { cls += ' sa-excuse';  tip += ' — Excused' }
          else if (isAbsent)  { cls += ' sa-absent';  tip += ' — Absent' }
          else if (isWeekend) { cls += ' sa-weekend'; tip += ' — weekend' }
          else                { cls += ' sa-future';  tip += ' — no record' }
          if (isToday) cls += ' sa-today'

          return <div key={dateStr} className={cls} title={tip}>{d}</div>
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 10, fontWeight: 700, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--green)' }}>● Present</span>
        <span style={{ color: 'var(--purple)' }}>● Excused</span>
        <span style={{ color: 'var(--red)' }}>● Absent</span>
        <span style={{ color: 'var(--ink3)' }}>● No record / Future</span>
      </div>
    </div>
  )
}

const DATE_FMT = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }

const DATE_ICONS = {
  present: <CheckCircle2 size={14} style={{ verticalAlign: 'middle', color: 'var(--green)' }} />,
  excuse:  <FileCheck size={14} style={{ verticalAlign: 'middle', color: 'var(--purple)' }} />,
  absent:  <XCircle size={14} style={{ verticalAlign: 'middle', color: 'var(--red)' }} />,
}
const EMPTY_ICONS = {
  present: <CheckCircle2 size={36} />,
  excuse:  <FileCheck size={36} />,
  absent:  <Award size={36} />,
}

function DateList({ dates, type }) {
  const clsMap = { present: 'is-present', excuse: 'is-excuse', absent: 'is-absent' }
  const labels = { present: 'Present', excuse: 'Excused', absent: 'Absent' }
  const empties = {
    present: { icon: EMPTY_ICONS.present, msg: 'No present days recorded yet.' },
    excuse:  { icon: EMPTY_ICONS.excuse,  msg: 'No excused absences recorded.' },
    absent:  { icon: EMPTY_ICONS.absent,  msg: 'No recorded absences — great job!' },
  }
  if (!dates.length) {
    const e = empties[type]
    return <div className="empty"><div className="empty-icon">{e.icon}</div>{e.msg}</div>
  }
  return (
    <div className="sa-record-list">
      {dates.map(d => (
        <div key={d} className={`sa-record-item ${clsMap[type]}`}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{DATE_ICONS[type]} {new Date(d + 'T00:00:00').toLocaleDateString('en-PH', DATE_FMT)}</span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>{labels[type]}</span>
        </div>
      ))}
    </div>
  )
}
