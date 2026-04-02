import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { Megaphone, ClipboardList, BookOpen, CalendarCheck, FileQuestion, Clock, CheckCircle2, XCircle, AlertCircle, Award, Video, Link } from 'lucide-react'

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
  const hasMessage = ann.message && ann.message !== '<p></p>' && ann.message !== ''
  const commentCount = (ann.comments || []).length

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#f59e0b' }}><Megaphone size={16} /></span>
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
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
          {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
        {commentCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{commentCount} comment{commentCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

function ActivityCard({ item, classObj, student }) {
  const act = item.data
  const now = Date.now()
  const sub = (act.submissions || {})[student?.id]
  const submitted = !!sub?.link
  const graded = sub?.score != null
  const overdue = act.deadline && now > act.deadline && !submitted
  const totalRubric = (act.rubric || []).reduce((s, r) => s + (r.points || 0), 0)

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#6366f1' }}><ClipboardList size={16} /></span>
          <TypeBadge type="activity" />
          {act.subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{act.subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(act.createdAt)}</span>
      </div>
      <div className="stream-card-title">{act.title}</div>
      {act.deadline && (
        <div style={{ fontSize: 12, color: overdue ? '#ef4444' : 'var(--ink3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> Due: {formatDate(act.deadline)}
          {overdue && <span style={{ fontWeight: 600 }}>· Overdue</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        {submitted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#10b981', fontWeight: 600 }}>
            <CheckCircle2 size={14} /> Submitted
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: overdue ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
            <AlertCircle size={14} /> {overdue ? 'Missed' : 'Not yet submitted'}
          </div>
        )}
        {graded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6366f1', fontWeight: 600 }}>
            <Award size={14} /> Score: {sub.score}{totalRubric > 0 ? `/${totalRubric}` : ''}
          </div>
        )}
        {sub?.feedback && (
          <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, fontStyle: 'italic' }}>
            "{sub.feedback}"
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
          {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function QuizCard({ item, classObj, student }) {
  const quiz = item.data
  const now = Date.now()
  const isOpen = now >= quiz.openAt && now <= quiz.closeAt
  const isClosed = now > quiz.closeAt
  const totalQ = (quiz.questions || []).length
  const sub = quiz.submissions?.[student?.id]
  const taken = !!sub

  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#8b5cf6' }}><FileQuestion size={16} /></span>
          <TypeBadge type="quiz" />
          {isOpen && <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>OPEN</span>}
          {isClosed && <span style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>CLOSED</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(quiz.openAt)}</span>
      </div>
      <div className="stream-card-title">{quiz.title}</div>
      <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>
        {quiz.openAt && <span><Clock size={11} style={{ display: 'inline', marginRight: 3 }} />Opens: {formatDate(quiz.openAt)}</span>}
        {quiz.closeAt && <span style={{ marginLeft: 12 }}>Closes: {formatDate(quiz.closeAt)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{totalQ} question{totalQ !== 1 ? 's' : ''}</div>
        {taken ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#10b981', fontWeight: 600 }}>
            <CheckCircle2 size={14} /> Completed
            {sub.score != null && <span>· Score: {sub.score}%</span>}
          </div>
        ) : isOpen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
            <AlertCircle size={14} /> Not yet taken
          </div>
        ) : isClosed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
            <XCircle size={14} /> Missed
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Not yet open</div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
          {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function GradeCard({ item, classObj }) {
  const { subject, gradeData, uploadedAt } = item.data
  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#10b981' }}><BookOpen size={16} /></span>
          <TypeBadge type="grade" />
          {subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{timeAgo(uploadedAt)}</span>
      </div>
      <div className="stream-card-title">Grade posted for {subject}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {gradeData.midterm != null && (
          <span style={{ fontSize: 13, color: 'var(--ink2)' }}>Midterm: <strong>{gradeData.midterm?.toFixed(1)}</strong></span>
        )}
        {gradeData.finals != null && (
          <span style={{ fontSize: 13, color: 'var(--ink2)' }}>Finals: <strong>{gradeData.finals?.toFixed(1)}</strong></span>
        )}
        {gradeData.finalGrade != null && (
          <span style={{ fontSize: 13, color: 'var(--ink)' }}>Final Grade: <strong style={{ color: '#10b981' }}>{gradeData.finalGrade?.toFixed(1)}</strong></span>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
          {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

function AttendanceCard({ item, classObj }) {
  const { subject, date, present } = item.data
  return (
    <div className="stream-card">
      <div className="stream-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#0ea5e9' }}><CalendarCheck size={16} /></span>
          <TypeBadge type="attendance" />
          {subject && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{subject}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{date}</span>
      </div>
      <div className="stream-card-title">Attendance — {date}</div>
      <div style={{ marginTop: 8 }}>
        {present ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#10b981', fontWeight: 600 }}>
            <CheckCircle2 size={14} /> Present
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
            <XCircle size={14} /> Absent
          </div>
        )}
      </div>
      <div className="stream-card-footer">
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>
          {classObj?.name}{classObj?.section ? ` — ${classObj.section}` : ''}
        </span>
      </div>
    </div>
  )
}

export default function StreamTab({ student, viewClassId, classes }) {
  const { activities, quizzes, announcements } = useData()
  const [filterType, setFilterType] = useState('all')

  const studentClassIds = useMemo(() => {
    if (!student) return []
    return student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
  }, [student])

  const effectiveClassIds = useMemo(() => {
    if (viewClassId) return [viewClassId]
    return studentClassIds
  }, [viewClassId, studentClassIds])

  const streamItems = useMemo(() => {
    const items = []

    // Announcements
    if (filterType === 'all' || filterType === 'announcement') {
      announcements.forEach(ann => {
        const matchesClass = ann.classId === 'all' || effectiveClassIds.includes(ann.classId)
        if (!matchesClass) return
        items.push({ id: `ann-${ann.id}`, type: 'announcement', ts: ann.createdAt || 0, data: ann, classId: ann.classId })
      })
    }

    // Activities
    if (filterType === 'all' || filterType === 'activity') {
      activities.forEach(act => {
        if (!effectiveClassIds.includes(act.classId)) return
        items.push({ id: `act-${act.id}`, type: 'activity', ts: act.createdAt || 0, data: act, classId: act.classId })
      })
    }

    // Quizzes
    if (filterType === 'all' || filterType === 'quiz') {
      quizzes.forEach(quiz => {
        const matchesClass = (quiz.classIds || []).some(id => effectiveClassIds.includes(id))
        if (!matchesClass) return
        items.push({ id: `quiz-${quiz.id}`, type: 'quiz', ts: quiz.openAt || 0, data: quiz, classId: quiz.classIds?.[0] })
      })
    }

    // Grades
    if ((filterType === 'all' || filterType === 'grade') && student) {
      const gc = student.gradeComponents || {}
      const uploadedAts = student.gradeUploadedAt || {}
      effectiveClassIds.forEach(cid => {
        const cls = classes.find(c => c.id === cid)
        if (!cls) return
        ;(cls.subjects || []).forEach(subj => {
          const gradeData = gc[subj]
          const uploadedAt = uploadedAts[subj]
          if (!gradeData && !uploadedAt) return
          items.push({
            id: `grade-${student.id}-${subj}`,
            type: 'grade',
            ts: uploadedAt || 0,
            classId: cid,
            data: { subject: subj, gradeData: gradeData || {}, uploadedAt },
          })
        })
      })
    }

    // Attendance
    if ((filterType === 'all' || filterType === 'attendance') && student) {
      effectiveClassIds.forEach(cid => {
        const cls = classes.find(c => c.id === cid)
        if (!cls) return
        ;(cls.subjects || []).forEach(subj => {
          const attDates = student.attendance?.[subj]
          if (!attDates) return
          const datesArr = attDates instanceof Set ? [...attDates] : (Array.isArray(attDates) ? attDates : [])
          datesArr.forEach(date => {
            const dateMs = new Date(date).getTime()
            items.push({
              id: `att-${cid}-${subj}-${date}`,
              type: 'attendance',
              ts: isNaN(dateMs) ? 0 : dateMs,
              classId: cid,
              data: { subject: subj, date, present: true },
            })
          })
        })
      })
    }

    return items.sort((a, b) => b.ts - a.ts)
  }, [student, effectiveClassIds, activities, quizzes, announcements, filterType, classes])

  function getClassObj(item) {
    return classes.find(c => c.id === item.classId) || null
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* Filter */}
      <div style={{ marginBottom: 16 }}>
        <select
          className="form-input"
          style={{ fontSize: 13, width: '100%', maxWidth: 220 }}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="all">All Updates</option>
          <option value="announcement">Announcements</option>
          <option value="activity">Activities</option>
          <option value="quiz">Quizzes</option>
          <option value="grade">Grades</option>
          <option value="attendance">Attendance</option>
        </select>
      </div>

      {streamItems.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink3)', padding: '48px 0', fontSize: 14 }}>
          No updates yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {streamItems.map(item => {
          const classObj = getClassObj(item)
          if (item.type === 'announcement') return <AnnouncementCard key={item.id} item={item} classObj={classObj} />
          if (item.type === 'activity') return <ActivityCard key={item.id} item={item} classObj={classObj} student={student} />
          if (item.type === 'quiz') return <QuizCard key={item.id} item={item} classObj={classObj} student={student} />
          if (item.type === 'grade') return <GradeCard key={item.id} item={item} classObj={classObj} />
          if (item.type === 'attendance') return <AttendanceCard key={item.id} item={item} classObj={classObj} />
          return null
        })}
      </div>
    </div>
  )
}
