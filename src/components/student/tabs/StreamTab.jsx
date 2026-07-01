import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { activeClassIds } from '@/utils/active'
import ExpandableHtml from '@/components/primitives/ExpandableHtml'
import { sanitizeAnnouncementHtml } from '@/utils/sanitizeHtml'
import { streamGroupLabel as getGroupLabel, fmtDateTime as formatDate, dayLabel } from '@/utils/format'
import { courseShort } from '@/constants/courses'
import useInfiniteFeed from '@/hooks/useInfiniteFeed'

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

import { BookOpen, Clock, CheckCircle2, XCircle, AlertCircle, Award, Video, Link, Heart, MessageCircle, Send, Bookmark, BadgeCheck, MoreHorizontal } from 'lucide-react'
import PostShell from '@/components/primitives/StreamPost'
import Modal from '@/components/primitives/Modal'
import StreamMedia from '@/components/primitives/StreamMedia'
import MediaLightbox from '@/components/primitives/MediaLightbox'
import TextCard from '@/components/primitives/TextCard'
import CommentsSection from '@/components/primitives/CommentsSection'
import KebabMenu from '@/components/primitives/KebabMenu'
import AnnouncementPost from '@/components/primitives/AnnouncementPost'
import { mediaFromAnnouncement, isPreviewableLink } from '@/utils/streamMedia'
import { annReaches, annClassIds, announcementClassPills } from '@/utils/announce'

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
  return classObj?.name ? `${courseShort(classObj.name)}${classObj.section ? ' · ' + classObj.section : ''}` : ''
}

// Uppercase long-date kicker for the body panel, matching the announcement
// TextCard's date label (e.g. "JUNE 28, 2026").
function dateKicker(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
}

// Class + subject pills shared by the non-announcement cards, reusing the same
// pill styling as the announcement card.
function StreamPills({ cls, subject }) {
  if (!cls && !subject) return null
  return (
    <>
      {cls && <span className="ig-pill ig-pill-class">{cls}</span>}
      {subject && <span className="ig-pill ig-pill-subject">{subject}</span>}
    </>
  )
}

