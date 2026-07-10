import React, { useMemo, useState, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { getGWA, getAttRate } from '@/utils/grades'
import { findAbsenceAlerts } from '@/utils/attendanceRisk'
import { computeRiskScores } from '@/utils/riskScore'
import { fbPushReminderNotif } from '@/firebase/reminders'
import { sendPushToOwners } from '@/firebase/pushTokens'
import { computeAssessmentStats } from '@/utils/assessmentStats'
import { sortByLastName } from '@/utils/format'
import Badge from '@/components/primitives/Badge'
import StudentMeta from '@/components/primitives/StudentMeta'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import Avatar from '@/components/primitives/Avatar'
import DonutChart from '@/components/charts/DonutChart'
import SmartAnalyzer from '@/components/ds/SmartAnalyzer'
import {
  Users, CalendarCheck, AlertTriangle, BarChart2, TrendingUp, CheckCircle2,
  ClipboardList, Bell, ChevronDown, Download, Home, PieChart,
} from 'lucide-react'
import { SkeletonDashboard } from '@/components/primitives/SkeletonLoader'
import PageHeader from '@/components/ds/PageHeader'
import MetricCard from '@/components/ds/MetricCard'
import EmptyState from '@/components/ds/EmptyState'

const PER_PAGE = 10
const RISK_PER_PAGE = 6
const ABSENCE_THRESHOLD = 3

// Avatar tint per status/level - uses the soft "-l" fills so the initial chip
// reads as a quiet status dot, not a loud block.
const TINT = {
  green:  { bg: 'var(--green-l)',  fg: 'var(--green)' },
  orange: { bg: 'var(--yellow-l)', fg: 'var(--gold-var, #ca8a04)' },
  red:    { bg: 'var(--red-l)',    fg: 'var(--red)' },
  gray:   { bg: 'var(--bg)',       fg: 'var(--ink3)' },
}

const initials = name =>
  (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

export default function DashboardTab() {
  const { students, classes, activities = [], quizzes = [], fbReady, admin, semester, db } = useData()
  const { setAdminTab, toast, openStudentProfile } = useUI()
  const [nudged, setNudged] = useState({})
  const [visAll, setVisAll]   = useState(PER_PAGE)
  const [visRisk, setVisRisk] = useState(RISK_PER_PAGE)

  // Consecutive-absence early warning (3+ missed sessions in a row).
  const absenceAlerts = useMemo(
    () => findAbsenceAlerts(students, classes, semester, ABSENCE_THRESHOLD),
    [students, classes, semester]
  )

  // Notify each flagged student once per new streak milestone (idempotent via
  // remKey). Best-effort; runs when the professor's dashboard sees the alerts.
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (notifiedRef.current || !fbReady || !db?.current || !absenceAlerts.length) return
    notifiedRef.current = true
    absenceAlerts.forEach(a => {
      const rem = {
        remKey: `absent_${a.classId}_${a.subject}_${a.lastDate}_${a.streak}`,
        type: 'att_alert',
        title: 'Attendance check-in',
        body: `You've missed ${a.streak} ${a.subject} sessions in a row. Please reach out to your professor.`,
        link: 'attendance',
      }
      fbPushReminderNotif(db.current, a.student.id, rem).then(created => {
        if (created) sendPushToOwners(db.current, [a.student.id], { title: rem.title, body: rem.body }, { url: '/', tag: rem.remKey })
      })
    })
  }, [absenceAlerts, fbReady])

  // ── At-risk radar: one fused risk score per student ─────────────────────────
  const risk = useMemo(
    () => computeRiskScores(students, { classes, students, activities, quizzes, semester }),
    [students, classes, activities, quizzes, semester]
  )

  // Send a one-tap check-in nudge (in-app notif + best-effort push). The remKey
  // carries a timestamp so a professor can re-send if needed.
  const nudgeStudent = (r) => {
    if (!db?.current) return
    const top = r.reasons[0]?.text || 'your recent activity'
    const rem = {
      remKey: `nudge_${r.student.id}_${Date.now()}`,
      type: 'att_alert',
      title: 'A message from your professor',
      body: `Checking in - let's talk about ${top.toLowerCase()}. Reach out if you need help.`,
      link: 'overview',
    }
    fbPushReminderNotif(db.current, r.student.id, rem).then(created => {
      if (created) sendPushToOwners(db.current, [r.student.id], { title: rem.title, body: rem.body }, { url: '/', tag: rem.remKey })
    })
    setNudged(n => ({ ...n, [r.student.id]: true }))
    toast?.(`Nudge sent to ${r.student.name}`, 'success')
  }

  const stats = useMemo(() => {
    const gwas = [], atts = []
    students.forEach(s => {
      const g = getGWA(s, classes)
      if (g !== null) gwas.push(g)
      const r = getAttRate(s, students, classes)
      if (r !== null) atts.push(r)
    })
    return {
      total:    students.length,
      classes:  classes.length,
      regCount: students.filter(s => s.account?.registered).length,
      avgGwa:   gwas.length ? (gwas.reduce((a, b) => a + b, 0) / gwas.length).toFixed(1) : '-',
      avgAtt:   atts.length ? (atts.reduce((a, b) => a + b, 0) / atts.length).toFixed(1) + '%' : '-',
    }
  }, [students, classes])

  const atRisk = useMemo(() => students.filter(s => {
    const g = getGWA(s, classes)
    if (g === null) return false
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const subs = enrolledIds.length ? [...new Set(enrolledIds.flatMap(id => classes.find(c => c.id === id)?.subjects || []))] : Object.keys(s.grades || {})
    const hasComplete = subs.some(sub => {
      const comp = s.gradeComponents?.[sub] || {}
      return comp.midterm != null && comp.finals != null
    })
    return hasComplete && g < 75
  }), [students, classes])

  const lowAtt = useMemo(() => students.filter(s => {
    const r = getAttRate(s, students, classes)
    if (r === null) return false
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const subs = enrolledIds.length ? [...new Set(enrolledIds.flatMap(id => classes.find(c => c.id === id)?.subjects || []))] : Object.keys(s.attendance || {})
    const hasRecords = subs.some(sub => {
      const att = s.attendance?.[sub]
      return att && Object.keys(att).length > 0
    })
    return hasRecords && r < 80
  }), [students, classes])

  const allStudents = useMemo(() => sortByLastName(students), [students])
  const assess = useMemo(() => computeAssessmentStats(activities, students, classes), [activities, students, classes])

  // Grade distribution for the "At a glance" donut.
  const grade = useMemo(() => {
    let passed = 0, conditional = 0, failed = 0
    students.forEach(s => {
      const g = getGWA(s, classes)
      if (g === null) return
      if (g >= 75) passed++
      else if (g >= 71) conditional++
      else failed++
    })
    return { passed, conditional, failed }
  }, [students, classes])

  const donutData = [
    { label: 'Passing',     value: grade.passed,      color: 'var(--green)' },
    { label: 'Conditional', value: grade.conditional, color: 'var(--gold-var, #ca8a04)' },
    { label: 'At risk',     value: grade.failed,      color: 'var(--red)' },
  ]
  const gradedTotal = grade.passed + grade.conditional + grade.failed

  if (!fbReady) return <SkeletonDashboard />

  const adminName = admin?.name || admin?.displayName || 'Professor'
  const hr = new Date().getHours()
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'

  const gwaNum = parseFloat(stats.avgGwa)
  const attNum = parseFloat(stats.avgAtt)

  // ── Build the Smart analyzer's findings - all derived from the real numbers above,
  // so the analyzer can never contradict the cards on the page. ───────────────
  const scrollToNeeds = () => document.getElementById('needs-attention')?.scrollIntoView({ behavior: 'smooth' })
  const findings = []
  if (risk.counts.high)
    findings.push({ sev: 'danger', Icon: AlertTriangle, source: 'Grades + Attendance', actionLabel: 'Review', onAction: scrollToNeeds,
      text: <><b>{risk.counts.high}</b> student{risk.counts.high > 1 ? 's' : ''} at high risk - low grades, absences and missing work</> })
  if (grade.failed)
    findings.push({ sev: 'danger', Icon: BarChart2, source: 'Grades', actionLabel: 'Grades', onAction: () => setAdminTab('grades'),
      text: <><b>{grade.failed}</b> below passing (GWA under 71)</> })
  if (assess.awaitingGrading)
    findings.push({ sev: 'warning', Icon: ClipboardList, source: 'Activities', actionLabel: 'Grade', onAction: () => setAdminTab('activities'),
      text: <><b>{assess.awaitingGrading}</b> submission{assess.awaitingGrading > 1 ? 's' : ''} awaiting grading</> })
  // (Intentionally NO "overdue missing submissions" finding: an ended activity
  // with non-submitters is settled by the grading defaults, not a reminder.)
  if (lowAtt.length)
    findings.push({ sev: 'warning', Icon: CalendarCheck, source: 'Attendance', actionLabel: 'Open', onAction: () => setAdminTab('attendance'),
      text: <><b>{lowAtt.length}</b> student{lowAtt.length > 1 ? 's' : ''} below 80% attendance</> })
  if (absenceAlerts.length)
    findings.push({ sev: 'warning', Icon: AlertTriangle, source: 'Attendance', actionLabel: 'Open', onAction: () => setAdminTab('attendance'),
      text: <><b>{absenceAlerts.length}</b> on a {ABSENCE_THRESHOLD}+ session absence streak</> })
  if (!isNaN(gwaNum) && gwaNum >= 75)
    findings.push({ sev: 'success', Icon: TrendingUp, source: 'Grades', text: <>Class average <b>{stats.avgGwa}</b> - above passing</> })
  if (gradedTotal && !assess.awaitingGrading)
    findings.push({ sev: 'success', Icon: CheckCircle2, source: 'Activities', text: 'All caught up on grading' })
  if (!isNaN(attNum) && attNum >= 80)
    findings.push({ sev: 'success', Icon: CheckCircle2, source: 'Attendance', text: <>Attendance healthy at <b>{stats.avgAtt}</b></> })

  const flagged = risk.list.length
  const headline = stats.total === 0
    ? 'Add students to your roster to start seeing analysis here.'
    : flagged === 0
      ? 'Everything looks healthy - no students are flagged for grades, attendance, or missing work right now.'
      : `${flagged} student${flagged > 1 ? 's' : ''} need${flagged > 1 ? '' : 's'} a closer look. The analyzer scanned grades, attendance, activities, and quizzes across your classes.`

  // Status helper for a student card.
  const statusOf = (gwa) => {
    if (gwa === null) return { label: '-', variant: 'gray' }
    if (gwa >= 75)    return { label: 'Passing',     variant: 'green' }
    if (gwa >= 71)    return { label: 'Conditional', variant: 'orange' }
    return { label: 'At risk', variant: 'red' }
  }

  const riskSlice = risk.list.slice(0, visRisk)
  const allSlice  = allStudents.slice(0, visAll)

  return (
    <div>
      {/* Page header - Export only (New Activity removed) */}
      <PageHeader
        crumb={<><Home size={13} /> Home <span>›</span> Dashboard</>}
        title={`${greeting}, ${adminName}`}
        subtitle={`${stats.total} students · ${stats.classes} classes`}
        actions={<button className="btn" onClick={() => setAdminTab('grades')}><Download size={16} /> Export</button>}
      />

      {/* On-device Smart analyzer (replaces Class Insights) */}
      <SmartAnalyzer headline={headline} findings={findings} />

      {/* Metric cards */}
      <div className="stat-grid mb-4">
        <MetricCard Icon={Users} color="blue" value={stats.total} label="Active Students"
          trend={{ dir: 'flat', text: `${stats.regCount} with accounts` }} />
        <MetricCard Icon={BarChart2} color="green" value={stats.avgGwa} label="Class Average"
          trend={isNaN(gwaNum) ? null : { dir: gwaNum >= 75 ? 'up' : 'down', text: gwaNum >= 75 ? 'Passing' : 'Below 75' }} />
        <MetricCard Icon={CalendarCheck} color="yellow" value={stats.avgAtt} label="Avg. Attendance"
          trend={isNaN(attNum) ? null : { dir: attNum >= 80 ? 'up' : 'down', text: attNum >= 80 ? 'On track' : 'Watch' }} />
        <MetricCard Icon={AlertTriangle} color="red" value={atRisk.length} label="Need Attention"
          trend={atRisk.length ? { dir: 'down', text: 'Needs review' } : { dir: 'up', text: 'All clear' }} />
      </div>

      {/* At a glance - large grade-distribution donut */}
      <div className="card card-pad mb-4">
        <div className="sec-hdr">
          <div className="sec-title sec-title-ic"><PieChart /> At a glance</div>
          <span className="text-xs text-ink2">{gradedTotal} of {stats.total} with grades</span>
        </div>
        {gradedTotal === 0 ? (
          <EmptyState Icon={PieChart} title="No grades yet" text="Once midterm and finals are entered, the grade distribution shows up here." />
        ) : (
          <div className="ds-glance">
            <DonutChart data={donutData} size={190} total={gradedTotal} />
          </div>
        )}
      </div>

      {/* Needs attention - at-risk students as clickable cards (Nudge + View) */}
      {risk.list.length > 0 && (
        <div className="card card-pad mb-4" id="needs-attention">
          <div className="sec-hdr">
            <div className="sec-title sec-title-ic"><AlertTriangle /> Needs attention</div>
            <span className="text-xs text-ink2">{risk.counts.high} high · {risk.counts.watch} watch · live</span>
          </div>
          <div className="ds-stud-grid">
            {riskSlice.map(r => {
              const tint = r.level === 'high' ? TINT.red : TINT.orange
              return (
                <div
                  className="ds-stud"
                  key={r.student.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open profile of ${r.student.name}`}
                  onClick={() => openStudentProfile(r.student.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudentProfile(r.student.id) } }}
                >
                  <Avatar photo={r.student.photo} className="ds-stud-av" style={{ background: tint.bg, color: tint.fg }}>{initials(r.student.name)}</Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.student.name}</span>
                      <VerifiedBadge student={r.student} size={14} />
                    </div>
                    <div className="ds-stud-id">{r.student.id}</div>
                    <StudentMeta student={r.student} />
                    <div style={{ fontSize: 11, color: 'var(--ink2)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.reasons.slice(0, 2).map(rs => rs.text).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flex: 'none' }}>
                    <Badge variant={r.level === 'high' ? 'red' : 'orange'}>Risk {r.score}</Badge>
                    <button
                      className="btn btn-sm"
                      disabled={nudged[r.student.id]}
                      onClick={e => { e.stopPropagation(); nudgeStudent(r) }}
                    >
                      <Bell size={13} /> {nudged[r.student.id] ? 'Sent' : 'Nudge'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {visRisk < risk.list.length && (
            <div style={{ textAlign: 'center', marginTop: 13 }}>
              <button className="btn" onClick={() => setVisRisk(v => v + RISK_PER_PAGE)}>
                <ChevronDown size={15} /> See more ({risk.list.length - visRisk})
              </button>
            </div>
          )}
        </div>
      )}

      {/* All students - clickable cards, 10 shown, load 10 more inline */}
      <div className="card card-pad">
        <div className="sec-hdr">
          <div className="sec-title sec-title-ic"><Users /> All students</div>
          <span className="text-xs text-ink2">{students.length} total · showing {Math.min(visAll, allStudents.length)}</span>
        </div>
        {!allStudents.length ? (
          <EmptyState Icon={Users} title="No students yet" text="Add students to your roster to see them here." />
        ) : (
          <>
            <div className="ds-stud-grid">
              {allSlice.map(s => {
                const gwa = getGWA(s, classes)
                const att = getAttRate(s, students, classes)
                const st = statusOf(gwa)
                const tint = TINT[st.variant] || TINT.gray
                return (
                  <div
                    className="ds-stud"
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open profile of ${s.name}`}
                    onClick={() => openStudentProfile(s.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudentProfile(s.id) } }}
                  >
                    <Avatar photo={s.photo} className="ds-stud-av" style={{ background: tint.bg, color: tint.fg }}>{initials(s.name)}</Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                        <VerifiedBadge student={s} size={14} />
                      </div>
                      <div className="ds-stud-id">{s.id}</div>
                      <StudentMeta student={s} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flex: 'none' }}>
                      <Badge variant={st.variant}>{gwa !== null ? gwa.toFixed(1) : '-'}</Badge>
                      <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{att !== null ? att.toFixed(0) + '% att' : 'no att'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {visAll < allStudents.length && (
              <div style={{ textAlign: 'center', marginTop: 13 }}>
                <button className="btn" onClick={() => setVisAll(v => v + PER_PAGE)}>
                  <ChevronDown size={15} /> See more students ({allStudents.length - visAll})
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
