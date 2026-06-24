import React, { useState, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { activeClassIds } from '@/utils/active'
import ExpandableHtml from '@/components/primitives/ExpandableHtml'
import { sanitizeAnnouncementHtml } from '@/utils/sanitizeHtml'

const PAGE_SIZE = 10

function getGroupLabel(ts) {
  if (!ts) return 'Earlier'
  const now = new Date()
  const d = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today - itemDay) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString('en-PH', { weekday: 'long' })
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

const shimmerStyle = {
  background: 'linear-gradient(90deg, var(--border) 25%, var(--surface) 50%, var(--border) 75%)',
  backgroundSize: '800px 100%',
  animation: 'shimmer 1.4s infinite linear',
  borderRadius: 6,
}

function StreamSkeleton() {
  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} className="stream-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ ...shimmerStyle, width: 80, height: 18 }} />
            <div style={{ ...shimmerStyle, width: 50, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: '70%', height: 18 }} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...shimmerStyle, width: 90, height: 14 }} />
            <div style={{ ...shimmerStyle, width: 70, height: 14 }} />
          </div>
          <div style={{ ...shimmerStyle, width: 120, height: 12 }} />
        </div>
      ))}
    </>
  )
}

function Pagination({ page, total, pageSize, onPrev, onNext }) {
  if (total === 0) return null
  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12, fontSize: 13, color: 'var(--ink2)' }}>
      <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={page === 0}>← Prev</button>
      <span>Showing {from}–{to} of {total}</span>
      <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={to >= total}>Next →</button>
    </div>
  )
}
import { BookOpen, Clock, CheckCircle2, XCircle, AlertCircle, Award, Video, Link } from 'lucide-react'
import PostShell from '@/components/primitives/StreamPost'

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

function classLabel(classObj) {
  return classObj?.name ? `${classObj.name}${classObj.section ? ' · ' + classObj.section : ''}` : ''
}