// A short, plain-text summary of an announcement for the "message professor"
// post preview (title field is gone, so fall back to the message / topics).
function announcementSummary(ann) {
  if (ann.title) return String(ann.title).slice(0, 80)
  const txt = (ann.message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (txt) return txt.slice(0, 80)
  if (ann.topics?.length) return ann.topics.slice(0, 2).join(', ')
  return ''
}

// Thin wrapper: the IG card lives in the shared AnnouncementPost; the student
// side just supplies its kebab (Save / notifications) and comment identity.
function AnnouncementCard({ item, classObj, classPills, student, author, highlight }) {
  const { toggleAnnouncementLike, toggleSavedPost, toggleAnnouncementFollow } = useData()
  const { messageProfessorAboutPost } = useUI()
  const ann = item.data
  // Compact post reference (with a thumbnail) sent into the professor DM so the
  // message carries a tappable preview of this exact post.
  function buildPostRef() {
    const firstThumb = mediaFromAnnouncement(ann).find(m => m.imageUrl)
    return {
      id: ann.id,
      type: ann.type,
      title: announcementSummary(ann),
      classLabel: (classPills && classPills[0]) || 'All classes',
      classId: classObj?.id || null,
      thumb: firstThumb?.imageUrl || null,
    }
  }
  const menuItems = student ? (() => {
    const saved = (student.savedPosts || []).includes(ann.id)
    const followed = (ann.followers || []).includes(student.id)
    return [
      { label: saved ? 'Saved' : 'Save announcement', onClick: () => toggleSavedPost(student.id, ann.id, !saved) },
      { label: followed ? 'Turn off notifications' : 'Turn on notifications', onClick: () => toggleAnnouncementFollow(ann.id, student.id, !followed) },
    ]
  })() : []
  return (
    <AnnouncementPost
      ann={ann}
      author={author}
      classObj={classObj}
      classPills={classPills}
      pinned={item.pinned}
      menuItems={menuItems}
      viewerId={student?.id}
      onToggleLike={toggleAnnouncementLike}
      commentAuthor={student ? { id: student.id, name: student.name || 'You', role: 'student' } : null}
      onAskProfessor={student ? () => messageProfessorAboutPost(buildPostRef()) : null}
      domId={`annpost-${ann.id}`}
      highlight={highlight}
    />
  )
}

function ActivityCard({ item, classObj, student }) {
  const { messageProfessorAboutPost } = useUI()
  const act = item.data
  const now = Date.now()
  const sub = (act.submissions || {})[student?.id]
  const submitted = !!sub?.link
  const graded = sub?.score != null
  const overdue = act.deadline && now > act.deadline && !submitted
  const totalRubric = (act.rubric || []).reduce((s, r) => s + (r.points || 0), 0)
  const cls = classLabel(classObj)
  const onAsk = student ? () => messageProfessorAboutPost({
    id: act.id, type: 'activity', title: (act.title || 'Activity').slice(0, 80),
    classLabel: cls || 'Class', classId: classObj?.id || act.classId || null, thumb: null,
  }) : null
  return (
    <PostShell
      type="activity"
      time={timeAgo(act.createdAt)}
      dateLabel={dateKicker(act.createdAt)}
      title={act.title}
      onAskProfessor={onAsk}
      pills={<StreamPills cls={cls} subject={act.subject} />}
    >
      {act.deadline && (
        <div style={{ fontSize: 12, color: overdue ? 'var(--red)' : 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> Due: {formatDate(act.deadline)}{overdue && <span style={{ fontWeight: 600 }}> · Overdue</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {submitted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#10b981', fontWeight: 600 }}><CheckCircle2 size={14} /> Submitted</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: overdue ? 'var(--red)' : 'var(--yellow)', fontWeight: 600 }}><AlertCircle size={14} /> {overdue ? 'Missed' : 'Not yet submitted'}</div>
        )}
        {graded && <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6366f1', fontWeight: 600 }}><Award size={14} /> Score: {sub.score}{totalRubric > 0 ? `/${totalRubric}` : ''}</div>}
      </div>
      {sub?.feedback && <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, fontStyle: 'italic' }}>"{sub.feedback}"</div>}
    </PostShell>
  )
}

function QuizCard({ item, classObj, student }) {
  const { messageProfessorAboutPost } = useUI()
  const quiz = item.data
  const now = Date.now()
  const isOpen = now >= quiz.openAt && now <= quiz.closeAt
  const isClosed = now > quiz.closeAt
  const totalQ = (quiz.questions || []).length
  const sub = quiz.submissions?.[student?.id]
  const taken = !!sub
  const subTotal = sub ? (sub.total ?? quiz.totalPoints ?? totalQ) : 0
  const cls = classLabel(classObj)
  const onAsk = student ? () => messageProfessorAboutPost({
    id: quiz.id, type: 'quiz', title: (quiz.title || 'Quiz').slice(0, 80),
    classLabel: cls || 'Class', classId: classObj?.id || quiz.classIds?.[0] || null, thumb: null,
  }) : null
  return (
    <PostShell
      type="quiz"
      time={timeAgo(quiz.openAt)}
      dateLabel={`${dateKicker(quiz.openAt)}${totalQ ? ` · ${totalQ} QUESTION${totalQ !== 1 ? 'S' : ''}` : ''}`}
      title={quiz.title}
      onAskProfessor={onAsk}
      pills={<StreamPills cls={cls} subject={quiz.subject} />}
      badges={isOpen
        ? <span style={{ fontSize: 10, background: '#dcfce7', color: '#166534', fontWeight: 700, padding: '1px 7px', borderRadius: 20, flexShrink: 0 }}>OPEN</span>
        : isClosed ? <span style={{ fontSize: 10, background: '#fee2e2', color: '#991b1b', fontWeight: 700, padding: '1px 7px', borderRadius: 20, flexShrink: 0 }}>CLOSED</span> : null}
    >
      <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
        {quiz.openAt && <span><Clock size={11} style={{ display: 'inline', marginRight: 3 }} />Opens: {formatDate(quiz.openAt)}</span>}
        {quiz.closeAt && <span style={{ marginLeft: 12 }}>Closes: {formatDate(quiz.closeAt)}</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {taken ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#10b981', fontWeight: 600 }}><CheckCircle2 size={14} /> Completed{sub.score != null && <span> · {sub.score}/{subTotal}</span>}</div>
        ) : isOpen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--yellow)', fontWeight: 600 }}><AlertCircle size={14} /> Not yet taken</div>
        ) : isClosed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--red)', fontWeight: 600 }}><XCircle size={14} /> Missed</div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Not yet open</div>
        )}
      </div>
    </PostShell>
  )
}

