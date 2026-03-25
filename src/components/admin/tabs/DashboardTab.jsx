import React, { useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import { getGWA, getAttRate } from '@/utils/grades'
import { sortByLastName } from '@/utils/format'
import Badge from '@/components/primitives/Badge'
import Pagination from '@/components/primitives/Pagination'
import BarChart from '@/components/charts/BarChart'
import DonutChart from '@/components/charts/DonutChart'
import { Users, School, BookOpen, CalendarCheck, ShieldCheck } from 'lucide-react'

const PER_PAGE = 10

export default function DashboardTab() {
  const { students, classes, fbReady } = useData()
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

  // Chart data
  const barData = useMemo(() => classes.map(cls => {
    const enrolled = students.filter(s => s.classId === cls.id || s.classIds?.includes(cls.id))
    const gwas = enrolled.map(s => getGWA(s, classes)).filter(g => g !== null)
    return { label: cls.name + ' ' + cls.section, value: gwas.length ? gwas.reduce((a, b) => a + b, 0) / gwas.length : 0 }
  }), [students, classes])

  const donutData = useMemo(() => {
    const passed = [], conditional = [], failed = []
    students.forEach(s => {
      const g = getGWA(s, classes)
      if (g === null) return
      if (g >= 75) passed.push(s)
      else if (g >= 71) conditional.push(s)
      else failed.push(s)
    })
    return [
      { label: 'Passed', value: passed.length, color: '#1a7a4a' },
      { label: 'Conditional', value: conditional.length, color: '#d97706' },
      { label: 'Failed', value: failed.length, color: '#b93232' },
    ]
  }, [students, classes])

  const riskSlice  = atRisk.slice((riskPage - 1) * PER_PAGE, riskPage * PER_PAGE)
  const lowSlice   = lowAtt.slice((lowAttPage - 1) * PER_PAGE, lowAttPage * PER_PAGE)
  const allSlice   = allStudents.slice((allPage - 1) * PER_PAGE, allPage * PER_PAGE)

  return (
    <div>
      {/* Stat cards */}
      <div className="stat-grid mb-4">
        <div className="stat-card"><div className="sc-icon"><Users size={22} /></div><div className="sc-val">{stats.total}</div><div className="sc-label">Total Students</div><div className="sc-sub">{stats.regCount} with accounts</div></div>
        <div className="stat-card"><div className="sc-icon"><School size={22} /></div><div className="sc-val">{stats.classes}</div><div className="sc-label">Active Classes</div><div className="sc-sub">{stats.subjects} subjects total</div></div>
        <div className="stat-card"><div className="sc-icon"><BookOpen size={22} /></div><div className="sc-val">{stats.avgGwa}</div><div className="sc-label">Average GWA</div><div className="sc-sub">School-wide</div></div>
        <div className="stat-card"><div className="sc-icon"><CalendarCheck size={22} /></div><div className="sc-val">{stats.avgAtt}</div><div className="sc-label">Avg. Attendance</div><div className="sc-sub">Across all students</div></div>
      </div>

      {/* Charts */}
      <div className="grid-2 mb-4">
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
      <div className="grid-2 mb-4">
        <div>
          <div className="sec-hdr"><div className="sec-title">Students at Risk (below 75%)</div></div>
          {!atRisk.length ? (
            <div className="empty"><div className="empty-icon"><ShieldCheck size={28} /></div>No at-risk students</div>
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
          <div className="sec-hdr"><div className="sec-title">Low Attendance (&lt; 80%)</div></div>
          {!lowAtt.length ? (
            <div className="empty"><div className="empty-icon"><CalendarCheck size={28} /></div>No low-attendance students</div>
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
      <div className="card card-pad">
        <div className="sec-hdr">
          <div className="sec-title">All Students Overview</div>
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
