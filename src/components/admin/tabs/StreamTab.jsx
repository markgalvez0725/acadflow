import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Megaphone, ClipboardList, BookOpen, CalendarCheck, FileQuestion, ChevronDown, ChevronUp, Clock, Users, Award, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

function timeAgo(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDate(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function TypeIcon({ type }) {
  if (type === 'announcement') return <span style={{ color: '#f59e0b' }}><Megaphone size={16} /></span>
  if (type === 'activity') return <span style={{ color: '#6366f1' }}><ClipboardList size={16} /></span>
  if (type === 'grade') return <span style={{ color: '#10b981' }}><BookOpen size={16} /></span>
  if (type === 'attendance') return <span style={{ color: '#0ea5e9' }}><CalendarCheck size={16} /></span>
  if (type === 'quiz') return <span style={{ color: '#8b5cf6' }}><FileQuestion size={16} /></span>
  return null
}

function TypeBadge({ type }) {
  const map = {
    announcement: { label: 'Announcement', bg: '#fef3c7', color: '#92400e' },
    activity:     { label: 'Activity',     bg: '#ede9fe', color: '#4c1d95' },
    grade:        { label: 'Grade Update', bg: '#d1fae5', color: '#065f46' },
    attendance:   { label: 'Attendance',   bg: '#e0f2fe', color: '#0c4a6e' },
    quiz:         { label: 'Quiz',         bg: '#f3e8ff', color: '#581c87' },
  }
  const { label, bg, color } = map[type] || { label: type, bg: '#f3f4f6', color: '#374151' }
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {label}
    </span>
  )
}

function AnnouncementCard({ item, classObj }) {
  const ann = item.data
  const [expanded, setExpanded] = useState(false)
  const hasMessage = ann.message && ann.message !== '<p></p>' && ann.message !== ''
  const commentCount = (ann.comments || []).length

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="announcement" />
          <TypeBadge type="announcement" />
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(ann.createdAt)}</span>
      </div>
      <div className="stream-card-title">{ann.title}</div>
      {hasMessage && (
        <div
          style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 6, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: ann.message }}
        />
      )}
      {ann.meetingLink && (
        <a href={ann.meetingLink} target="_blank" rel="noreferrer" className="stream-link-chip">
          <Video size={12} /> Join Meeting
        </a>
      )}
      {ann.moduleLink && (
        <a href={ann.moduleLink} target="_blank" rel="noreferrer" className="stream-link-chip">
          <BookOpen size={12} /> Module Link
        </a>
      )}
      {ann.topics?.length > 0 && (
        <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, color: 'var(--ink2)' }}>
          {ann.topics.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
        {commentCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{commentCount} comment{commentCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

function ActivityCard({ item, classObj, students }) {
  const act = item.data
  const totalRubric = (act.rubric || []).reduce((s, r) => s + (r.points || 0), 0)
  const subCount = Object.keys(act.submissions || {}).length
  const gradedCount = Object.values(act.submissions || {}).filter(s => s.score != null).length
  const classStudents = students.filter(s => {
    const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    return ids.includes(act.classId)
  })
  const totalStudents = classStudents.length
  const notSubmitted = totalStudents - subCount

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="activity" />
          <TypeBadge type="activity" />
          {act.subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{act.subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(act.createdAt)}</span>
      </div>
      <div className="stream-card-title">{act.title}</div>
      {act.deadline && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> Due: {formatDate(act.deadline)}
          {Date.now() > act.deadline && <span style={{ color: '#ef4444', fontWeight: 600 }}>· Overdue</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <div className="stream-stat">
          <CheckCircle2 size={14} style={{ color: '#10b981' }} />
          <span>{subCount} submitted</span>
        </div>
        <div className="stream-stat">
          <Award size={14} style={{ color: '#6366f1' }} />
          <span>{gradedCount} graded</span>
        </div>
        <div className="stream-stat">
          <AlertCircle size={14} style={{ color: '#f59e0b' }} />
          <span>{notSubmitted} pending</span>
        </div>
        {totalRubric > 0 && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink3)' }}>{totalRubric} pts total</span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function QuizCard({ item, classObj, students }) {
  const quiz = item.data
  const now = Date.now()
  const isOpen = now >= quiz.openAt && now <= quiz.closeAt
  const isClosed = now > quiz.closeAt
  const totalQ = (quiz.questions || []).length
  const subCount = Object.keys(quiz.submissions || {}).length
  const scores = Object.values(quiz.submissions || {}).map(s => s.score).filter(s => s != null)
  const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="quiz" />
          <TypeBadge type="quiz" />
          {isOpen && <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>OPEN</span>}
          {isClosed && <span style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>CLOSED</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(quiz.openAt)}</span>
      </div>
      <div className="stream-card-title">{quiz.title}</div>
      <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4, display: 'flex', gap: 16 }}>
        {quiz.openAt && <span><Clock size={11} style={{ display: 'inline', marginRight: 3 }} />Opens: {formatDate(quiz.openAt)}</span>}
        {quiz.closeAt && <span>Closes: {formatDate(quiz.closeAt)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <div className="stream-stat">
          <FileQuestion size={14} style={{ color: '#8b5cf6' }} />
          <span>{totalQ} question{totalQ !== 1 ? 's' : ''}</span>
        </div>
        <div className="stream-stat">
          <CheckCircle2 size={14} style={{ color: '#10b981' }} />
          <span>{subCount} taken</span>
        </div>
        {avgScore != null && (
          <div className="stream-stat">
            <Award size={14} style={{ color: '#f59e0b' }} />
            <span>Avg: {avgScore}%</span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function GradeCard({ item, classObj }) {
  const { studentName, subject, gradeData, uploadedAt } = item.data
  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="grade" />
          <TypeBadge type="grade" />
          {subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(uploadedAt)}</span>
      </div>
      <div className="stream-card-title">{studentName}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {gradeData.midterm != null && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink2)' }}>Midterm: <strong>{gradeData.midterm?.toFixed(1)}</strong></span>
          </div>
        )}
        {gradeData.finals != null && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink2)' }}>Finals: <strong>{gradeData.finals?.toFixed(1)}</strong></span>
          </div>
        )}
        {gradeData.finalGrade != null && (
          <div className="stream-stat">
            <span style={{ color: 'var(--ink)' }}>Final Grade: <strong style={{ color: '#10b981' }}>{gradeData.finalGrade?.toFixed(1)}</strong></span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function AttendanceCard({ item, classObj }) {
  const { subject, date, presentCount, absentCount, excusedCount } = item.data
  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TypeIcon type="attendance" />
          <TypeBadge type="attendance" />
          {subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{date}</span>
      </div>
      <div className="stream-card-title">Attendance — {date}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
        <div className="stream-stat">
          <CheckCircle2 size={14} style={{ color: '#10b981' }} />
          <span>{presentCount} present</span>
        </div>
        <div className="stream-stat">
          <XCircle size={14} style={{ color: '#ef4444' }} />
          <span>{absentCount} absent</span>
        </div>
        {excusedCount > 0 && (
          <div className="stream-stat">
            <AlertCircle size={14} style={{ color: '#f59e0b' }} />
            <span>{excusedCount} excused</span>
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={12} /> {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

export default function StreamTab() {
  const { classes, students, activities, quizzes, announcements } = useData()
  const [filterClass, setFilterClass] = useState('all')
  const [filterType, setFilterType] = useState('all')

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])

  // Build stream items from all data sources
  const streamItems = useMemo(() => {
    const items = []

    // Announcements
    announcements.forEach(ann => {
      if (filterClass !== 'all' && ann.classId !== 'all' && ann.classId !== filterClass) return
      if (filterType !== 'all' && filterType !== 'announcement') return
      items.push({ id: `ann-${ann.id}`, type: 'announcement', ts: ann.createdAt || 0, data: ann, classId: ann.classId })
    })

    // Activities
    activities.forEach(act => {
      if (filterClass !== 'all' && act.classId !== filterClass) return
      if (filterType !== 'all' && filterType !== 'activity') return
      items.push({ id: `act-${act.id}`, type: 'activity', ts: act.createdAt || 0, data: act, classId: act.classId })
    })

    // Quizzes
    quizzes.forEach(quiz => {
      if (filterType !== 'all' && filterType !== 'quiz') return
      const matchesClass = filterClass === 'all' || (quiz.classIds || []).includes(filterClass)
      if (!matchesClass) return
      items.push({ id: `quiz-${quiz.id}`, type: 'quiz', ts: quiz.openAt || 0, data: quiz, classId: quiz.classIds?.[0] })
    })

    // Grades — one card per student+subject grade upload
    students.forEach(stu => {
      const classIds = stu.classIds?.length ? stu.classIds : (stu.classId ? [stu.classId] : [])
      if (filterClass !== 'all' && !classIds.includes(filterClass)) return
      if (filterType !== 'all' && filterType !== 'grade') return

      const gc = stu.gradeComponents || {}
      const uploadedAts = stu.gradeUploadedAt || {}
      const seenSubjects = new Set()

      classIds.forEach(cid => {
        if (filterClass !== 'all' && cid !== filterClass) return
        const cls = classes.find(c => c.id === cid)
        if (!cls) return
        ;(cls.subjects || []).forEach(subj => {
          if (seenSubjects.has(subj)) return
          const gradeData = gc[subj]
          const uploadedAt = uploadedAts[subj]
          if (!gradeData && !uploadedAt) return
          seenSubjects.add(subj)
          items.push({
            id: `grade-${stu.id}-${subj}`,
            type: 'grade',
            ts: uploadedAt || 0,
            classId: cid,
            data: {
              studentName: stu.name,
              subject: subj,
              gradeData: gradeData || {},
              uploadedAt,
            },
          })
        })
      })
    })

    // Attendance — derive unique session dates per class+subject
    if (filterType === 'all' || filterType === 'attendance') {
      const attMap = {}
      students.forEach(stu => {
        const classIds = stu.classIds?.length ? stu.classIds : (stu.classId ? [stu.classId] : [])
        if (filterClass !== 'all' && !classIds.includes(filterClass)) return

        classIds.forEach(cid => {
          if (filterClass !== 'all' && cid !== filterClass) return
          const cls = classes.find(c => c.id === cid)
          if (!cls) return
          ;(cls.subjects || []).forEach(subj => {
            const attDates = stu.attendance?.[subj] || new Set()
            attDates.forEach(date => {
              const key = `${cid}|${subj}|${date}`
              if (!attMap[key]) {
                attMap[key] = { classId: cid, subject: subj, date, present: 0, absent: 0, excused: 0, allClassStudents: [] }
              }
            })
          })
        })
      })

      // Count present/absent per session
      students.forEach(stu => {
        const classIds = stu.classIds?.length ? stu.classIds : (stu.classId ? [stu.classId] : [])
        classIds.forEach(cid => {
          const cls = classes.find(c => c.id === cid)
          if (!cls) return
          ;(cls.subjects || []).forEach(subj => {
            Object.keys(attMap).filter(k => k.startsWith(`${cid}|${subj}|`)).forEach(key => {
              const dateStr = key.split('|')[2]
              const present = (stu.attendance?.[subj] instanceof Set ? stu.attendance[subj] : new Set(stu.attendance?.[subj] || [])).has(dateStr)
              const excused = (stu.excuse?.[subj] instanceof Set ? stu.excuse[subj] : new Set(stu.excuse?.[subj] || [])).has(dateStr)
              if (present) attMap[key].present++
              else if (excused) attMap[key].excused++
              else attMap[key].absent++
            })
          })
        })
      })

      Object.entries(attMap).forEach(([key, val]) => {
        const dateMs = new Date(val.date).getTime()
        items.push({
          id: `att-${key}`,
          type: 'attendance',
          ts: isNaN(dateMs) ? 0 : dateMs,
          classId: val.classId,
          data: {
            subject: val.subject,
            date: val.date,
            presentCount: val.present,
            absentCount: val.absent,
            excusedCount: val.excused,
          },
        })
      })
    }

    return items.sort((a, b) => b.ts - a.ts)
  }, [classes, students, activities, quizzes, announcements, filterClass, filterType])

  function getClassObj(item) {
    return classes.find(c => c.id === item.classId) || null
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 32 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          className="form-input"
          style={{ flex: 1, minWidth: 160, maxWidth: 260, fontSize: 13 }}
          value={filterClass}
          onChange={e => setFilterClass(e.target.value)}
        >
          <option value="all">All Classes</option>
          {activeClasses.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ''}</option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ flex: 1, minWidth: 140, maxWidth: 200, fontSize: 13 }}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="all">All Types</option>
          <option value="announcement">Announcements</option>
          <option value="activity">Activities</option>
          <option value="quiz">Quizzes</option>
          <option value="grade">Grades</option>
          <option value="attendance">Attendance</option>
        </select>
      </div>

      {streamItems.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink3)', padding: '48px 0', fontSize: 14 }}>
          No stream items for the selected filters.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {streamItems.map(item => {
          const classObj = getClassObj(item)
          if (item.type === 'announcement') return <AnnouncementCard key={item.id} item={item} classObj={classObj} />
          if (item.type === 'activity') return <ActivityCard key={item.id} item={item} classObj={classObj} students={students} />
          if (item.type === 'quiz') return <QuizCard key={item.id} item={item} classObj={classObj} students={students} />
          if (item.type === 'grade') return <GradeCard key={item.id} item={item} classObj={classObj} />
          if (item.type === 'attendance') return <AttendanceCard key={item.id} item={item} classObj={classObj} />
          return null
        })}
      </div>
    </div>
  )
}
