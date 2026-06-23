import React, { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react'
import {
  gradeInfo, combineEquiv, getGWA, getAttRate, computeFinalGradeFromTerms,
} from '@/utils/grades'
import { computeSemesterWrapped } from '@/utils/semesterWrapped'
import { useData } from '@/context/DataContext'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { BookOpen, Clock, CalendarOff, Video, Link, X, MessageSquare, CornerDownRight, Send, BarChart3, ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { SkeletonDashboard } from '@/components/primitives/SkeletonLoader'
import { useUI } from '@/context/UIContext'
import PageHeader from '@/components/ds/PageHeader'
import MetricCard from '@/components/ds/MetricCard'
import { Home, CalendarCheck, Award, ClipboardList, FileQuestion, Radio } from 'lucide-react'
import { pendingItems, humanLeft } from '@/utils/reminders'
import BarChart from '@/components/charts/BarChart'
import SmartInsights from '@/components/primitives/SmartInsights'
import { generateStudentInsights } from '@/utils/insights'
import { buildStudentReportCard } from '@/export/reportCard'
import { FileDown } from 'lucide-react'
import { activeClassIds, activeSubjects } from '@/utils/active'
import { deadlineColor } from '@/utils/deadlines'
import MentionInput from '@/components/primitives/MentionInput'
import { resolveMentions } from '@/utils/mentions'
import { notifyMention } from '@/firebase/messageNotify'
import DOMPurify from 'dompurify'

const SemesterWrapped = lazy(() => import('@/components/student/modals/SemesterWrapped'))

// Defense-in-depth: announcement HTML is sanitized on save, but sanitize again
// at render in case a record was written directly to the database.
const ANN_SANITIZE = {
  ALLOWED_TAGS: ['b', 'i', 'u', 'em', 'strong', 'mark', 'p', 'br', 'ul', 'ol', 'li', 'h3', 'h4', 'a', 'pre', 'code', 'font', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'size', 'colspan', 'rowspan'],
}
function sanitizeAnn(html) {
  return DOMPurify.sanitize(html || '', ANN_SANITIZE)
}

function formatAnnDate(ms) {
  if (!ms) return null
  return new Date(ms).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function AnnTypeBadge({ type }) {
  const map = {
    no_class:       { label: 'No Class Today',  cls: 'badge-yellow' },
    online_class:   { label: 'Online Class',     cls: 'badge-blue'   },
    meeting_topics: { label: 'Meeting Topics',   cls: 'badge-purple' },
  }
  const { label, cls } = map[type] || { label: type, cls: 'badge-gray' }
  return <span className={`badge ${cls}`}>{label}</span>
}

function StudentCommentsSection({ ann, student }) {
  const { addAnnouncementComment, addCommentReply, students, db } = useData()
  const comments = ann.comments || []

  // Who can be @mentioned: classmates in this announcement's scope + the teacher.
  const mentionCandidates = useMemo(() => {
    const enrolled = student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : [])
    const scopeIds = ann.classId && ann.classId !== 'all' ? [ann.classId] : enrolled
    const mates = (students || []).filter(x =>
      x.id !== student.id &&
      ((x.classIds || []).some(id => scopeIds.includes(id)) || scopeIds.includes(x.classId))
    )
    const list = mates.map(x => ({ id: x.id, name: x.name || x.id }))
    list.push({ id: 'admin', name: 'Teacher' })
    return list
  }, [students, ann.classId, student])

  function fireMentions(body) {
    const ids = resolveMentions(body, mentionCandidates).filter(id => id !== student.id)
    if (!ids.length || !db?.current) return
    ids.forEach(id => notifyMention(db.current, id, {
      fromName: student.name || 'A classmate',
      snippet: body,
      link: 'stream',
    }))
  }

  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [replyPosting, setReplyPosting] = useState(false)
  const replyRef = useRef(null)

  useEffect(() => {
    if (replyTo && replyRef.current) replyRef.current.focus()
  }, [replyTo])

  async function handlePost() {
    if (!text.trim()) return
    setPosting(true)
    try {
      const comment = {
        id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5),
        authorId: student.id,
        authorName: student.name || 'Student',
        role: 'student',
        text: text.trim(),
        createdAt: Date.now(),
        replies: [],
      }
      await addAnnouncementComment(ann.id, comment)
      fireMentions(comment.text)
      setText('')
    } finally {
      setPosting(false)
    }
  }

  async function handleReply(commentId, commentAuthorName) {
    if (!replyText.trim()) return
    setReplyPosting(true)
    try {
      const reply = {
        id: 'r' + Date.now() + Math.random().toString(36).slice(2, 5),
        authorId: student.id,
        authorName: student.name || 'Student',
        role: 'student',
        text: replyText.trim(),
        createdAt: Date.now(),
      }
      await addCommentReply(ann.id, commentId, reply)
      fireMentions(reply.text)
      setReplyText('')
      setReplyTo(null)
    } finally {
      setReplyPosting(false)
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageSquare size={14} />
        Comments {comments.length > 0 && <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>({comments.length})</span>}
      </div>

      {comments.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 10 }}>No comments yet. Be the first to comment.</div>
      )}

      {comments.map(c => (
        <div key={c.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
              background: c.role === 'teacher' ? 'var(--accent-l)' : 'var(--purple-l)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              color: c.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
            }}>
              {(() => {
                const p = c.role === 'student' && students.find(x => x.id === c.authorId)?.photo
                return p
                  ? <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (c.authorName?.charAt(0)?.toUpperCase() || '?')
              })()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{c.authorName}</span>
                <span style={{ fontSize: 10, color: 'var(--ink3)' }}>
                  {c.role === 'teacher' ? 'Teacher' : 'Student'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 'auto' }}>
                  {new Date(c.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>{c.text}</div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '2px 6px', marginTop: 4, color: 'var(--ink2)' }}
                onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
              >
                <CornerDownRight size={11} style={{ marginRight: 3 }} />
                Reply
              </button>
            </div>
          </div>

          {c.replies?.length > 0 && (
            <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {c.replies.map(r => (
                <div key={r.id} style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                    background: r.role === 'teacher' ? 'var(--accent-l)' : 'var(--purple-l)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: r.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
                  }}>
                    {(() => {
                      const p = r.role === 'student' && students.find(x => x.id === r.authorId)?.photo
                      return p
                        ? <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (r.authorName?.charAt(0)?.toUpperCase() || '?')
                    })()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{r.authorName}</span>
                      <span style={{ fontSize: 10, color: 'var(--ink3)' }}>
                        {r.role === 'teacher' ? 'Teacher' : 'Student'}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 'auto' }}>
                        {new Date(r.createdAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink)', marginTop: 2, lineHeight: 1.5 }}>{r.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {replyTo === c.id && (
            <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', gap: 6 }}>
              <MentionInput
                inputRef={replyRef}
                className="form-input"
                style={{ fontSize: 12, padding: '6px 10px' }}
                placeholder={`Reply to ${c.authorName}… (@ to mention)`}
                value={replyText}
                onChange={setReplyText}
                onEnter={() => handleReply(c.id, c.authorName)}
                candidates={mentionCandidates}
                disabled={replyPosting}
              />
              <button
                className="btn btn-primary btn-sm"
                style={{ padding: '6px 10px', flexShrink: 0 }}
                onClick={() => handleReply(c.id, c.authorName)}
                disabled={replyPosting || !replyText.trim()}
              >
                <Send size={12} />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '6px 8px', flexShrink: 0 }}
                onClick={() => { setReplyTo(null); setReplyText('') }}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <MentionInput
          className="form-input"
          style={{ fontSize: 13, padding: '7px 10px' }}
          placeholder="Write a comment… (@ to mention)"
          value={text}
          onChange={setText}
          onEnter={handlePost}
          candidates={mentionCandidates}
          disabled={posting}
        />
        <button
          className="btn btn-primary btn-sm"
          style={{ padding: '7px 12px', flexShrink: 0 }}
          onClick={handlePost}
          disabled={posting || !text.trim()}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}

function AnnouncementDetailModal({ ann, student, onClose }) {
  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader
        title={ann.title}
        onClose={onClose}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Type + class badge row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ color: annIconColor(ann.type) }}>
            <AnnIcon type={ann.type} size={16} />
          </div>
          <AnnTypeBadge type={ann.type} />
        </div>

        {/* Message */}
        {ann.message && (
          <div className="ann-message" dangerouslySetInnerHTML={{ __html: sanitizeAnn(ann.message) }} />
        )}

        {/* Topics */}
        {ann.type === 'meeting_topics' && ann.topics?.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 6 }}>Topics Covered</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--ink)', lineHeight: 2 }}>
              {ann.topics.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>
        )}

        {/* Links */}
        {(ann.meetingLink || ann.moduleLink) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ann.meetingLink && (
              <a
                href={ann.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                style={{ alignSelf: 'flex-start', textDecoration: 'none', fontSize: 13 }}
              >
                <Video size={14} style={{ marginRight: 6 }} />
                Join Meeting
              </a>
            )}
            {ann.moduleLink && (
              <a
                href={ann.moduleLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start', textDecoration: 'none', fontSize: 13, color: 'var(--green)' }}
              >
                <Link size={14} style={{ marginRight: 6 }} />
                View Module
              </a>
            )}
          </div>
        )}

        {/* Dates */}
        <div style={{ fontSize: 11, color: 'var(--ink3)', display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          {ann.createdAt && <span>Posted: {formatAnnDate(ann.createdAt)}</span>}
          {ann.expiresAt && <span>Expires: {formatAnnDate(ann.expiresAt)}</span>}
        </div>

        {/* Comments */}
        <StudentCommentsSection ann={ann} student={student} />
      </div>
    </Modal>
  )
}

