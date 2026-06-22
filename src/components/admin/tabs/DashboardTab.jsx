import React, { useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { getGWA, getAttRate } from '@/utils/grades'
import { sortByLastName } from '@/utils/format'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'
import BarChart from '@/components/charts/BarChart'
import DonutChart from '@/components/charts/DonutChart'
import SmartInsights from '@/components/primitives/SmartInsights'
import { generateClassInsights } from '@/utils/insights'
import { Users, School, BookOpen, CalendarCheck, ShieldCheck, AlertTriangle, BarChart2, Activity, ArrowRight, Plus, Download, Home } from 'lucide-react'
import { SkeletonDashboard } from '@/components/primitives/SkeletonLoader'
import PageHeader from '@/components/ds/PageHeader'
import MetricCard from '@/components/ds/MetricCard'
import EmptyState from '@/components/ds/EmptyState'

const PER_PAGE = 10

export default function DashboardTab() {
  const { students, classes, fbReady, admin } = useData()
  const { setAdminTab } = useUI()
  const [riskPage, setRiskPage]     = useState(1)
  const [lowAttPage, setLowAttPage] = useState(1)
  const [allPage, setAllPage]       = useState(1)

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
      subjects: classes.reduce((a, c) => a + (c.subjects?.length || 0), 0),
      regCount: students.filter(s => s.account?.registered).length,
      avgGwa:   gwas.length ? (gwas.reduce((a, b) => a + b, 0) / gwas.length).toFixed(1) : '—',
      avgAtt:   atts.length ? (atts.reduce((a, b) => a + b, 0) / atts.length).toFixed(1) + '%' : '—',
    }
  }, [students, classes])

  const atRisk = useMemo(() => sortByLastName(students.filter(s => {
    const g = getGWA(s, classes)
    if (g === null) return false
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const subs = enrolledIds.length ? [...new Set(enrolledIds.flatMap(id => classes.find(c => c.id === id)?.subjects || []))] : Object.keys(s.grades || {})
    const hasComplete = subs.some(sub => {
      const comp = s.gradeComponents?.[sub] || {}
      return comp.midterm != null && comp.finals != null
    })
    return hasComplete && g < 75
  })), [students, classes])

  const lowAtt = useMemo(() => sortByLastName(students.filter(s => {
    const r = getAttRate(s, students, classes)
    if (r === null) return false
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const subs = enrolledIds.length ? [...new Set(enrolledIds.flatMap(id => classes.find(c => c.id === id)?.subjects || []))] : Object.keys(s.attendance || {})
    const hasRecords = subs.some(sub => {
      const att = s.attendance?.[sub]
      return att && Object.keys(att).length > 0
    })
    return hasRecords && r < 80
  })), [students, classes])

  const allStudents = useMemo(() => sortByLastName(students), [students])
  const recent = useMemo(() => allStudents.slice(0, 5), [allStudents])

  const classInsights = useMemo(() => generateClassInsights(students, classes), [students, classes])

  // Chart data
  const barData = useMemo(() => classes.filter(c => !c.archived).map(cls => {
    const enrolled = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id))
    const gwas = enrolled.map(s => getGWA(s, classes)).filter(g => g !== null)
    return { label: cls.name + ' ' + cls.section, value: gwas.length ? gwas.reduce((a, b) => a + b, 0) / gwas.length : 0 }
  }), [students, classes])

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
    { label: 'Passed', value: grade.passed, color: '#1a7a4a' },
    { label: 'Conditional', value: grade.conditional, color: '#d97706' },
    { label: 'Failed', value: grade.failed, color: '#b93232' },
  ]

  if (!fbReady) return <SkeletonDashboard />

  const riskSlice  = atRisk.slice((riskPage - 1) * PER_PAGE, riskPage * PER_PAGE)
  const lowSlice   = lowAtt.slice((lowAttPage - 1) * PER_PAGE, lowAttPage * PER_PAGE)
  const allSlice   = allStudents.slice((allPage - 1) * PER_PAGE, allPage * PER_PAGE)

  const adminName = admin?.name || admin?.displayName || 'Teacher'
  const hr = new Date().getHours()
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'

  const gwaNum = parseFloat(stats.avgGwa)
  const attNum = parseFloat(stats.avgAtt)
  const pct = v => Math.round((v / (stats.total || 1)) * 100) + '%'
  const initials = name => (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div>
      {/* Page header */}
      <PageHeader
        crumb={<><Home size={13} /> Home <span>›</span> Dashboard</>}
        title={`${greeting}, ${adminName}`}
        subtitle={`${stats.total} students · ${stats.classes} classes`}
        actions={<>
          <button className="btn" onClick={() => setAdminTab('grades')}><Download size={16} /> Export</button>
          <button className="btn btn-primary" onClick={() => setAdminTab('activities')}><Plus size={16} /> New Activity</button>
        </>}
      />

      {/* Smart Insights (on-device, no external AI) */}
      <SmartInsights title="Class Insights" insights={classInsights} />

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

      {/* Recent students + At a glance */}
      <div className="grid-2 mb-4">
        <div className="ds-card">
          <div className="ds-card-h">
            <h3><Users /> Recent students</h3>
            <button className="sec-link" onClick={() => setAdminTab('students')}>View all <ArrowRight /></button>
          </div>
          {!recent.length ? (
            <EmptyState Icon={Users} title="No students yet" text="Add students to your roster to see them here." />
          ) : recent.map(s => {
            const gwa = getGWA(s, classes)
            const cls = classes.find(c => c.id === s.classId)
            return (
              <div className="ds-list-row" key={s.id}>
                <div className="ds-la">{initials(s.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="ds-ln">{s.name}</div>
                  <div className="ds-ls">{s.id}{cls ? ` · ${cls.name} ${cls.section}` : ''}</div>
                </div>
                <div className="ds-lr">
                  {!s.account?.registered
                    ? <Badge variant="orange">Pending</Badge>
                    : (gwa !== null ? gwa.toFixed(1) : '—')}
                </div>
              </div>
            )
          })}
        </div>

        <div className="ds-card">
          <div className="ds-card-h"><h3><Activity /> At a glance</h3></div>
          <div className="ds-statline">
            <div className="t"><span>Passing (GWA ≥ 75)</span><b>{grade.passed} / {stats.total}</b></div>
            <div className="ds-bar"><i style={{ width: pct(grade.passed), background: 'var(--green)' }} /></div>
          </div>
          <div className="ds-statline">
            <div className="t"><span>Conditional / failing</span><b>{grade.conditional + grade.failed}</b></div>
            <div className="ds-bar"><i style={{ width: pct(grade.conditional + grade.failed), background: 'var(--yellow)' }} /></div>
          </div>
          <div className="ds-statline">
            <div className="t"><span>Low attendance (&lt; 80%)</span><b>{lowAtt.length}</b></div>
            <div className="ds-bar"><i style={{ width: pct(lowAtt.length), background: 'var(--red)' }} /></div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid-2 mb-4 ds-desktop-only">
        <div className="chart-wrap">
          <div className="chart-title">Class Grade Overview</div>
          <BarChart data={barData} height={160} />
        </div>
        <div className="chart-wrap">
          <div className="chart-title">School-wide Grade Status</div>
          <div className="donut-wrap">
            <DonutChart data={donutData} size={130} />
          </div>
        </div>
      </div>

      {/* At-risk + Low attendance */}
      <div className="grid-2 mb-4 ds-desktop-only">
        <div>
          <div className="sec-hdr"><div className="sec-title sec-title-ic"><ShieldCheck /> Students at Risk (below 75%)</div></div>
          {!atRisk.length ? (
            <EmptyState Icon={ShieldCheck} title="No students at risk" text="Everyone with complete grades is passing. Nice work." />
          ) : (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Name</th><th>GWA</th></tr></thead>
                  <tbody>
                    {riskSlice.map(s => (
                      <tr key={s.id}>
                        <td>{s.name}<br/><small className="text-ink2">{s.id}</small></td>
                        <td><Badge variant="red">{getGWA(s, classes)?.toFixed(1)}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={atRisk.length} perPage={PER_PAGE} page={riskPage} onChange={setRiskPage} />
            </>
          )}
        </div>
        <div>
          <div className="sec-hdr"><div className="sec-title sec-title-ic"><CalendarCheck /> Low Attendance (&lt; 80%)</div></div>
          {!lowAtt.length ? (
            <EmptyState Icon={CalendarCheck} title="Attendance looks healthy" text="No students are below the 80% attendance threshold." />
          ) : (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Name</th><th>Rate</th></tr></thead>
                  <tbody>
                    {lowSlice.map(s => (
                      <tr key={s.id}>
                        <td>{s.name}<br/><small className="text-ink2">{s.id}</small></td>
                        <td><Badge variant="orange">{getAttRate(s, students, classes)?.toFixed(1)}%</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination total={lowAtt.length} perPage={PER_PAGE} page={lowAttPage} onChange={setLowAttPage} />
            </>
          )}
        </div>
      </div>

      {/* All students overview */}
      <div className="card card-pad ds-desktop-only">
        <div className="sec-hdr">
          <div className="sec-title sec-title-ic"><Users /> All Students Overview</div>
          <span className="text-xs text-ink2">{students.length} total</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Student</th><th>Stn. No.</th><th>Class</th><th>GWA</th><th>Attendance</th><th>Status</th></tr>
            </thead>
            <tbody>
              {allSlice.map(s => {
                const gwa = getGWA(s, classes)
                const att = getAttRate(s, students, classes)
                const cls = classes.find(c => c.id === s.classId)
                let status = '—', variant = 'gray'
                if (gwa !== null) {
                  if (gwa >= 75)      { status = 'Passing';     variant = 'green' }
                  else if (gwa >= 71) { status = 'Conditional'; variant = 'orange' }
                  else                { status = 'At Risk';     variant = 'red' }
                }
                return (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{s.id}</td>
                    <td>{cls ? cls.name + ' ' + cls.section : '—'}</td>
                    <td><Badge variant={gwa !== null ? (gwa >= 75 ? 'green' : gwa >= 71 ? 'orange' : 'red') : 'gray'}>{gwa !== null ? gwa.toFixed(1) : '—'}</Badge></td>
                    <td><Badge variant={att !== null ? (att >= 80 ? 'green' : 'orange') : 'gray'}>{att !== null ? att.toFixed(1) + '%' : '—'}</Badge></td>
                    <td><Badge variant={variant}>{status}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination total={allStudents.length} perPage={PER_PAGE} page={allPage} onChange={setAllPage} />
      </div>
    </div>
  )
}
