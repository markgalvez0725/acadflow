import React, { useState, useMemo } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Pagination from '@/components/primitives/Pagination'
import { ClipboardList } from 'lucide-react'

const PER_PAGE = 10

function timeLeft(dueAt) {
  const diff = dueAt - Date.now()
  if (diff <= 0) return null
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

async function pushAdminNotif(db, s, text, type, link) {
  try {
    const { getDoc, setDoc, doc: fbDoc } = await import('firebase/firestore')
    const ref = fbDoc(db, 'notifications', 'admin')
    const snap = await getDoc(ref)
    const existing = snap.exists() ? (snap.data().items || []) : []
    const notif = {
      id: 'n' + Date.now() + Math.random().toString(36).slice(2, 5),
      type, read: false, ts: Date.now(),
      title: text,
      body: s.name || s.id,
      link: link || 'activities',
    }
    await setDoc(ref, { items: [notif, ...existing].slice(0, 200) }, { merge: false })
  } catch (e) {}
}

export default function ActivitiesTab({ student: s, viewClassId, activities }) {
  const { db, fbReady } = useData()
  const { toast } = useUI()

  const [page, setPage] = useState(1)
  const [linkInputs, setLinkInputs] = useState({}) // actId → string
  const [submitting, setSubmitting] = useState({})  // actId → bool

  const classId = viewClassId || s.classId

  const items = useMemo(() =>
    activities
      .filter(a => a.classId === classId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [activities, classId]
  )

  const slice = items.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  async function submitActivity(actId) {
    const link = (linkInputs[actId] || '').trim()
    if (!link) { toast('Please enter a submission link.', 'warn'); return }
    if (!/^https?:\/\/.+/.test(link)) { toast('Please enter a valid URL starting with http:// or https://', 'warn'); return }
    if (!fbReady || !db.current) { toast('Activities require Firebase to be connected.', 'warn'); return }
    setSubmitting(prev => ({ ...prev, [actId]: true }))
    try {
      const sidPath = `submissions.${s.id}`
      await updateDoc(doc(db.current, 'activities', actId), {
        [`${sidPath}.link`]: link,
        [`${sidPath}.submittedAt`]: Date.now(),
      })
      setLinkInputs(prev => ({ ...prev, [actId]: '' }))
      const act = activities.find(a => a.id === actId)
      await pushAdminNotif(
        db.current, s,
        `Submitted: ${act?.title || actId}`,
        'act_sub',
        'act:' + actId
      )
      toast('Submission sent!', 'success')
    } catch (e) {
      toast('Failed to submit: ' + e.message, 'error')
    } finally {
      setSubmitting(prev => ({ ...prev, [actId]: false }))
    }
  }

  if (!items.length) {
    return (
      <div className="empty">
        <div className="empty-icon"><ClipboardList size={40} /></div>
        No activities yet. Check back later.
      </div>
    )
  }

  return (
    <div className="student-activities">
      <div className="sec-hdr mb-3">
        <div className="sec-title">Activities</div>
      </div>

      <div className="sa-act-list">
        {slice.map(act => {
          const sub = (act.submissions || {})[s.id] || {}
          const hasLink  = !!sub.link
          const score    = sub.score ?? null
          const isPast   = act.deadline ? Date.now() > act.deadline : false
          const tl       = act.deadline ? timeLeft(act.deadline) : null
          const maxScore = act.maxScore || 100
          const hasRubric = !!(act.rubric?.length)

          // Status badge
          let badgeCls = 'badge-gray'
          let badgeLabel = 'Open'
          if (score != null) {
            badgeCls = score / maxScore >= 0.75 ? 'badge-green' : score / maxScore >= 0.6 ? 'badge-yellow' : 'badge-red'
            badgeLabel = `Graded: ${score}/${maxScore}`
          } else if (hasLink) {
            badgeCls = 'badge-blue'
            badgeLabel = 'Submitted'
          } else if (isPast) {
            badgeCls = 'badge-red'
            badgeLabel = 'Missed'
          } else if (tl) {
            badgeCls = 'badge-yellow'
            badgeLabel = tl
          }

          return (
            <div key={act.id} className="sa-act-card">
              <div className="sa-act-header">
                <div className="sa-act-title">{act.title}</div>
                <span className={`badge ${badgeCls}`}>{badgeLabel}</span>
              </div>

              {act.subject && (
                <div className="sa-act-meta">{act.subject}</div>
              )}

              {act.instructions && (
                <div className="sa-act-desc">{act.instructions}</div>
              )}

              {act.deadline && (
                <div className="sa-act-due">
                  Due: {new Date(act.deadline).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              )}

              {/* Rubric criteria */}
              {hasRubric && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4 }}>Grading Rubric</div>
                  <div className="flex flex-wrap gap-1">
                    {act.rubric.map(c => {
                      const met = sub.rubricChecks?.[c.id]
                      return (
                        <span
                          key={c.id}
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 4,
                            border: '1px solid var(--border)',
                            background: met ? 'var(--green-l)' : 'var(--surface2)',
                            color: met ? 'var(--green)' : 'var(--ink3)',
                          }}
                        >
                          {met ? '✓' : '○'} {c.name} ({c.points}pt{c.points !== 1 ? 's' : ''})
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Submit area */}
              {score != null ? (
                <div className="sa-act-graded">
                  <div style={{ fontWeight: 700, color: score / maxScore >= 0.75 ? 'var(--green)' : score / maxScore >= 0.6 ? 'var(--yellow)' : 'var(--red)', fontSize: 18 }}>
                    {score}/{maxScore}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Grade received</div>
                  {sub.link && (
                    <a href={sub.link} target="_blank" rel="noreferrer" className="sa-act-link">View submission ↗</a>
                  )}
                </div>
              ) : hasLink ? (
                <div className="sa-act-submitted">
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>Submitted — awaiting grade</div>
                  <a href={sub.link} target="_blank" rel="noreferrer" className="sa-act-link">View your submission ↗</a>
                </div>
              ) : isPast ? (
                <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>This activity has passed without a submission.</div>
              ) : (
                <div className="sa-act-submit-form">
                  <input
                    className="input"
                    placeholder="Paste your submission link (https://…)"
                    value={linkInputs[act.id] || ''}
                    onChange={e => setLinkInputs(prev => ({ ...prev, [act.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') submitActivity(act.id) }}
                  />
                  <button
                    className="btn btn-primary btn-sm mt-2"
                    onClick={() => submitActivity(act.id)}
                    disabled={submitting[act.id] || !(linkInputs[act.id] || '').trim()}
                  >
                    {submitting[act.id] ? 'Submitting…' : 'Submit →'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Pagination total={items.length} perPage={PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}