function annBgColor(type) {
  if (type === 'no_class')       return 'rgba(234,179,8,0.1)'
  if (type === 'online_class')   return 'var(--accent-l)'
  if (type === 'meeting_topics') return 'var(--purple-l)'
  return 'var(--accent-l)'
}
function annBorderColor(type) {
  if (type === 'no_class')       return 'rgba(234,179,8,0.3)'
  if (type === 'online_class')   return 'color-mix(in srgb, var(--accent) 30%, transparent)'
  if (type === 'meeting_topics') return 'var(--purple)'
  return 'color-mix(in srgb, var(--accent) 30%, transparent)'
}
function annIconColor(type) {
  if (type === 'no_class')       return 'var(--yellow)'
  if (type === 'online_class')   return 'var(--accent)'
  if (type === 'meeting_topics') return 'var(--purple)'
  return 'var(--accent)'
}
function AnnIcon({ type, size = 18 }) {
  if (type === 'no_class')       return <CalendarOff size={size} />
  if (type === 'online_class')   return <Video size={size} />
  if (type === 'meeting_topics') return <BookOpen size={size} />
  return <Video size={size} />
}

export default function OverviewTab({ student: s, viewClassId, classes }) {
  const { activities, students, eqScale, announcements, quizzes, semester, fbReady, liveMeetings, meetings } = useData()
  const { setStudentTab, toast } = useUI()

  const [viewAnn, setViewAnn] = useState(null)
  const [chartsOpen, setChartsOpen] = useState(false)
  const [wrappedOpen, setWrappedOpen] = useState(false)

  // "Semester in Review" — a derived, story-style recap of this student's term.
  const wrapped = useMemo(
    () => computeSemesterWrapped(s, { classes, students, activities, quizzes, semester }),
    [s, classes, students, activities, quizzes, semester]
  )

  // Only current, non-archived classes count — archived/ended/past subjects drop off.
  const enrolledIds = useMemo(() => activeClassIds(s, classes, semester), [s, classes, semester])

  const activeAnnouncements = useMemo(() => {
    const now = Date.now()
    return (announcements || []).filter(ann =>
      ann.active &&
      (ann.classId === 'all' || enrolledIds.includes(ann.classId)) &&
      (!ann.publishAt || ann.publishAt <= now) &&
      (!ann.expiresAt || ann.expiresAt > now)
    ).sort((a, b) => b.createdAt - a.createdAt)
  }, [announcements, enrolledIds])

  const allEnrolledSubs = useMemo(
    () => activeSubjects(s, classes, semester),
    [s, classes, semester]
  )

  const gwa = useMemo(() => getGWA(s, classes), [s, classes])
  const rate = useMemo(() => getAttRate(s, students, classes), [s, students, classes])

  const hasCompleteGrades = allEnrolledSubs.some(sub => {
    const comp = s.gradeComponents?.[sub] || {}
    return comp.midterm != null && comp.finals != null
  })
  const hasAnyAtt = allEnrolledSubs.some(sub => {
    const a = s.attendance?.[sub] || new Set()
    const e = s.excuse?.[sub] || new Set()
    return a.size > 0 || e.size > 0
  })

  // GWA color class
  const gwaClass = gwa === null ? '' : !hasCompleteGrades ? 'warn' : gwa >= 85 ? 'good' : gwa >= 75 ? 'warn' : 'bad'
  const attClass = rate === null || !hasAnyAtt ? '' : rate >= 90 ? 'good' : rate >= 80 ? 'warn' : 'bad'

  // Status
  let statusText = 'Pending'
  let statusColor = 'var(--ink2)'
  let statusSub = gwa === null ? 'No grades yet' : 'Grade entry in progress'
  if (gwa !== null && hasCompleteGrades) {
    if (gwa >= 90) { statusText = 'Excellent'; statusColor = 'var(--green)'; statusSub = 'Outstanding standing' }
    else if (gwa >= 85) { statusText = 'Good Standing'; statusColor = 'var(--green)'; statusSub = 'Passing' }
    else if (gwa >= 75) { statusText = 'Passing'; statusColor = 'var(--yellow)'; statusSub = 'Needs improvement' }
    else { statusText = 'At Risk'; statusColor = 'var(--red)'; statusSub = 'Below passing threshold' }
  }

  // Subjects to display — current active classes only (no archived/ended/removed).
  const viewCls = classes.find(c => c.id === viewClassId)
  const subs = viewCls ? (viewCls.subjects || []) : allEnrolledSubs

  // ── Performance analytics (derived from real grade/attendance data) ──────
  const gradeBars = subs.map(sub => {
    const comp = s.gradeComponents?.[sub] || {}
    const val = computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null) ?? s.grades?.[sub] ?? null
    return val != null ? { label: sub, value: parseFloat(val.toFixed(1)) } : null
  }).filter(Boolean)

  const attBars = subs.map(sub => {
    const present = (s.attendance?.[sub]?.size) || 0
    const classIdsForSub = enrolledIds.filter(id => classes.find(c => c.id === id)?.subjects?.includes(sub))
    const mates = students.filter(x => classIdsForSub.some(id => x.classIds?.includes(id) || x.classId === id))
    const held = [...mates, s].reduce((mx, x) =>
      Math.max(mx, ((x.attendance?.[sub]?.size) || 0) + ((x.excuse?.[sub]?.size) || 0)), 0)
    return held ? { label: sub, value: Math.round((present / held) * 100) } : null
  }).filter(Boolean)

  const studentInsights = generateStudentInsights(s, { classes, students, activities, quizzes })

  // Greeting + metric-card derivations
  const hr = new Date().getHours()
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'
  const nm = (s.name || 'Student').trim()
  const greetName = nm.includes(',') ? (nm.split(',')[1].trim().split(/\s+/)[0] || nm) : nm.split(/\s+/)[0]
  const shortStanding = statusText === 'Good Standing' ? 'Good' : statusText
  const pendingCount = activities.filter(a => {
    if (!enrolledIds.includes(a.classId)) return false
    const sub = (a.submissions || {})[s.id]
    if (sub?.link) return false
    if (a.deadline && Date.now() > a.deadline) return false
    return true
  }).length

  // "Coming up" agenda: unsubmitted activities AND quizzes with a due date,
  // merged and sorted soonest-first (overdue floats to the top). This is the
  // student-facing half of the smart-reminder system.
  const nowTs = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const WEEK = 7 * DAY
  const pendingAll = pendingItems({ student: s, classes, activities, quizzes, semester, now: nowTs })
  const upcomingDeadlines = pendingAll
    .filter(it => it.when - nowTs <= WEEK)
    .sort((a, b) => a.when - b.when)
    .slice(0, 6)

  // Live / imminent online classes for the "Live now" banner.
  const liveNow = (liveMeetings || []).filter(m => enrolledIds.includes(m.classId))

  // ── "Today at a glance" — a tappable summary band, the daily landing strip ──
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const t0 = todayStart.getTime(), t1 = t0 + DAY
  const myMeetings = (meetings || []).filter(m => enrolledIds.includes(m.classId))
  const classesTodayCount = myMeetings.filter(m =>
    m.status === 'live' ||
    (m.status !== 'ended' && m.scheduledAt && m.scheduledAt >= t0 && m.scheduledAt < t1)
  ).length
  const dueSoonCount = pendingAll.filter(it => it.when > nowTs && it.when - nowTs <= 2 * DAY).length
  const overdueCount = pendingAll.filter(it => it.when <= nowTs).length
  const openQuizCount = (quizzes || []).filter(q =>
    q.classIds?.some(id => enrolledIds.includes(id)) &&
    nowTs >= q.openAt && nowTs <= q.closeAt && !q.submissions?.[s.id]
  ).length
  const todayChips = [
    { key: 'classes', Icon: Video, color: 'var(--accent)', value: classesTodayCount, label: classesTodayCount === 1 ? 'class today' : 'classes today', tab: 'onlineClasses' },
    overdueCount > 0
      ? { key: 'due', Icon: ClipboardList, color: 'var(--red)', value: overdueCount, label: overdueCount === 1 ? 'overdue task' : 'overdue tasks', tab: 'activities' }
      : { key: 'due', Icon: ClipboardList, color: dueSoonCount ? 'var(--yellow)' : 'var(--green)', value: dueSoonCount, label: 'due in 48h', tab: 'activities' },
    { key: 'quizzes', Icon: FileQuestion, color: openQuizCount ? 'var(--purple)' : 'var(--ink3)', value: openQuizCount, label: openQuizCount === 1 ? 'open quiz' : 'open quizzes', tab: 'quizzes' },
    { key: 'announce', Icon: MessageSquare, color: activeAnnouncements.length ? 'var(--accent)' : 'var(--ink3)', value: activeAnnouncements.length, label: 'announcements', tab: 'stream' },
  ]

  if (!fbReady) return <SkeletonDashboard />

  return (
    <div className="student-overview">
      {/* Announcement banners */}
      {activeAnnouncements.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {/* Announcement legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Announcements:</span>
            {[
              { color: 'var(--yellow)', label: 'No Class' },
              { color: 'var(--accent)', label: 'Online Class' },
              { color: 'var(--purple)', label: 'Meeting Topics' },
            ].map(({ color, label }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                {label}
              </span>
            ))}
          </div>
          {activeAnnouncements.map(ann => (
            <div
              key={ann.id}
              role="button"
              tabIndex={0}
              aria-label={`Open announcement: ${ann.title}`}
              onClick={() => setViewAnn(ann)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewAnn(ann) } }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 10,
                background: annBgColor(ann.type),
                border: `1px solid ${annBorderColor(ann.type)}`,
                cursor: 'pointer',
              }}
            >
              <div style={{ color: annIconColor(ann.type), flexShrink: 0, marginTop: 1 }}>
                <AnnIcon type={ann.type} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: annIconColor(ann.type) }}>
                  {ann.title}
                </div>
                {ann.message && (
                  <div className="ann-message ann-message--preview" style={{ fontSize: 12, marginTop: 2 }} dangerouslySetInnerHTML={{ __html: sanitizeAnn(ann.message) }} />
                )}
                {ann.type === 'meeting_topics' && ann.topics?.length > 0 && (
                  <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--ink2)', lineHeight: 1.8 }}>
                    {ann.topics.map((t, i) => <li key={i}>{t}</li>)}
                  </ol>
                )}
                {ann.type === 'online_class' && ann.meetingLink && (
                  <a
                    href={ann.meetingLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginTop: 4, display: 'inline-block' }}
                  >
                    Join Meeting →
                  </a>
                )}
                {ann.moduleLink && (
                  <a
                    href={ann.moduleLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <Link size={12} /> View Module →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Page header */}
      <PageHeader
        crumb={<><Home size={13} /> Home <span>›</span> Overview</>}
        title={`${greeting}, ${greetName}`}
        subtitle={`${semester?.label || 'Current semester'} · ${allEnrolledSubs.length} subject${allEnrolledSubs.length === 1 ? '' : 's'}`}
        actions={<>
          <button className="btn" onClick={() => buildStudentReportCard(s, { classes, students, eqScale, semester })}><FileDown size={16} /> Report card</button>
          <button className="btn btn-primary" onClick={() => setStudentTab('grades')}><BarChart3 size={16} /> View grades</button>
        </>}
      />

      {/* Today at a glance — tappable summary chips (the daily landing strip) */}
      <div className="today-strip" role="group" aria-label="Today at a glance">
        {todayChips.map(chip => (
          <button
            key={chip.key}
            type="button"
            className="today-chip"
            onClick={() => setStudentTab(chip.tab)}
            aria-label={`${chip.value} ${chip.label}. Open ${chip.tab}.`}
          >
            <span className="today-chip-ic" style={{ color: chip.color }} aria-hidden="true"><chip.Icon size={18} /></span>
            <span className="today-chip-val" style={{ color: chip.value ? 'var(--ink)' : 'var(--ink3)' }}>{chip.value}</span>
            <span className="today-chip-lbl">{chip.label}</span>
          </button>
        ))}
      </div>

      {/* Semester in Review — story-style recap entry */}
      {wrapped.hasData && (
        <button type="button" className="wrapped-entry" onClick={() => setWrappedOpen(true)}>
          <span className="we-ic"><Sparkles size={20} /></span>
          <span style={{ minWidth: 0 }}>
            <span className="we-t" style={{ display: 'block' }}>Your semester, wrapped</span>
            <span className="we-s" style={{ display: 'block' }}>
              {wrapped.persona.title} · tap to see your story
            </span>
          </span>
          <ChevronRight className="we-arrow" size={20} />
        </button>
      )}

      {/* Metric cards */}
      <div className="stat-grid mb-4">
        <MetricCard Icon={BarChart3} color="blue" value={gwa !== null ? gwa.toFixed(1) : '—'} label="Current GWA"
          trend={gwa === null ? null : { dir: gwa >= 85 ? 'up' : gwa >= 75 ? 'flat' : 'down', text: gwa >= 85 ? 'Good' : gwa >= 75 ? 'Passing' : 'At risk' }} />
        <MetricCard Icon={CalendarCheck} color="green" value={rate !== null ? rate.toFixed(0) + '%' : '—'} label="Attendance"
          trend={rate === null ? null : { dir: rate >= 90 ? 'up' : rate >= 80 ? 'flat' : 'down', text: rate >= 90 ? 'On track' : rate >= 80 ? 'Okay' : 'Low' }} />
        <MetricCard Icon={ClipboardList} color="yellow" value={pendingCount} label="Pending tasks"
          trend={pendingCount ? { dir: 'down', text: 'Due soon' } : { dir: 'up', text: 'All done' }} />
        <MetricCard Icon={Award} color="purple" value={shortStanding} label="Standing"
          trend={{ dir: 'flat', text: statusSub }} />
      </div>

      {/* Study Coach — on-device insights, no external AI */}
      <SmartInsights title="Study Coach" insights={studentInsights} />

      {/* Live now — online classes currently in session */}
      {liveNow.length > 0 && (
        <>
          <div className="sec-hdr" style={{ marginTop: 22, marginBottom: 12 }}>
            <div className="sec-title sec-title-ic"><Radio /> Live now</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {liveNow.map(m => (
              <div
                key={m.id}
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%', border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)' }}
              >
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.title || m.className || 'Online class'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
                    {m.subject ? `${m.subject} · ` : ''}In session now
                  </div>
                </div>
                {m.meetLink
                  ? <a href={m.meetLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" style={{ flexShrink: 0, textDecoration: 'none' }}><Video size={14} style={{ marginRight: 5 }} />Join</a>
                  : <button type="button" className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => setStudentTab('onlineClasses')}>View</button>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Coming up — unsubmitted activities AND quizzes, soonest first */}
      {upcomingDeadlines.length > 0 && (
        <>
          <div className="sec-hdr" style={{ marginTop: 22, marginBottom: 12 }}>
            <div className="sec-title sec-title-ic"><Clock /> Coming up</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcomingDeadlines.map(it => {
              const color = deadlineColor(it.when, nowTs)
              const overdue = it.when <= nowTs
              const label = overdue ? 'Overdue' : `Due ${humanLeft(it.when - nowTs)}`
              const Icon = it.kind === 'quiz' ? FileQuestion : ClipboardList
              const kindLabel = it.kind === 'quiz' ? 'Quiz' : 'Activity'
              return (
                <button
                  key={`${it.kind}_${it.id}`}
                  type="button"
                  onClick={() => setStudentTab(it.tab)}
                  className="card"
                  aria-label={`${it.title}${it.subject ? ' — ' + it.subject : ''}, ${label}. Open ${it.tab}.`}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', width: '100%', border: '1px solid var(--border)' }}
                >
                  <span aria-hidden="true" style={{ color, flexShrink: 0, display: 'flex' }}><Icon size={17} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
                      {kindLabel}{it.subject ? ` · ${it.subject}` : ''} · {new Date(it.when).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color, flexShrink: 0 }}>{label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Subjects — one expandable card each (tap to reveal the breakdown) */}
      <div className="sec-hdr" style={{ marginTop: 22, marginBottom: 12 }}>
        <div className="sec-title sec-title-ic"><BookOpen /> Subjects</div>
      </div>

      {!subs.length ? (
        <div className="empty"><div className="empty-icon"><BookOpen size={40} /></div>No active subjects this semester.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {subs.map(sub => (
            <SubjectCard
              key={sub}
              sub={sub}
              student={s}
              classes={classes}
              activities={activities}
              eqScale={eqScale}
            />
          ))}
        </div>
      )}

      {/* Performance charts — collapsed by default */}
      {(gradeBars.length > 0 || attBars.length > 0) && (
        <div className="rounded-xl border border-border bg-surface" style={{ marginTop: 18, overflow: 'hidden' }}>
          <button
            onClick={() => setChartsOpen(o => !o)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '15px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', textAlign: 'left' }}
          >
            <BarChart3 size={18} style={{ color: 'var(--ink2)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>Performance charts</span>
            <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{chartsOpen ? 'Hide' : 'Tap to expand'}</span>
            {chartsOpen ? <ChevronDown size={18} style={{ color: 'var(--ink3)' }} /> : <ChevronRight size={18} style={{ color: 'var(--ink3)' }} />}
          </button>
          {chartsOpen && (
            <div className="grid gap-3 sm:grid-cols-2" style={{ padding: '0 14px 14px' }}>
              {gradeBars.length > 0 && (
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 8 }}>Final grade (%)</div>
                  <BarChart data={gradeBars} maxVal={100} />
                </div>
              )}
              {attBars.length > 0 && (
                <div className="card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 8 }}>Attendance (%)</div>
                  <BarChart data={attBars} maxVal={100} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {viewAnn && (
        <AnnouncementDetailModal
          ann={announcements.find(a => a.id === viewAnn.id) || viewAnn}
          student={s}
          onClose={() => setViewAnn(null)}
        />
      )}

      {wrappedOpen && (
        <Suspense fallback={null}>
          <SemesterWrapped data={wrapped} onClose={() => setWrappedOpen(false)} />
        </Suspense>
      )}

    </div>
  )
}

function SubjectCard({ sub, student: s, classes, activities, eqScale }) {
  const [open, setOpen] = useState(false)
  const comp = s.gradeComponents?.[sub] || {}
  const midG = comp.midterm ?? null
  const finG = comp.finals  ?? null
  const ts   = s.gradeUploadedAt?.[sub]

  const gradeFullyUploaded = midG != null && finG != null && ts
  const derivedFinalPct = computeFinalGradeFromTerms(midG, finG)
  const g = derivedFinalPct ?? s.grades?.[sub] ?? null

  // Activity cells
  let actContent = null
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const panelActs = activities.filter(a => enrolledIds.includes(a.classId) && a.subject === sub)
  const hasGradedActs = panelActs.some(a => (a.submissions || {})[s.id]?.score != null)
  if (hasGradedActs) {
    const scored = panelActs
      .map((a, i) => ({ num: i + 1, score: (a.submissions || {})[s.id]?.score ?? null, max: a.maxScore || 100 }))
      .filter(a => a.score != null)
    actContent = scored.map(a => {
      const pct = Math.round(a.score / a.max * 100)
      const col = pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)'
      return (
        <div key={a.num} style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>A{a.num}:</span>
          <span style={{ color: col, fontWeight: 700 }}>{a.score}{a.max !== 100 ? `/${a.max}` : '%'}</span>
        </div>
      )
    })
  } else if (comp.activityScores && Object.keys(comp.activityScores).length) {
    const isNumbered = Object.keys(comp.activityScores).every(k => /^a\d+$/.test(k))
    const entries = isNumbered
      ? Object.entries(comp.activityScores).sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
      : Object.entries(comp.activityScores).sort(([a], [b]) => a.localeCompare(b))
    actContent = entries.map(([k, val], i) => {
      const num = isNumbered ? parseInt(k.slice(1)) : i + 1
      const col = val >= 75 ? 'var(--green)' : val >= 60 ? 'var(--yellow)' : 'var(--red)'
      return (
        <div key={k} style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>A{num}:</span>
          <span style={{ color: col, fontWeight: 700 }}>{val}%</span>
        </div>
      )
    })
  } else if (comp.activities != null) {
    actContent = <span style={{ fontSize: 12 }}>{comp.activities}%</span>
  } else {
    actContent = '—'
  }

  // Quiz cells — the student's own per-quiz results cache (with legacy fallback)
  const myQuizResults = s.quizResults?.[sub]?.length ? s.quizResults[sub] : (Array.isArray(comp.quizzes) ? comp.quizzes : null)
  let qzContent = null
  if (comp.quizScores && Object.keys(comp.quizScores).length) {
    const qzRaw = Object.entries(comp.quizScores)
    const isNumberedQz = qzRaw.every(([k]) => /^q\d+$/.test(k))
    const sorted = isNumberedQz
      ? qzRaw.sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)))
      : qzRaw.sort(([a], [b]) => String(a).localeCompare(String(b)))
    qzContent = sorted.map(([k, val], i) => {
      const num = isNumberedQz ? parseInt(k.slice(1)) : i + 1
      const col = val >= 75 ? 'var(--green)' : val >= 60 ? 'var(--yellow)' : 'var(--red)'
      return (
        <div key={k} style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>Q{num}:</span>
          <span style={{ color: col, fontWeight: 700 }}>{val}%</span>
        </div>
      )
    })
  } else if (myQuizResults && myQuizResults.length) {
    qzContent = myQuizResults.map((q, i) => {
      const col = q.pct >= 75 ? 'var(--green)' : q.pct >= 60 ? 'var(--yellow)' : 'var(--red)'
      return (
        <div key={q.quizId || i} style={{ fontSize: 11, display: 'flex', gap: 3, alignItems: 'center' }}>
          <span style={{ color: 'var(--ink2)', fontWeight: 600 }}>Q{i + 1}:</span>
          <span style={{ color: col, fontWeight: 700 }}>{q.pct}%</span>
        </div>
      )
    })
  } else if (comp.quizzes != null && !Array.isArray(comp.quizzes)) {
    const qzVal = typeof comp.quizzes === 'object' ? comp.quizzes.pct : comp.quizzes
    qzContent = <span style={{ fontSize: 12 }}>{qzVal}%</span>
  } else {
    qzContent = '—'
  }

  const { eq: midEq } = gradeInfo(midG, eqScale)
  const { eq: finEq } = gradeInfo(finG, eqScale)

  // Final equiv + remark
  let eq, remarkBadge
  if (gradeFullyUploaded) {
    const combined = combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq)
    eq = combined.eq
    const badgeCls = combined.rem === 'Passed' ? 'badge-green' : combined.rem === 'Conditional' ? 'badge-yellow' : combined.rem === 'Failed' ? 'badge-red' : 'badge-gray'
    remarkBadge = <span className={`badge ${badgeCls}`}>{combined.rem}</span>
  } else if (midG != null && finG != null) {
    eq = combineEquiv(gradeInfo(midG, eqScale).eq, gradeInfo(finG, eqScale).eq).eq
    remarkBadge = <span className="badge badge-gray" title="Grades entered but not yet finalized" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>
  } else if (midG != null) {
    eq = gradeInfo(midG, eqScale).eq
    remarkBadge = <span className="badge badge-gray" title="Finals not yet uploaded" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>
  } else {
    eq = '—'
    remarkBadge = <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>
  }

  const dotColor = g == null ? 'var(--ink3)' : g >= 85 ? 'var(--green)' : g >= 75 ? 'var(--yellow)' : 'var(--red)'
  const lbl = { fontSize: 12, color: 'var(--ink2)' }
  const val = { fontSize: 17, fontWeight: 700, marginTop: 2 }
  const eqTag = { fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }

  return (
    <div className="rounded-xl border border-border bg-surface" style={{ overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', textAlign: 'left' }}
      >
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 16, fontWeight: 600, minWidth: 0 }}>{sub}</span>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em' }}>{g != null ? Math.round(g) : '—'}</span>
        {remarkBadge}
        {open ? <ChevronDown size={18} style={{ color: 'var(--ink3)', flexShrink: 0 }} /> : <ChevronRight size={18} style={{ color: 'var(--ink3)', flexShrink: 0 }} />}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <div>
              <div style={lbl}>Activities</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>{actContent}</div>
            </div>
            <div>
              <div style={lbl}>Quizzes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>{qzContent}</div>
            </div>
            <div>
              <div style={lbl}>Midterm</div>
              <div style={val}>{midG != null ? `${midG.toFixed(1)}%` : '—'}{midG != null && <span style={eqTag}> · {midEq}</span>}</div>
            </div>
            <div>
              <div style={lbl}>Finals</div>
              <div style={val}>
                {finG != null
                  ? <>{finG.toFixed(1)}%<span style={eqTag}> · {finEq}</span></>
                  : <span style={{ color: 'var(--ink3)', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={13} />Pending</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 22, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div>
              <div style={lbl}>Final grade</div>
              <div style={val}>{g != null ? parseFloat(g.toFixed(2)) + '%' : '—'}</div>
            </div>
            <div>
              <div style={lbl}>Equivalent</div>
              <div style={val}>{eq}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