function GradeCard({ item, classObj, student }) {
  const { messageProfessorAboutPost } = useUI()
  const { subject, gradeData, uploadedAt } = item.data
  const cls = classLabel(classObj)
  const onAsk = student ? () => messageProfessorAboutPost({
    id: `grade-${subject}`, type: 'grade', title: `Grade · ${subject}`,
    classLabel: cls || 'Class', classId: classObj?.id || null, thumb: null,
  }) : null
  return (
    <PostShell
      type="grade"
      name="Grade update"
      time={timeAgo(uploadedAt)}
      dateLabel="GRADE POSTED"
      title={subject}
      onAskProfessor={onAsk}
      pills={<StreamPills cls={cls} subject={null} />}
    >
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {gradeData.midterm != null && <span style={{ fontSize: 13 }}>Midterm: <strong>{gradeData.midterm?.toFixed(1)}</strong></span>}
        {gradeData.finals != null && <span style={{ fontSize: 13 }}>Finals: <strong>{gradeData.finals?.toFixed(1)}</strong></span>}
        {gradeData.finalGrade != null && <span style={{ fontSize: 13, color: 'var(--ink)' }}>Final Grade: <strong style={{ color: '#10b981' }}>{gradeData.finalGrade?.toFixed(1)}</strong></span>}
      </div>
    </PostShell>
  )
}

function AttendanceCard({ item, classObj, student }) {
  const { messageProfessorAboutPost } = useUI()
  const { subject, date, present } = item.data
  const cls = classLabel(classObj)
  const onAsk = student ? () => messageProfessorAboutPost({
    id: `att-${subject}-${date}`, type: 'attendance', title: `Attendance · ${date}`,
    classLabel: cls || 'Class', classId: classObj?.id || null, thumb: null,
  }) : null
  return (
    <PostShell
      type="attendance"
      name="Attendance"
      time={dayLabel(item.ts)}
      dateLabel={dateKicker(item.ts)}
      title={`${subject || 'Attendance'}${cls ? ` · ${cls}` : ''}`}
      onAskProfessor={onAsk}
      pills={<StreamPills cls={null} subject={subject} />}
    >
      {present ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#10b981', fontWeight: 600 }}><CheckCircle2 size={14} /> Present</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--red)', fontWeight: 600 }}><XCircle size={14} /> Absent</div>
      )}
    </PostShell>
  )
}

