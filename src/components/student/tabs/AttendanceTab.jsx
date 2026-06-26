import React, { useState, useMemo, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { useUI } from '@/context/UIContext'
import { CalendarCheck, Calendar, CheckCircle2, FileCheck, XCircle, Award, UserCheck, Radio, ClipboardList, Send, ShieldCheck, AlertTriangle, Flame, PartyPopper } from 'lucide-react'
import TakeAttendanceModal from '@/components/student/modals/TakeAttendanceModal'
import { activeClassIds, activeSubjects } from '@/utils/active'

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const THRESHOLD = 80 // % present required to stay in good standing

export default function AttendanceTab({ student: s, viewClassId, classes }) {
  const { students, fbReady, attendanceSessions, studentCheckIn, submitExcuseRequest, semester } = useData()
  const { currentStudent }    = useAuth()
  const { toast }             = useUI()

  // Check-in + excuse request local state
  const [code, setCode]         = useState('')
  const [checkingIn, setCheckingIn] = useState(false)
  const [showExcuse, setShowExcuse] = useState(false)
  const [exSubject, setExSubject]   = useState('')
  const [exDate, setExDate]         = useState(() => new Date().toISOString().slice(0, 10))
  const [exReason, setExReason]     = useState('')
  const [exBusy, setExBusy]         = useState(false)

  const cls = classes?.find(c => c.id === viewClassId) || null

  // Current, non-archived classes only — archived/ended/removed subjects drop off.
  const enrolledIds = useMemo(() => activeClassIds(s, classes, semester), [s, classes, semester])
  const subs = useMemo(() => activeSubjects(s, classes, semester), [s, classes, semester])

  const [activeSub, setActiveSub] = useState(() => subs[0] || null)
  const [takeAttModal, setTakeAttModal] = useState(null) // subject string

  // Keep the selected subject valid when the active subject list changes
  // (semester switch, dropped/added class) — a stale subject renders empty.
  useEffect(() => {
    if (activeSub && !subs.includes(activeSub)) setActiveSub(subs[0] || null)
    else if (!activeSub && subs.length) setActiveSub(subs[0])
  }, [subs, activeSub])

  // Determine which subjects this student is a rep for
  const repSubjects = useMemo(() => {
    if (!currentStudent) return {}
    const map = {}
    enrolledIds.forEach(classId => {
      const c = classes?.find(x => x.id === classId)
      if (!c?.reps) return
      Object.entries(c.reps).forEach(([sub, repId]) => {
        if (repId === currentStudent.id) map[sub] = classId
      })
    })
    return map // { [subject]: classId }
  }, [currentStudent, enrolledIds, classes])

  // Global totals
  const classMates = enrolledIds.length ? students.filter(x => {
    const xEnrolledIds = x.classIds?.length ? x.classIds : (x.classId ? [x.classId] : [])
    return xEnrolledIds.some(id => enrolledIds.includes(id))
  }) : []

  // Per-subject standing — present/excused/absent counts, rate, and the trailing
  // present/absent streaks. Drives both Attendance Watch and the subject pills,
  // so the validator can never disagree with what the cards show.
  const subStats = useMemo(() => {
    const today = new Date()
    return subs.map(sub => {
      const pres = s.attendance?.[sub] || new Set()
      const exc  = s.excuse?.[sub]     || new Set()
      const held = new Set()
      ;[...classMates, s].forEach(x => {
        ;(x.attendance?.[sub] || new Set()).forEach(d => held.add(d))
        ;(x.excuse?.[sub]     || new Set()).forEach(d => held.add(d))
      })
      const heldArr = [...held].filter(d => new Date(d + 'T00:00:00') <= today).sort()
      const present = pres.size
      const excused = exc.size
      const total   = heldArr.length
      const absent  = Math.max(0, total - present - excused)
      const rate    = total > 0 ? present / total * 100 : null

      // trailing streaks across recorded sessions (most recent first)
      let absentStreak = 0, presentStreak = 0
      for (let i = heldArr.length - 1; i >= 0; i--) {
        const d = heldArr[i]
        if (pres.has(d) || exc.has(d)) break
        absentStreak++
      }
      for (let i = heldArr.length - 1; i >= 0; i--) {
        if (pres.has(heldArr[i])) presentStreak++
        else break
      }

      // how many more absences before the rate crosses below THRESHOLD
      let marginAbs = null
      if (rate != null && rate >= THRESHOLD) {
        const kFloat = present / (THRESHOLD / 100) - total
        marginAbs = Math.max(1, Math.floor(kFloat) + 1)
      }

      return { sub, present, excused, absent, total, rate, absentStreak, presentStreak, marginAbs }
    })
  }, [subs, classMates, s])

  const totals = useMemo(() => {
    let p = 0, e = 0, exp = 0
    subStats.forEach(x => { p += x.present; e += x.excused; exp += x.total })
    return { totalPresent: p, totalExcuse: e, totalExpected: exp }
  }, [subStats])
  const { totalPresent, totalExcuse, totalExpected } = totals
  const totalAbsent = Math.max(0, totalExpected - totalPresent - totalExcuse)
  const globalRate = totalExpected > 0 ? totalPresent / totalExpected * 100 : 0
  const rateColor = globalRate >= 90 ? 'var(--green)' : globalRate >= 80 ? 'var(--yellow)' : 'var(--red)'

  // Attendance Watch — deterministic, on-device findings from the same numbers
  // the standing card renders. Severity order: danger → warning → success.
  const watch = useMemo(() => {
    const findings = []
    const graded = subStats.filter(x => x.rate != null)
    const below  = graded.filter(x => x.rate < THRESHOLD).sort((a, b) => a.rate - b.rate)
    const border = graded.filter(x => x.rate >= THRESHOLD && x.rate < THRESHOLD + 5)

    below.forEach(x => findings.push({
      sev: 'bad', Icon: AlertTriangle,
      text: <><b>{x.sub} is at {x.rate.toFixed(0)}%</b> — below the {THRESHOLD}% line. File excuses for any valid absences and talk to your teacher.</>,
    }))

    border.forEach(x => {
      if (x.marginAbs != null && x.marginAbs <= 2) findings.push({
        sev: 'warn', Icon: AlertTriangle,
        text: <><b>{x.sub} is at {x.rate.toFixed(0)}%</b>, just above the line. {x.marginAbs} more absence{x.marginAbs > 1 ? 's' : ''} would drop it below {THRESHOLD}%.</>,
      })
    })

    graded.filter(x => x.absentStreak >= 2).sort((a, b) => b.absentStreak - a.absentStreak).slice(0, 2).forEach(x => findings.push({
      sev: 'warn', Icon: Flame,
      text: <><b>{x.absentStreak} absences in a row</b> in {x.sub}. Send an excuse request if these were valid.</>,
    }))

    const bestStreak = graded.filter(x => x.presentStreak >= 5).sort((a, b) => b.presentStreak - a.presentStreak)[0]
    if (bestStreak) findings.push({
      sev: 'good', Icon: PartyPopper,
      text: <><b>{bestStreak.presentStreak} present in a row</b> in {bestStreak.sub}. Keep it going.</>,
    })

    if (!findings.length && graded.length) findings.push({
      sev: 'good', Icon: ShieldCheck,
      text: <>Every subject is at or above the {THRESHOLD}% line. Strong, consistent attendance.</>,
    })

    let lead
    if (!graded.length) lead = 'No sessions recorded yet. Your standing shows here once attendance is taken.'
    else if (below.length) {
      const good = graded.length - below.length
      lead = `${good} of your ${graded.length} subjects ${good === 1 ? 'is' : 'are'} in good standing. ${below.length} need${below.length > 1 ? '' : 's'} attention.`
    } else lead = `All ${graded.length} ${graded.length === 1 ? 'subject is' : 'subjects are'} in good standing.`

    return { findings: findings.slice(0, 5), lead, hasData: graded.length > 0 }
  }, [subStats])

  const openSessionForMe = attendanceSessions?.find(se =>
    se.status === 'open' && enrolledIds.includes(se.classId) && !se.checkedIn?.[s.id]
  ) || null

  async function handleCheckIn() {
    if (!code.trim()) { toast('Enter the code your teacher shows.', 'warn'); return }
    setCheckingIn(true)
    try {
      const session = await studentCheckIn(code, s)
      toast(`Checked in for ${session.subject}. You're marked present.`, 'green')
      setCode('')
    } catch (e) {
      toast(e.message || 'Check-in failed.', 'error', 5000)
    } finally { setCheckingIn(false) }
  }

  function classIdForSubject(sub) {
    return enrolledIds.find(id => classes.find(c => c.id === id)?.subjects?.includes(sub)) || enrolledIds[0] || s.classId
  }

  async function handleExcuse() {
    const subject = exSubject || subs[0]
    if (!subject) { toast('Pick a subject.', 'warn'); return }
    if (!exDate) { toast('Pick the date you missed.', 'warn'); return }
    if (!exReason.trim()) { toast('Add a short reason.', 'warn'); return }
    setExBusy(true)
    try {
      await submitExcuseRequest({ student: s, classId: classIdForSubject(subject), subject, date: exDate, reason: exReason })
      toast('Excuse request sent to your teacher.', 'success')
      setExReason(''); setShowExcuse(false)
    } catch (e) {
      toast('Could not send request: ' + e.message, 'error')
    } finally { setExBusy(false) }
  }

  if (!subs.length) {
    return (
      <div className="empty"><div className="empty-icon"><CalendarCheck size={40} /></div>No attendance records yet.</div>
    )
  }

  return (
    <div className="student-attendance">
      {/* Standing + Attendance Watch */}
      <div className="att2-standing">
        <div className="card att2-pad">
          <div className="att2-card-h"><ShieldCheck size={17} style={{ color: 'var(--accent)' }} />My standing</div>
          <div className="att2-ring-row">
            <StandingRing rate={globalRate} color={rateColor} />
            <div className="att2-chips">
              <div className="att2-chip"><span className="att2-dot" style={{ background: 'var(--green)' }} /><b>{totalPresent}</b><small>Present</small></div>
              <div className="att2-chip"><span className="att2-dot" style={{ background: 'var(--red)' }} /><b>{totalAbsent}</b><small>Absent</small></div>
              <div className="att2-chip"><span className="att2-dot" style={{ background: 'var(--purple)' }} /><b>{totalExcuse}</b><small>Excused</small></div>
              <div className="att2-chip"><span className="att2-dot" style={{ background: 'var(--ink3)' }} /><b>{totalExpected}</b><small>Sessions</small></div>
            </div>
          </div>
        </div>

        <div className="card att2-pad att2-watch">
          <div className="att2-card-h">
            <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />Attendance Watch
            <span className="att2-pill">on-device · live</span>
          </div>
          <p className="att2-watch-lead">{watch.lead}</p>
          {watch.findings.map((f, i) => (
            <div key={i} className={`att2-find att2-find-${f.sev}`}>
              <f.Icon size={18} className="att2-find-ic" aria-hidden="true" />
              <div>{f.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Self check-in */}
      <div className="card att2-pad" style={{ marginBottom: 12 }}>
        <div className="att2-card-h">
          <Radio size={16} style={{ color: openSessionForMe ? 'var(--green)' : 'var(--ink3)' }} />Check in
          {openSessionForMe && <span className="badge badge-green" style={{ fontSize: 10, marginLeft: 'auto' }}>Session open</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink2)', marginBottom: 8 }}>
          {openSessionForMe
            ? 'Your teacher opened check-in. Scan the QR your teacher shows, or enter the code to mark yourself present for today.'
            : 'When your teacher opens check-in, scan the QR or enter the code here to mark yourself present.'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ maxWidth: 180, textTransform: 'uppercase', letterSpacing: '.12em', fontFamily: 'var(--font-mono)', fontWeight: 600 }}
            placeholder="ENTER CODE"
            value={code}
            maxLength={6}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') handleCheckIn() }}
          />
          <button className="btn btn-success btn-sm" onClick={handleCheckIn} disabled={checkingIn || !code.trim()}>
            {checkingIn ? 'Checking in…' : 'Check in'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowExcuse(v => !v)}>
            <ClipboardList size={13} className="inline-block mr-1" />Request excuse
          </button>
        </div>

        {showExcuse && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>Request an excuse for a missed session</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="input" style={{ maxWidth: 200 }} value={exSubject || subs[0]} onChange={e => setExSubject(e.target.value)}>
                {subs.map(sub => <option key={sub} value={sub}>{sub}</option>)}
              </select>
              <input className="input" style={{ maxWidth: 170 }} type="date" value={exDate} onChange={e => setExDate(e.target.value)} />
            </div>
            <textarea
              className="input"
              style={{ minHeight: 60, resize: 'vertical' }}
              placeholder="Reason (e.g. medical, family emergency)…"
              value={exReason}
              onChange={e => setExReason(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleExcuse} disabled={exBusy || !exReason.trim()}>
                <Send size={13} className="inline-block mr-1" />{exBusy ? 'Sending…' : 'Send request'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowExcuse(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Subject pills */}
      <div className="sa-sub-pills mb-3">
        {subStats.map(({ sub, rate }) => {
          const dot = rate == null ? 'var(--ink3)' : rate >= 90 ? 'var(--green)' : rate >= 80 ? 'var(--yellow)' : 'var(--red)'
          const isActive = sub === activeSub
          const isRep = !!repSubjects[sub]
          return (
            <div key={sub} className="flex items-center gap-1">
              <button
                className={`sa-sub-pill${isActive ? ' active' : ''}`}
                onClick={() => setActiveSub(sub)}
              >
                <span className="sa-pill-dot" style={{ background: isActive ? '#fff' : dot }} />
                {sub}
              </button>
              {isRep && (
                <button
                  className="btn btn-sm flex items-center gap-1"
                  style={{ fontSize: 11, padding: '3px 8px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius)' }}
                  onClick={() => setTakeAttModal({ subject: sub, classId: repSubjects[sub] })}
                  title={`You are the rep for ${sub} — take attendance`}
                >
                  <UserCheck size={11} />Take Attendance
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Take Attendance Modal (rep only) */}
      {takeAttModal && (
        <TakeAttendanceModal
          classId={takeAttModal.classId}
          subject={takeAttModal.subject}
          onClose={() => setTakeAttModal(null)}
        />
      )}

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

// Compact standing ring — overall present rate as a single coloured arc.
function StandingRing({ rate, color }) {
  const C = 2 * Math.PI * 50
  const off = C * (1 - Math.min(100, Math.max(0, rate)) / 100)
  return (
    <svg viewBox="0 0 120 120" width="100" height="100" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="12" />
      <circle cx="60" cy="60" r="50" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 60 60)"
        style={{ transition: 'stroke-dashoffset .4s' }} />
      <text x="60" y="58" textAnchor="middle" fontSize="25" fontWeight="700" fill="var(--ink)">{rate.toFixed(0)}%</text>
      <text x="60" y="77" textAnchor="middle" fontSize="11" fill="var(--ink3)">present</text>
    </svg>
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

  const pct = v => `${Math.min(100, expected > 0 ? v / expected * 100 : 0).toFixed(1)}%`

  return (
    <div className="card att2-pad att2-subject">
      {/* Sub-header */}
      <div className="att2-sub-head">
        <div>
          <div className="att2-sub-name">{sub}</div>
          {cls && <div className="att2-sub-meta">{cls.name} · {cls.section} · {cls.schedule}</div>}
        </div>
        <div className="att2-sub-rate" style={{ color: rateColor }}>{rate.toFixed(0)}%</div>
      </div>

      {/* View tabs */}
      <div className="sa-tab-bar att2-tabs">
        <button className={`sa-tab${viewMode === 'calendar' ? ' active' : ''}`} onClick={() => setViewMode('calendar')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Calendar size={13} />Calendar</button>
        <button className={`sa-tab${viewMode === 'present'  ? ' active' : ''}`} onClick={() => setViewMode('present')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={13} />Present ({presentSet.size})</button>
        <button className={`sa-tab${viewMode === 'excuse'   ? ' active' : ''}`} onClick={() => setViewMode('excuse')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FileCheck size={13} />Excused ({excuseSet.size})</button>
        <button className={`sa-tab${viewMode === 'absent'   ? ' active' : ''}`} onClick={() => setViewMode('absent')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><XCircle size={13} />Absent ({absentDates.length})</button>
      </div>

      {/* Content */}
      {viewMode === 'calendar' ? (
        <div className="att2-detail">
          <div className="att2-cal-col">
            <CalendarView
              presentSet={presentSet}
              excuseSet={excuseSet}
              adminDates={allAdminDates}
              year={calYear}
              month={calMonth}
              onNav={navCal}
            />
          </div>
          <div className="att2-side">
            {expected > 0 && (
              <div>
                <div className="att2-bar-head">
                  <span>Breakdown</span>
                  <span style={{ color: rateColor }}>{rate.toFixed(1)}% present</span>
                </div>
                <div className="sa-progress-bar att2-bar">
                  <div className="sa-progress-seg" style={{ background: 'var(--green)',  width: pct(presentSet.size) }} />
                  <div className="sa-progress-seg" style={{ background: 'var(--purple)', width: pct(excuseSet.size) }} />
                  <div className="sa-progress-seg" style={{ background: 'var(--red-l)',   width: pct(absent) }} />
                </div>
                <div className="att2-counts">
                  <span><span className="att2-dot" style={{ background: 'var(--green)' }} />Present <b>{presentSet.size}</b></span>
                  <span><span className="att2-dot" style={{ background: 'var(--purple)' }} />Excused <b>{excuseSet.size}</b></span>
                  <span><span className="att2-dot" style={{ background: 'var(--red)' }} />Absent <b>{absent}</b></span>
                  <span><span className="att2-dot" style={{ background: 'var(--ink3)' }} />Sessions <b>{expected}</b></span>
                </div>
              </div>
            )}
            <div className="att2-legend">
              <span><span className="att2-ld" style={{ background: 'var(--green)' }} />Present</span>
              <span><span className="att2-ld" style={{ background: 'var(--purple)' }} />Excused</span>
              <span><span className="att2-ld" style={{ background: 'var(--red)' }} />Absent</span>
              <span><span className="att2-ld" style={{ background: 'var(--border)' }} />No session</span>
            </div>
          </div>
        </div>
      ) : viewMode === 'present' ? (
        <DateList dates={[...presentSet].sort().reverse()} type="present" />
      ) : viewMode === 'excuse' ? (
        <DateList dates={[...excuseSet].sort().reverse()} type="excuse" />
      ) : (
        <DateList dates={absentDates.slice().reverse()} type="absent" />
      )}
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