function AnnouncementCard({ item, classObj }) {
  const ann = item.data
  const hasMessage = ann.message && ann.message !== '<p></p>' && ann.message !== ''
  const commentCount = (ann.comments || []).length
  const cls = classLabel(classObj)
  const hasBody = hasMessage || ann.meetingLink || ann.moduleLink || (!hasMessage && ann.topics?.length > 0)
  return (
    <PostShell
      type="announcement"
      title={ann.title}
      meta={<>{cls && <span>{cls}</span>}{cls && <span>·</span>}<span>{timeAgo(ann.createdAt)}</span></>}
      badges={item.pinned ? <span className="badge badge-blue" style={{ fontSize: 10, flexShrink: 0 }}>Pinned</span> : null}
      pinned={item.pinned}
      commentCount={commentCount}
    >
      {hasBody ? (
        <>
          {hasMessage && <ExpandableHtml html={sanitizeAnnouncementHtml(ann.message)} style={{ fontSize: 13.5, color: 'var(--ink2)', lineHeight: 1.55 }} />}
          {ann.meetingLink && <a href={ann.meetingLink} target="_blank" rel="noreferrer" className="stream-link-chip"><Video size={12} /> Join Meeting</a>}
          {ann.moduleLink && <a href={ann.moduleLink} target="_blank" rel="noreferrer" className="stream-link-chip"><BookOpen size={12} /> Module Link</a>}
          {!hasMessage && ann.topics?.length > 0 && (
            <ul style={{ marginTop: 4, paddingLeft: 20, listStyle: 'disc' }}>{ann.topics.map((t, i) => <li key={i}>{t}</li>)}</ul>
          )}
        </>
      ) : null}
    </PostShell>
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
    <PostShell
      type="activity"
      title={act.title}
      meta={<><span>Activity{act.subject ? ` · ${act.subject}` : ''}</span><span>·</span><span>{timeAgo(act.createdAt)}</span></>}
    >
      {act.deadline && (
        <div style={{ fontSize: 12, color: overdue ? '#ef4444' : 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> Due: {formatDate(act.deadline)}{overdue && <span style={{ fontWeight: 600 }}> · Overdue</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {submitted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#10b981', fontWeight: 600 }}><CheckCircle2 size={14} /> Submitted</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: overdue ? '#ef4444' : '#f59e0b', fontWeight: 600 }}><AlertCircle size={14} /> {overdue ? 'Missed' : 'Not yet submitted'}</div>
        )}
        {graded && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6366f1', fontWeight: 600 }}><Award size={14} /> Score: {sub.score}{totalRubric > 0 ? `/${totalRubric}` : ''}</div>}
      </div>
      {sub?.feedback && <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, fontStyle: 'italic' }}>"{sub.feedback}"</div>}
    </PostShell>
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
  const subTotal = sub ? (sub.total ?? quiz.totalPoints ?? totalQ) : 0
  return (
    <PostShell
      type="quiz"
      title={quiz.title}
      meta={<><span>Quiz{quiz.subject ? ` · ${quiz.subject}` : ''}</span><span>·</span><span>{timeAgo(quiz.openAt)}</span></>}
      badges={isOpen
        ? <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', fontWeight: 700, padding: '1px 7px', borderRadius: 20, flexShrink: 0 }}>OPEN</span>
        : isClosed ? <span style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 700, padding: '1px 7px', borderRadius: 20, flexShrink: 0 }}>CLOSED</span> : null}
    >
      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
        {quiz.openAt && <span><Clock size={11} style={{ display: 'inline', marginRight: 3 }} />Opens: {formatDate(quiz.openAt)}</span>}
        {quiz.closeAt && <span style={{ marginLeft: 12 }}>Closes: {formatDate(quiz.closeAt)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{totalQ} question{totalQ !== 1 ? 's' : ''}</div>
        {taken ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#10b981', fontWeight: 600 }}><CheckCircle2 size={14} /> Completed{sub.score != null && <span> · {sub.score}/{subTotal}</span>}</div>
        ) : isOpen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#f59e0b', fontWeight: 600 }}><AlertCircle size={14} /> Not yet taken</div>
        ) : isClosed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#ef4444', fontWeight: 600 }}><XCircle size={14} /> Missed</div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Not yet open</div>
        )}
      </div>
    </PostShell>
  )
}

function GradeCard({ item, classObj }) {
  const { subject, gradeData, uploadedAt } = item.data
  const cls = classLabel(classObj)
  return (
    <PostShell
      type="grade"
      title={`Grade posted for ${subject}`}
      meta={<>{cls && <span>{cls}</span>}{cls && <span>·</span>}<span>{timeAgo(uploadedAt)}</span></>}
    >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {gradeData.midterm != null && <span style={{ fontSize: 13 }}>Midterm: <strong>{gradeData.midterm?.toFixed(1)}</strong></span>}
        {gradeData.finals != null && <span style={{ fontSize: 13 }}>Finals: <strong>{gradeData.finals?.toFixed(1)}</strong></span>}
        {gradeData.finalGrade != null && <span style={{ fontSize: 13, color: 'var(--ink)' }}>Final Grade: <strong style={{ color: '#10b981' }}>{gradeData.finalGrade?.toFixed(1)}</strong></span>}
      </div>
    </PostShell>
  )
}

function AttendanceCard({ item, classObj }) {
  const { subject, date, present } = item.data
  const cls = classLabel(classObj)
  return (
    <PostShell
      type="attendance"
      title={`Attendance — ${date}`}
      meta={<span>{subject || 'Attendance'}{cls ? ` · ${cls}` : ''}</span>}
    >
      {present ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#10b981', fontWeight: 600 }}><CheckCircle2 size={14} /> Present</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#ef4444', fontWeight: 600 }}><XCircle size={14} /> Absent</div>
      )}
    </PostShell>
  )
}

