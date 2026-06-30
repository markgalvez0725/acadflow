import React, { useState, useMemo } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import Pagination from '@/components/primitives/Pagination'
import EmptyState from '@/components/ds/EmptyState'
import { ClipboardList, Check, Circle, Users, ShieldCheck, AlertTriangle, Clock, Hourglass, Trophy, CheckCircle2 } from 'lucide-react'
import { SkeletonTable } from '@/components/primitives/SkeletonLoader'
import StandingRing from '@/components/primitives/StandingRing'
import SubmissionFileField from '@/components/student/SubmissionFileField'
import SubmissionPreview from '@/components/primitives/SubmissionPreview'
import StudentMeta from '@/components/primitives/StudentMeta'
import { uploadSubmission } from '@/utils/googleDrive'
import { extractSubmissionText } from '@/utils/submissionExtract'

const PER_PAGE = 10
const SOON_MS = 48 * 3600000 // "due soon" window

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
  const { db, fbReady, students } = useData()
  const { toast } = useUI()

  const [page, setPage] = useState(1)
  const [linkInputs, setLinkInputs] = useState({}) // actId → string
  const [pendingFiles, setPendingFiles] = useState({}) // actId → File (staged, not yet uploaded)
  const [uploadPct, setUploadPct] = useState({})    // actId → number|null (Drive upload progress)
  const [extractPct, setExtractPct] = useState({})  // actId → number|null (on-device text read progress)
  const [submitting, setSubmitting] = useState({})  // actId → bool
  const [editing, setEditing] = useState({})        // actId → bool
  const [groupText, setGroupText] = useState({})    // actId → string (group analysis)
  const [groupLink, setGroupLink] = useState({})    // actId → string (optional link)
  const [filter, setFilter] = useState('all')       // all | open | dueSoon | submitted | graded | missed

  const classId = viewClassId || s.classId
  const idName = useMemo(() => Object.fromEntries((students || []).map(x => [x.id, x.name])), [students])

  const items = useMemo(() =>
    activities
      .filter(a => a.classId === classId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [activities, classId]
  )

  // Per-activity derived standing - computed once, reused by the ring, the
  // Activity Watch validator, the filter counts, and each card. Because every
  // surface reads the SAME object, the validator can never disagree with a card.
  const derived = useMemo(() => items.map(act => {
    const sub      = (act.submissions || {})[s.id] || {}
    const myGroup  = act.isGroup ? (act.groups || []).find(g => (g.memberIds || []).includes(s.id)) : null
    const groupSub = myGroup ? (act.groupSubmissions || {})[myGroup.id] : null
    const score    = sub.score ?? null
    const maxScore = act.maxScore || 100
    const hasSub   = act.isGroup ? !!groupSub?.text : !!sub.link
    const isPast   = act.deadline ? Date.now() > act.deadline : false
    const dueSoon  = !isPast && !!act.deadline && (act.deadline - Date.now() <= SOON_MS)
    let status = 'open'
    if (score != null) status = 'graded'
    else if (hasSub)   status = 'submitted'
    else if (isPast)   status = 'missed'
    return { act, sub, myGroup, groupSub, score, maxScore, hasSub, isPast, dueSoon, status }
  }), [items, s.id])

  const counts = useMemo(() => {
    const c = { all: derived.length, open: 0, dueSoon: 0, submitted: 0, graded: 0, missed: 0 }
    derived.forEach(d => { c[d.status]++; if (d.status === 'open' && d.dueSoon) c.dueSoon++ })
    return c
  }, [derived])

  const ring = useMemo(() => {
    const handled = counts.graded + counts.submitted
    const rate = counts.all ? Math.round((handled / counts.all) * 100) : 0
    const color = rate >= 75 ? 'var(--green)' : rate >= 50 ? 'var(--gold-var)' : 'var(--red)'
    return { handled, rate, color }
  }, [counts])

  // Deterministic "Activity Watch" findings - recomputed from `derived`, no network calls.
  const watch = useMemo(() => {
    const missed   = derived.filter(d => d.status === 'missed')
    const dueSoon  = derived.filter(d => d.status === 'open' && d.dueSoon).sort((a, b) => a.act.deadline - b.act.deadline)
    const awaiting = derived.filter(d => d.status === 'submitted')
    const graded   = derived.filter(d => d.status === 'graded')
    const f = []
    if (missed.length)
      f.push({ tone: 'bad', Icon: AlertTriangle, lead: `${missed.length} missed`, text: ` - ${missed[0].act.title}${missed.length > 1 ? ` and ${missed.length - 1} more` : ''}, deadline passed with no submission.` })
    if (dueSoon.length)
      f.push({ tone: 'warn', Icon: Clock, lead: 'Due soon', text: ` - ${dueSoon[0].act.title}${dueSoon.length > 1 ? ` and ${dueSoon.length - 1} more` : ''}, not yet submitted.` })
    if (awaiting.length)
      f.push({ tone: 'info', Icon: Hourglass, lead: `${awaiting.length} awaiting grade`, text: '.' })
    if (graded.length) {
      const avg = Math.round(graded.reduce((sum, d) => sum + (d.score / d.maxScore) * 100, 0) / graded.length)
      f.push({ tone: avg >= 75 ? 'good' : avg >= 60 ? 'warn' : 'bad', Icon: Trophy, lead: `Avg ${avg}%`, text: ` across ${graded.length} graded.` })
    }
    if (!f.length)
      f.push({ tone: 'good', Icon: CheckCircle2, lead: "You're all caught up", text: ' - nothing needs attention.' })
    const attention = missed.length + dueSoon.length
    const lead = attention
      ? `${attention} thing${attention > 1 ? 's' : ''} need${attention > 1 ? '' : 's'} your attention.`
      : awaiting.length ? `Nothing urgent - ${awaiting.length} awaiting grade.`
      : "You're on track."
    return { findings: f.slice(0, 4), lead, hasData: derived.length > 0 }
  }, [derived])

  const filtered = useMemo(() => {
    if (filter === 'all')     return derived
    if (filter === 'dueSoon') return derived.filter(d => d.status === 'open' && d.dueSoon)
    return derived.filter(d => d.status === filter)
  }, [derived, filter])

  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  function pickFilter(next) { setFilter(next); setPage(1) }

  async function submitActivity(actId) {
    const file = pendingFiles[actId] || null
    const typedLink = (linkInputs[actId] || '').trim()
    // A submission is a file OR a pasted link. A staged file wins.
    if (!file && !typedLink) { toast('Paste a link or attach a file.', 'warn'); return }
    if (!file && !/^https?:\/\/.+/.test(typedLink)) { toast('Please enter a valid URL starting with http:// or https://', 'warn'); return }
    if (!fbReady || !db.current) { toast('Activities require Firebase to be connected.', 'warn'); return }
    setSubmitting(prev => ({ ...prev, [actId]: true }))
    try {
      const act = activities.find(a => a.id === actId)
      let link = typedLink
      let contentText = null, contentMeta = null
      if (file) {
        // Step 1: read the file's text ON DEVICE (OCR/PDF/DOCX/text) so the
        //    professor's Smart grader can score it later without anyone pasting.
        //    Best-effort: a failure just means we submit without the extracted text.
        setExtractPct(prev => ({ ...prev, [actId]: 0 }))
        try {
          const ex = await extractSubmissionText(file, { onProgress: p => setExtractPct(prev => ({ ...prev, [actId]: p })) })
          if (ex?.text) { contentText = ex.text; contentMeta = ex.meta }
        } catch { /* best-effort */ }
        setExtractPct(prev => ({ ...prev, [actId]: null }))
        // Step 2: verify-then-upload. The file was checked on pick; here it
        //    uploads to the student's own Drive and we store the share link.
        setUploadPct(prev => ({ ...prev, [actId]: 0 }))
        const res = await uploadSubmission(file, {
          folderPath: [act?.subject || 'General', act?.title || 'Activity'],
          onProgress: pct => setUploadPct(prev => ({ ...prev, [actId]: pct })),
        })
        link = res.link
      }
      const sidPath = `submissions.${s.id}`
      await updateDoc(doc(db.current, 'activities', actId), {
        [`${sidPath}.link`]: link,
        [`${sidPath}.submittedAt`]: Date.now(),
        // Store (or clear) the extracted text alongside the link so re-submitting
        // a plain link never leaves stale OCR text behind.
        [`${sidPath}.contentText`]: contentText,
        [`${sidPath}.contentMeta`]: contentMeta,
      })
      setLinkInputs(prev => ({ ...prev, [actId]: '' }))
      setPendingFiles(prev => ({ ...prev, [actId]: null }))
      setEditing(prev => ({ ...prev, [actId]: false }))
      await pushAdminNotif(
        db.current, s,
        `Submitted: ${act?.title || actId}`,
        'act_sub',
        'act:' + actId
      )
      toast('Submission updated!', 'success')
    } catch (e) {
      toast('Failed to submit: ' + e.message, 'error')
    } finally {
      setExtractPct(prev => ({ ...prev, [actId]: null }))
      setUploadPct(prev => ({ ...prev, [actId]: null }))
      setSubmitting(prev => ({ ...prev, [actId]: false }))
    }
  }

  async function submitGroup(actId, group) {
    const text = (groupText[actId] ?? '').trim()
    if (!text) { toast('Add your group\'s analysis first.', 'warn'); return }
    if (!fbReady || !db.current) { toast('Activities require Firebase to be connected.', 'warn'); return }
    const link = (groupLink[actId] ?? '').trim()
    if (link && !/^https?:\/\/.+/.test(link)) { toast('Link must start with http:// or https://', 'warn'); return }
    setSubmitting(prev => ({ ...prev, [actId]: true }))
    try {
      const gp = `groupSubmissions.${group.id}`
      await updateDoc(doc(db.current, 'activities', actId), {
        [`${gp}.text`]: text,
        [`${gp}.link`]: link,
        [`${gp}.submittedBy`]: s.id,
        [`${gp}.submittedByName`]: s.name,
        [`${gp}.submittedAt`]: Date.now(),
      })
      setEditing(prev => ({ ...prev, [actId]: false }))
      const act = activities.find(a => a.id === actId)
      await pushAdminNotif(db.current, s, `Group submitted: ${act?.title || actId} (${group.name})`, 'act_sub', 'act:' + actId)
      toast('Group submission saved!', 'success')
    } catch (e) {
      toast('Failed to submit: ' + e.message, 'error')
    } finally {
      setSubmitting(prev => ({ ...prev, [actId]: false }))
    }
  }

  if (!items.length) {
    return (
      <EmptyState
        Icon={ClipboardList}
        title="No activities yet"
        text="Check back later."
      />
    )
  }

  if (!fbReady) return <SkeletonTable />

  const PILLS = [
    { key: 'all',       label: 'All' },
    { key: 'open',      label: 'Open' },
    { key: 'dueSoon',   label: 'Due soon' },
    { key: 'submitted', label: 'Submitted' },
    { key: 'graded',    label: 'Graded' },
    { key: 'missed',    label: 'Missed' },
  ]

  return (
    <div className="student-activities">
      <div className="sec-hdr mb-3">
        <div className="sec-title">Activities</div>
      </div>

      {/* Standing ring + Activity Watch */}
      <div className="sact-top">
        <div className="sact-card sact-ring-card">
          <StandingRing rate={ring.rate} color={ring.color} />
          <div className="sact-ring-meta">
            <strong>{ring.handled} of {counts.all} handled</strong><br />
            {counts.graded} graded · {counts.submitted} submitted<br />
            {counts.open} open{counts.missed ? ` · ${counts.missed} missed` : ''}
          </div>
        </div>

        <div className="sact-card sact-watch">
          <div className="sact-watch-h">
            <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />
            <span className="sact-watch-title">Activity Watch</span>
            <span className="sact-chip-tag">on-device</span>
          </div>
          <div className="sact-watch-lead">{watch.lead}</div>
          {watch.findings.map((fd, i) => (
            <div key={i} className={`sact-find sact-find-${fd.tone}`}>
              <fd.Icon size={16} />
              <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Status filter pills */}
      <div className="sact-pills">
        {PILLS.map(p => (
          <button
            key={p.key}
            className={`sact-pill ${filter === p.key ? 'on' : ''}`}
            onClick={() => pickFilter(p.key)}
          >
            {p.label} {counts[p.key]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          Icon={ClipboardList}
          title={`Nothing here under “${PILLS.find(p => p.key === filter)?.label}”.`}
          tone="muted"
        />
      ) : (
      <div className="sact-grid">
        {slice.map(d => {
          const act = d.act
          const sub = d.sub
          const hasLink  = !!sub.link
          const score    = d.score
          const isPast   = d.isPast
          const tl       = act.deadline ? timeLeft(act.deadline) : null
          const maxScore = d.maxScore
          const hasRubric = !!(act.rubric?.length)
          const myGroup = d.myGroup
          const groupSub = d.groupSub

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

              <StudentMeta student={s} subject={act.subject} className="sa-act-meta" />


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
                          {met ? <Check size={14} /> : <Circle size={14} />} {c.name} ({c.points}pt{c.points !== 1 ? 's' : ''})
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
                  {sub.latePenalty?.percent > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginTop: 2 }}>
                      Late submission penalty: −{sub.latePenalty.percent}%
                      {sub.latePenalty.rawScore != null && <span style={{ color: 'var(--ink3)', fontWeight: 400 }}> (before penalty: {sub.latePenalty.rawScore}/{maxScore})</span>}
                    </div>
                  )}
                  {sub.link && (
                    <div style={{ marginTop: 8 }}>
                      <SubmissionPreview link={sub.link} name={act.title} compact fallbackLabel="View submission" />
                    </div>
                  )}
                  {sub.feedback && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>Professor feedback</div>
                      <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{sub.feedback}</div>
                    </div>
                  )}
                </div>
              ) : act.isGroup ? (
                <div className="sa-act-group" style={{ marginTop: 8 }}>
                  {!myGroup ? (
                    <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
                      <Users size={13} className="inline-block mr-1" />You're not assigned to a group yet - message your professor.
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)', marginBottom: 3 }}>
                        <Users size={13} className="inline-block mr-1" />{myGroup.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 6 }}>
                        {(myGroup.memberIds || []).map(id => idName[id] || id).join(', ')}
                      </div>
                      {groupSub?.text && !editing[act.id] ? (
                        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                          <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>
                            Submitted by {groupSub.submittedByName || idName[groupSub.submittedBy] || 'a member'}
                            {groupSub.submittedAt ? ` · ${new Date(groupSub.submittedAt).toLocaleDateString('en-PH', { dateStyle: 'medium' })}` : ''}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>{groupSub.text}</div>
                          {groupSub.link && (
                            <div style={{ marginTop: 8 }}>
                              <SubmissionPreview link={groupSub.link} name={`${myGroup.name} - ${act.title}`} compact fallbackLabel="Open attached link" />
                            </div>
                          )}
                          {!isPast && (
                            <button className="btn btn-ghost btn-sm mt-2" onClick={() => {
                              setEditing(prev => ({ ...prev, [act.id]: true }))
                              setGroupText(prev => ({ ...prev, [act.id]: groupSub.text }))
                              setGroupLink(prev => ({ ...prev, [act.id]: groupSub.link || '' }))
                            }}>Edit group submission</button>
                          )}
                        </div>
                      ) : isPast && !groupSub?.text ? (
                        <div style={{ fontSize: 12, color: 'var(--red)' }}>The deadline passed with no group submission.</div>
                      ) : (
                        <div className="sa-act-submit-form">
                          <textarea className="input w-full" rows={4} placeholder="Paste your group's case analysis here…"
                            value={groupText[act.id] ?? ''} onChange={e => setGroupText(prev => ({ ...prev, [act.id]: e.target.value }))} />
                          <input className="input w-full mt-2" placeholder="Optional supporting link (https://…)"
                            value={groupLink[act.id] ?? ''} onChange={e => setGroupLink(prev => ({ ...prev, [act.id]: e.target.value }))} />
                          {(groupLink[act.id] || '').trim() && (
                            <div style={{ marginTop: 8 }}>
                              <SubmissionPreview link={(groupLink[act.id] || '').trim()} name={`${myGroup.name} - ${act.title}`} compact previewOnly />
                            </div>
                          )}
                          <div className="flex gap-2 mt-2">
                            <button className="btn btn-primary btn-sm" onClick={() => submitGroup(act.id, myGroup)}
                              disabled={submitting[act.id] || !(groupText[act.id] ?? '').trim() || isPast}>
                              {submitting[act.id] ? 'Saving…' : 'Submit for group →'}
                            </button>
                            {editing[act.id] && (
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(prev => ({ ...prev, [act.id]: false }))}>Cancel</button>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>Any member can submit or update on behalf of the whole group.</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : hasLink ? (
                <div className="sa-act-submitted">
                  {editing[act.id] && !isPast ? (
                    <div className="sa-act-submit-form">
                      <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 6 }}>
                        Edit your submission link below. You can update it until the deadline.
                      </div>
                      <input
                        className="input"
                        placeholder="Paste updated link (https://…)"
                        value={linkInputs[act.id] ?? sub.link}
                        onChange={e => setLinkInputs(prev => ({ ...prev, [act.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') submitActivity(act.id) }}
                      />
                      {(linkInputs[act.id] ?? sub.link ?? '').trim() && (
                        <div style={{ marginTop: 8 }}>
                          <SubmissionPreview link={(linkInputs[act.id] ?? sub.link ?? '').trim()} name={act.title} compact previewOnly />
                        </div>
                      )}
                      <SubmissionFileField
                        file={pendingFiles[act.id] || null}
                        onPick={f => setPendingFiles(prev => ({ ...prev, [act.id]: f }))}
                        progress={uploadPct[act.id] ?? null}
                        disabled={submitting[act.id]}
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => submitActivity(act.id)}
                          disabled={submitting[act.id] || (!(linkInputs[act.id] ?? sub.link).trim() && !pendingFiles[act.id])}
                        >
                          {submitting[act.id]
                            ? (extractPct[act.id] != null ? `Reading file ${extractPct[act.id]}%…`
                              : uploadPct[act.id] != null ? `Uploading ${uploadPct[act.id]}%…` : 'Saving…')
                            : 'Save changes →'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setEditing(prev => ({ ...prev, [act.id]: false }))
                            setLinkInputs(prev => ({ ...prev, [act.id]: '' }))
                            setPendingFiles(prev => ({ ...prev, [act.id]: null }))
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>Submitted - awaiting grade</div>
                      <SubmissionPreview link={sub.link} name={act.title} compact fallbackLabel="View your submission" />
                      <div className="mt-2">
                        {!isPast ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setEditing(prev => ({ ...prev, [act.id]: true }))
                              setLinkInputs(prev => ({ ...prev, [act.id]: sub.link }))
                            }}
                          >
                            Edit link
                          </button>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>
                            The deadline has passed - you can no longer edit your link. If you need to make a change,{' '}
                            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>message your professor.</span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
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
                  {(linkInputs[act.id] || '').trim() && (
                    <div style={{ marginTop: 8 }}>
                      <SubmissionPreview link={(linkInputs[act.id] || '').trim()} name={act.title} compact previewOnly />
                    </div>
                  )}
                  <SubmissionFileField
                    file={pendingFiles[act.id] || null}
                    onPick={f => setPendingFiles(prev => ({ ...prev, [act.id]: f }))}
                    progress={uploadPct[act.id] ?? null}
                    disabled={submitting[act.id]}
                  />
                  <button
                    className="btn btn-primary btn-sm mt-2"
                    onClick={() => submitActivity(act.id)}
                    disabled={submitting[act.id] || (!(linkInputs[act.id] || '').trim() && !pendingFiles[act.id])}
                  >
                    {submitting[act.id]
                      ? (extractPct[act.id] != null ? `Reading file ${extractPct[act.id]}%…`
                        : uploadPct[act.id] != null ? `Uploading ${uploadPct[act.id]}%…` : 'Submitting…')
                      : 'Submit →'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

      <Pagination total={filtered.length} perPage={PER_PAGE} page={page} onChange={setPage} />
    </div>
  )
}
