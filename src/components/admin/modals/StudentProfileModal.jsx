import React, { useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import { useUI } from '@/context/UIContext'
import Modal from '@/components/primitives/Modal'
import {
  gradeInfo, combineEquiv, computeFinalGradeFromTerms, getGWA, getAttRate, pctColor,
} from '@/utils/grades'
import { subjectColor } from '@/utils/subjectColor'
import { activeClassIds, activeSubjects } from '@/utils/active'
import { accountStatus } from '@/utils/accountStatus'
import { buildStudentReportCard } from '@/export/reportCard'
import { courseShort } from '@/constants/courses'
import {
  BarChart3, CalendarCheck, BookOpen, ClipboardList, FileDown,
  ChevronDown, ChevronRight, GraduationCap, Clock,
} from 'lucide-react'

// One expandable subject card: grade breakdown + this student's activities & quizzes.
function SubjectBlock({ sub, student, classes, eqScale, activities, quizzes, enrolledIds }) {
  const [open, setOpen] = useState(false)
  const comp = student.gradeComponents?.[sub] || {}
  const mid = comp.midterm ?? null
  const fin = comp.finals ?? null
  const finalPct = computeFinalGradeFromTerms(mid, fin) ?? student.grades?.[sub] ?? null

  let equiv = '-', remark = null, remarkCls = 'badge-gray'
  if (mid != null && fin != null) {
    const combined = combineEquiv(gradeInfo(mid, eqScale).eq, gradeInfo(fin, eqScale).eq)
    equiv = combined.eq
    remark = combined.rem
    remarkCls = combined.rem === 'Passed' ? 'badge-green' : combined.rem === 'Conditional' ? 'badge-yellow' : combined.rem === 'Failed' ? 'badge-red' : 'badge-gray'
  }

  const subjActs = activities.filter(a => enrolledIds.includes(a.classId) && a.subject === sub)
  const subjQuiz = quizzes.filter(q => q.subject === sub && q.classIds?.some(id => enrolledIds.includes(id)))
  const col = subjectColor(sub).color

  return (
    <div className="rounded-xl border border-border bg-surface" style={{ overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', textAlign: 'left' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: col, flexShrink: 0 }} />
        <span style={{ flex: 1, fontWeight: 600, fontSize: 14, minWidth: 0 }}>{sub}</span>
        <span style={{ fontWeight: 800, fontSize: 18, color: pctColor(finalPct) }}>{finalPct != null ? Math.round(finalPct) : '-'}</span>
        {remark ? <span className={`badge ${remarkCls}`}>{remark}</span> : <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>}
        {open ? <ChevronDown size={16} style={{ color: 'var(--ink3)' }} /> : <ChevronRight size={16} style={{ color: 'var(--ink3)' }} />}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink2)' }}>Midterm</div><div style={{ fontWeight: 700 }}>{mid != null ? `${mid.toFixed(1)}%` : '-'}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink2)' }}>Finals</div><div style={{ fontWeight: 700 }}>{fin != null ? `${fin.toFixed(1)}%` : '-'}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink2)' }}>Equivalent</div><div style={{ fontWeight: 700 }}>{equiv}</div></div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Activities ({subjActs.length})</div>
            {!subjActs.length ? <div style={{ fontSize: 12, color: 'var(--ink3)' }}>No activities.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {subjActs.map(a => {
                  const subm = (a.submissions || {})[student.id] || {}
                  const max = a.maxScore || 100
                  const label = subm.score != null ? `${subm.score}/${max}` : subm.link ? 'Submitted' : (a.deadline && Date.now() > a.deadline ? 'Missed' : 'Open')
                  const cl = subm.score != null ? (subm.score / max >= 0.75 ? 'var(--green)' : subm.score / max >= 0.6 ? 'var(--yellow)' : 'var(--red)') : subm.link ? 'var(--accent)' : 'var(--ink3)'
                  return <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'var(--ink2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span><span style={{ fontWeight: 700, color: cl, flexShrink: 0, marginLeft: 8 }}>{label}</span></div>
                })}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Quizzes ({subjQuiz.length})</div>
            {!subjQuiz.length ? <div style={{ fontSize: 12, color: 'var(--ink3)' }}>No quizzes.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {subjQuiz.map(q => {
                  const subm = (q.submissions || {})[student.id]
                  const total = q.questions?.length || 0
                  const label = subm ? `${subm.score}/${total}` : (Date.now() > q.closeAt ? 'Missed' : 'Not taken')
                  const cl = subm ? (total && subm.score / total >= 0.75 ? 'var(--green)' : 'var(--yellow)') : 'var(--ink3)'
                  return <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span style={{ color: 'var(--ink2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.title}</span><span style={{ fontWeight: 700, color: cl, flexShrink: 0, marginLeft: 8 }}>{label}</span></div>
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudentProfileModal() {
  const { viewStudentId, closeStudentProfile, setAdminTab, openEditGradesForStudent } = useUI()
  const { students, classes, activities, quizzes, eqScale, semester } = useData()

  const student = useMemo(() => students.find(s => s.id === viewStudentId) || null, [students, viewStudentId])

  if (!viewStudentId) return null
  if (!student) {
    return (
      <Modal onClose={closeStudentProfile} size="md">
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink2)' }}>Student not found.</div>
      </Modal>
    )
  }

  // Current-semester only: exclude archived AND past/other-semester classes
  // (whatever their status). Previous, finalized subjects are not shown here.
  const enrolledIds = activeClassIds(student, classes, semester)
  const enrolledClasses = enrolledIds.map(id => classes.find(c => c.id === id)).filter(Boolean)
  const subjects = activeSubjects(student, classes, semester)

  const gwa = getGWA(student, classes)
  const attRate = getAttRate(student, students, classes)
  const pendingCount = activities.filter(a => enrolledIds.includes(a.classId) && !(a.submissions || {})[student.id]?.link && !(a.deadline && Date.now() > a.deadline)).length
  const initial = (student.name || '?').charAt(0).toUpperCase()
  const acct = accountStatus(student).label

  return (
    <Modal onClose={closeStudentProfile} size="lg">
      {/* Header */}
      <div className="pr-8" style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
        <div className="stu-avatar" style={{ width: 56, height: 56, fontSize: 22, flexShrink: 0, overflow: 'hidden' }}>
          {student.photo ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : initial}
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 className="text-lg font-bold text-ink" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student.name}</span>
            <VerifiedBadge student={student} size={17} />
          </h3>
          <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
            #{student.id} · <span title={student.course || ''}>{courseShort(student.course) || '-'}</span> · {student.year || '-'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>
            {enrolledClasses.map(c => `${courseShort(c.name)} ${c.section}`).join(' · ') || 'Unassigned'} · Account: {acct}
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div className="stat-grid mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { Icon: BarChart3, label: 'GWA', value: gwa != null ? gwa.toFixed(1) : '-', color: pctColor(gwa) },
          { Icon: CalendarCheck, label: 'Attendance', value: attRate != null ? `${attRate.toFixed(0)}%` : '-', color: attRate == null ? 'var(--ink3)' : attRate >= 90 ? 'var(--green)' : attRate >= 80 ? 'var(--yellow)' : 'var(--red)' },
          { Icon: BookOpen, label: 'Subjects', value: subjects.length, color: 'var(--ink)' },
          { Icon: ClipboardList, label: 'Pending', value: pendingCount, color: pendingCount ? 'var(--yellow)' : 'var(--green)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '10px 12px' }}>
            <s.Icon size={15} style={{ color: 'var(--ink3)' }} />
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1.1, marginTop: 2 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => buildStudentReportCard(student, { classes, students, eqScale, semester })}>
          <FileDown size={14} /> Report card
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { closeStudentProfile(); setAdminTab('grades'); openEditGradesForStudent(student.id) }}>
          <GraduationCap size={14} /> Open Grades
        </button>
      </div>

      {/* Subjects */}
      <div className="sec-hdr" style={{ marginBottom: 10 }}>
        <div className="sec-title sec-title-ic"><BookOpen /> Subjects, grades, activities & quizzes</div>
      </div>
      {!subjects.length ? (
        <div className="empty"><div className="empty-icon"><BookOpen size={36} /></div>No subjects this semester.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {subjects.map(sub => (
            <SubjectBlock
              key={sub}
              sub={sub}
              student={student}
              classes={classes}
              eqScale={eqScale}
              activities={activities}
              quizzes={quizzes}
              enrolledIds={enrolledIds}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}