export default function StreamTab({ student, viewClassId, classes }) {
  const { activities, quizzes, announcements, fbReady, semester } = useData()
  const [filterType, setFilterType] = useState('all')
  const [filterSubject, setFilterSubject] = useState('all')
  const [streamPage, setStreamPage] = useState(0)

  // Only current-semester, non-archived classes feed the stream.
  const studentClassIds = useMemo(
    () => activeClassIds(student, classes, semester),
    [student, classes, semester]
  )

  const effectiveClassIds = useMemo(() => {
    if (viewClassId) return [viewClassId]
    return studentClassIds
  }, [viewClassId, studentClassIds])

  // Subjects across the visible classes, for the subject filter.
  const subjectOptions = useMemo(() => {
    const subs = effectiveClassIds.flatMap(id => classes.find(c => c.id === id)?.subjects || [])
    return [...new Set(subs)].sort()
  }, [effectiveClassIds, classes])

  const streamItems = useMemo(() => {
    const items = []

    // Announcements
    if (filterType === 'all' || filterType === 'announcement') {
      const nowTs = Date.now()
      announcements.forEach(ann => {
        const matchesClass = ann.classId === 'all' || effectiveClassIds.includes(ann.classId)
        if (!matchesClass) return
        // Hide scheduled announcements until their publish time.
        if (ann.publishAt && ann.publishAt > nowTs) return
        const annPinned = !!ann.pinned && !(ann.expiresAt && ann.expiresAt < nowTs)
        items.push({ id: `ann-${ann.id}`, type: 'announcement', ts: ann.createdAt || 0, data: ann, classId: ann.classId, pinned: annPinned })
      })
    }

    // Activities
    if (filterType === 'all' || filterType === 'activity') {
      activities.forEach(act => {
        if (!effectiveClassIds.includes(act.classId)) return
        if (filterSubject !== 'all' && act.subject !== filterSubject) return
        items.push({ id: `act-${act.id}`, type: 'activity', ts: act.createdAt || 0, data: act, classId: act.classId })
      })
    }

    // Quizzes
    if (filterType === 'all' || filterType === 'quiz') {
      quizzes.forEach(quiz => {
        const matchesClass = (quiz.classIds || []).some(id => effectiveClassIds.includes(id))
        if (!matchesClass) return
        if (filterSubject !== 'all' && quiz.subject !== filterSubject) return
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
          if (filterSubject !== 'all' && subj !== filterSubject) return
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
          if (filterSubject !== 'all' && subj !== filterSubject) return
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

    // Pinned announcements first, then most recent.
    return items.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (b.ts - a.ts))
  }, [student, effectiveClassIds, activities, quizzes, announcements, filterType, filterSubject, classes])

  function getClassObj(item) {
    return classes.find(c => c.id === item.classId) || null
  }

  if (!fbReady) {
    return (
      <div className="s-feed" style={{ paddingBottom: 32 }}>
        <StreamSkeleton />
      </div>
    )
  }

  const TYPE_FILTERS = [
    ['all', 'All'],
    ['announcement', 'Announcements'],
    ['activity', 'Activities'],
    ['quiz', 'Quizzes'],
    ['grade', 'Grades'],
    ['attendance', 'Attendance'],
  ]

  return (
    <div className="s-feed" style={{ paddingBottom: 32 }}>
      {/* Filter pills + optional subject dropdown */}
      <div className="s-filter-pills">
        {TYPE_FILTERS.map(([k, label]) => (
          <button key={k} className={`s-pill${filterType === k ? ' active' : ''}`} onClick={() => { setFilterType(k); setStreamPage(0) }}>{label}</button>
        ))}
      </div>
      {subjectOptions.length > 1 && (
        <select
          className="form-input"
          style={{ fontSize: 13, maxWidth: 220 }}
          value={filterSubject}
          onChange={e => { setFilterSubject(e.target.value); setStreamPage(0) }}
          title="Filter by subject"
        >
          <option value="all">All Subjects</option>
          {subjectOptions.map(subj => <option key={subj} value={subj}>{subj}</option>)}
        </select>
      )}

      {streamItems.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--ink3)', padding: '48px 0', fontSize: 14 }}>
          No updates yet.
        </div>
      )}

      {streamItems.slice(streamPage * PAGE_SIZE, (streamPage + 1) * PAGE_SIZE).map((item, idx, arr) => {
        const classObj = getClassObj(item)
        const label = item.pinned ? 'Pinned' : getGroupLabel(item.ts)
        const prevLabel = idx > 0 ? (arr[idx - 1].pinned ? 'Pinned' : getGroupLabel(arr[idx - 1].ts)) : null
        const showGroup = label !== prevLabel
        return (
          <React.Fragment key={item.id}>
            {showGroup && <div className="s-feed-day">{label}</div>}
            {item.type === 'announcement' && <AnnouncementCard item={item} classObj={classObj} />}
            {item.type === 'activity' && <ActivityCard item={item} classObj={classObj} student={student} />}
            {item.type === 'quiz' && <QuizCard item={item} classObj={classObj} student={student} />}
            {item.type === 'grade' && <GradeCard item={item} classObj={classObj} />}
            {item.type === 'attendance' && <AttendanceCard item={item} classObj={classObj} />}
          </React.Fragment>
        )
      })}
      <Pagination page={streamPage} total={streamItems.length} pageSize={PAGE_SIZE} onPrev={() => setStreamPage(p => p - 1)} onNext={() => setStreamPage(p => p + 1)} />
    </div>
  )
}