export default function StreamTab({ student, viewClassId, classes }) {
  const { activities, quizzes, announcements, fbReady, semester, admin } = useData()
  const { pendingStreamAnnId, clearPendingStreamAnn } = useUI()
  const author = useMemo(() => ({ name: admin?.name || 'Professor', photo: admin?.photo || null }), [admin?.name, admin?.photo])
  const [filterType, setFilterType] = useState('all')
  const [filterSubject, setFilterSubject] = useState('all')
  const [highlightId, setHighlightId] = useState(null)

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
        if (!annReaches(ann, effectiveClassIds)) return
        // Hide scheduled announcements until their publish time.
        if (ann.publishAt && ann.publishAt > nowTs) return
        const annPinned = !!ann.pinned && !(ann.expiresAt && ann.expiresAt < nowTs)
        // Show the viewer's OWN matching class in the header (a multi-class post
        // may list a class the student isn't in as its first target).
        const targets = annClassIds(ann)
        const mine = targets.find(id => effectiveClassIds.includes(id)) || ann.classId
        items.push({ id: `ann-${ann.id}`, type: 'announcement', ts: ann.createdAt || 0, data: ann, classId: mine, pinned: annPinned })
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
        if (quiz.status === 'draft') return
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
            // Parse the YYYY-MM-DD attendance date as LOCAL midnight, not UTC, so
            // the stream timestamp lands on the correct day in the viewer's zone.
            const dateMs = new Date(date + 'T00:00:00').getTime()
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

  // Infinite scroll: render a growing window instead of a fixed page. Resets to
  // the top whenever the filters change.
  const { visibleCount, sentinelRef, hasMore, ensureVisible } = useInfiniteFeed(
    streamItems.length,
    { resetKey: `${filterType}|${filterSubject}|${effectiveClassIds.join(',')}` }
  )

  function getClassObj(item) {
    return classes.find(c => c.id === item.classId) || null
  }

  // Deep-link from the dashboard's saved-announcements widget: page to the post
  // and mark it for highlight. Clearing the pending id here is safe because the
  // scroll/glow run in a separate effect keyed on highlightId (so clearing the
  // pending id can't cancel them).
  useEffect(() => {
    if (!pendingStreamAnnId) return
    // Announcements only appear in the list when the type filter includes them.
    if (filterType !== 'all' && filterType !== 'announcement') { setFilterType('all'); return }
    const idx = streamItems.findIndex(it => it.type === 'announcement' && it.data.id === pendingStreamAnnId)
    if (idx < 0) return // wait for the class switch / data to land
    ensureVisible(idx) // grow the window so the target post is rendered
    setHighlightId(pendingStreamAnnId)
    clearPendingStreamAnn()
  }, [pendingStreamAnnId, streamItems, filterType, clearPendingStreamAnn, ensureVisible])

  // Once a post is highlighted, scroll it into view after the page renders, and
  // clear the glow after a moment. Keyed on highlightId so it isn't torn down by
  // unrelated re-renders.
  useEffect(() => {
    if (!highlightId) return
    const targetId = `annpost-${highlightId}`
    const scrollT = setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 160)
    const glowT = setTimeout(() => setHighlightId(null), 2600)
    return () => { clearTimeout(scrollT); clearTimeout(glowT) }
  }, [highlightId])

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
          <button key={k} className={`s-pill${filterType === k ? ' active' : ''}`} onClick={() => setFilterType(k)}>{label}</button>
        ))}
      </div>
      {subjectOptions.length > 1 && (
        <select
          className="form-input"
          style={{ fontSize: 13, maxWidth: 220 }}
          value={filterSubject}
          onChange={e => setFilterSubject(e.target.value)}
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

      {streamItems.slice(0, visibleCount).map((item, idx, arr) => {
        const classObj = getClassObj(item)
        const label = item.pinned ? 'Pinned' : getGroupLabel(item.ts)
        const prevLabel = idx > 0 ? (arr[idx - 1].pinned ? 'Pinned' : getGroupLabel(arr[idx - 1].ts)) : null
        const showGroup = label !== prevLabel
        return (
          <React.Fragment key={item.id}>
            {showGroup && <div className="s-feed-day">{label}</div>}
            <div className="feed-reveal">
              {item.type === 'announcement' && <AnnouncementCard item={item} classObj={classObj} classPills={announcementClassPills(item.data, classes, effectiveClassIds)} student={student} author={author} highlight={highlightId === item.data.id} />}
              {item.type === 'activity' && <ActivityCard item={item} classObj={classObj} student={student} />}
              {item.type === 'quiz' && <QuizCard item={item} classObj={classObj} student={student} />}
              {item.type === 'grade' && <GradeCard item={item} classObj={classObj} student={student} />}
              {item.type === 'attendance' && <AttendanceCard item={item} classObj={classObj} student={student} />}
            </div>
          </React.Fragment>
        )
      })}

      {hasMore && (
        <div ref={sentinelRef} className="feed-sentinel">
          <span className="feed-spinner" aria-hidden="true" />
          <span>Loading more posts…</span>
        </div>
      )}
      {!hasMore && streamItems.length > 0 && (
        <div className="feed-end"><CheckCircle2 size={14} /> You’re all caught up</div>
      )}
    </div>
  )
}
