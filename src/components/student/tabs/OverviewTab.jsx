import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  gradeInfo, combineEquiv, getGWA, getAttRate, computeFinalGradeFromTerms,
} from '@/utils/grades'
import { useData } from '@/context/DataContext'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { BookOpen, Clock, CalendarOff, Video, Link, X, MessageSquare, CornerDownRight, Send } from 'lucide-react'

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
  const { addAnnouncementComment, addCommentReply } = useData()
  const comments = ann.comments || []

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
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: c.role === 'teacher' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              color: c.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
            }}>
              {c.authorName?.charAt(0)?.toUpperCase() || '?'}
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
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: r.role === 'teacher' ? 'rgba(59,130,246,0.15)' : 'rgba(168,85,247,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    color: r.role === 'teacher' ? 'var(--accent)' : 'var(--purple)',
                  }}>
                    {r.authorName?.charAt(0)?.toUpperCase() || '?'}
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
              <input
                ref={replyRef}
                className="form-input"
                style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                placeholder={`Reply to ${c.authorName}…`}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(c.id, c.authorName) } }}
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
        <input
          className="form-input"
          style={{ flex: 1, fontSize: 13, padding: '7px 10px' }}
          placeholder="Write a comment…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost() } }}
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
          <div className="ann-message" dangerouslySetInnerHTML={{ __html: ann.message }} />
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
  if (type === 'online_class')   return 'rgba(59,130,246,0.1)'
  if (type === 'meeting_topics') return 'var(--purple-l)'
  return 'rgba(59,130,246,0.1)'
}
function annBorderColor(type) {
  if (type === 'no_class')       return 'rgba(234,179,8,0.3)'
  if (type === 'online_class')   return 'rgba(59,130,246,0.3)'
  if (type === 'meeting_topics') return 'var(--purple)'
  return 'rgba(59,130,246,0.3)'
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
  const { activities, students, eqScale, announcements } = useData()

  const [viewAnn, setViewAnn] = useState(null)

  // Toggle state per subject: 'equiv' | 'pct'
  const [toggleMap, setToggleMap] = useState({})
  function toggleCell(sub, field) {
    setToggleMap(m => ({ ...m, [`${sub}-${field}`]: m[`${sub}-${field}`] === 'pct' ? 'equiv' : 'pct' }))
  }

  const enrolledIds = useMemo(() =>
    s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : []),
    [s]
  )

  const activeAnnouncements = useMemo(() => {
    const now = Date.now()
    return (announcements || []).filter(ann =>
      ann.active &&
      (ann.classId === 'all' || enrolledIds.includes(ann.classId)) &&
      (!ann.expiresAt || ann.expiresAt > now)
    ).sort((a, b) => b.createdAt - a.createdAt)
  }, [announcements, enrolledIds])

  const allEnrolledSubs = useMemo(() => {
    if (enrolledIds.length) {
      return [...new Set(enrolledIds.flatMap(id => classes.find(c => c.id === id)?.subjects || []))]
    }
    return Object.keys(s.grades || {})
  }, [enrolledIds, classes, s])

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
    if (gwa >= 90) { statusText = 'Excellent'; statusColor = 'var(--green)'; statusSub = "Dean's Lister candidate" }
    else if (gwa >= 85) { statusText = 'Good Standing'; statusColor = 'var(--green)'; statusSub = 'Passing' }
    else if (gwa >= 75) { statusText = 'Passing'; statusColor = 'var(--yellow)'; statusSub = 'Needs improvement' }
    else { statusText = 'At Risk'; statusColor = 'var(--red)'; statusSub = 'Below passing threshold' }
  }

  // Subjects to display
  const viewCls = classes.find(c => c.id === viewClassId)
  let subs = viewCls ? viewCls.subjects : allEnrolledSubs
  if (!subs.length) {
    subs = [...new Set([
      ...Object.keys(s.grades || {}),
      ...Object.keys(s.gradeComponents || {}),
      ...Object.keys(s.attendance || {}),
    ])]
  }

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
              onClick={() => setViewAnn(ann)}
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
                  <div className="ann-message ann-message--preview" style={{ fontSize: 12, marginTop: 2 }} dangerouslySetInnerHTML={{ __html: ann.message }} />
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

      {/* Stat cards */}
      <div className="s-stat-row">
        <div className="s-stat-card">
          <div className="s-stat-label">GWA</div>
          <div className={`s-val ${gwaClass}`}>{gwa !== null ? gwa.toFixed(2) : '—'}</div>
        </div>
        <div className="s-stat-card">
          <div className="s-stat-label">Attendance</div>
          <div className={`s-val ${attClass}`}>{rate !== null ? rate.toFixed(1) + '%' : '—'}</div>
        </div>
        <div className="s-stat-card">
          <div className="s-stat-label">Status</div>
          <div className="s-val" style={{ color: statusColor, fontSize: 16 }}>{statusText}</div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{statusSub}</div>
        </div>
      </div>

      {/* Grade color legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Legend:</span>
        {[
          { color: 'var(--green)',  label: 'Good (≥85% / ≥90% att)' },
          { color: 'var(--yellow)', label: 'Fair (75–84% / 80–89% att)' },
          { color: 'var(--red)',    label: 'At Risk (<75% / <80% att)' },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {label}
          </span>
        ))}
      </div>

      {/* Grade table */}
      <div className="sec-hdr mt-4 mb-2">
        <div className="sec-title">Subjects</div>
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>Click midterm/finals to toggle equiv ↔ %</span>
      </div>

      {!subs.length ? (
        <div className="empty"><div className="empty-icon"><BookOpen size={40} /></div>No subjects enrolled yet.</div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left p-3 font-semibold text-ink2">Subject</th>
                <th className="text-center p-3 font-semibold text-ink2">Activities</th>
                <th className="text-center p-3 font-semibold text-ink2">Quizzes</th>
                <th className="text-center p-3 font-semibold text-ink2">Midterm</th>
                <th className="text-center p-3 font-semibold text-ink2">Finals</th>
                <th className="text-center p-3 font-semibold text-ink2">Final %</th>
                <th className="text-center p-3 font-semibold text-ink2">Equiv</th>
                <th className="text-center p-3 font-semibold text-ink2">Remark</th>
              </tr>
            </thead>
            <tbody>
              {subs.map(sub => (
                <SubjectRow
                  key={sub}
                  sub={sub}
                  student={s}
                  classes={classes}
                  activities={activities}
                  eqScale={eqScale}
                  toggleMap={toggleMap}
                  onToggle={toggleCell}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewAnn && (
        <AnnouncementDetailModal
          ann={announcements.find(a => a.id === viewAnn.id) || viewAnn}
          student={s}
          onClose={() => setViewAnn(null)}
        />
      )}
    </div>
  )
}

function SubjectRow({ sub, student: s, classes, activities, eqScale, toggleMap, onToggle }) {
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

  // Quiz cells
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
  } else if (Array.isArray(comp.quizzes) && comp.quizzes.length) {
    qzContent = comp.quizzes.map((q, i) => {
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

  // Toggle cells
  const midToggle = toggleMap[`${sub}-mid`] || 'equiv'
  const finToggle = toggleMap[`${sub}-fin`] || 'equiv'
  const { eq: midEq } = gradeInfo(midG, eqScale)
  const { eq: finEq } = gradeInfo(finG, eqScale)
  const midColor = midG != null ? (midG >= 75 ? 'var(--green)' : midG >= 60 ? 'var(--yellow)' : 'var(--red)') : 'var(--ink3)'
  const finColor = finG != null ? (finG >= 75 ? 'var(--green)' : finG >= 60 ? 'var(--yellow)' : 'var(--red)') : 'var(--ink3)'

  const midCell = midG != null
    ? <span className="s-grade-toggle" onClick={() => onToggle(sub, 'mid')} style={{ fontWeight: 700, color: midColor, cursor: 'pointer' }} title="Click to toggle equiv / %">
        {midToggle === 'equiv' ? midEq : `${midG.toFixed(1)}%`}
      </span>
    : '—'

  const finCell = finG != null
    ? <span className="s-grade-toggle" onClick={() => onToggle(sub, 'fin')} style={{ fontWeight: 700, color: finColor, cursor: 'pointer' }} title="Click to toggle equiv / %">
        {finToggle === 'equiv' ? finEq : `${finG.toFixed(1)}%`}
      </span>
    : <span style={{ color: 'var(--ink3)', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />Pending</span>

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

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td className="p-3"><strong>{sub}</strong></td>
      <td className="p-3 text-center">{actContent}</td>
      <td className="p-3 text-center">{qzContent}</td>
      <td className="p-3 text-center" style={{ whiteSpace: 'nowrap' }}>{midCell}</td>
      <td className="p-3 text-center" style={{ whiteSpace: 'nowrap' }}>{finCell}</td>
      <td className="p-3 text-center">{g != null ? parseFloat(g.toFixed(2)) + '%' : '—'}</td>
      <td className="p-3 text-center" style={{ fontWeight: 700 }}>{eq}</td>
      <td className="p-3 text-center">{remarkBadge}</td>
    </tr>
  )
}
