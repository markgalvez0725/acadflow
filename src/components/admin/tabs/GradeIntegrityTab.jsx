import React, { useMemo, useState } from 'react'
import { ShieldCheck, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { auditSubjectGrade } from '@/utils/gradeEngine'

// ── Grade Integrity (Verified Grading auditor) ─────────────────────────────
// Continuously re-runs the GradeEngine live for every published grade and flags
// any whose stored value no longer matches the current activities / quizzes /
// attendance (e.g. a quiz was deleted, an activity graded after upload). One
// click recomputes & re-publishes so the student always sees a grade that is
// provably consistent with the data — nothing to dispute.
export default function GradeIntegrityTab() {
  const { students, activities, quizzes, classes, eqScale, syncDriftedGrades } = useData()
  const { toast, openDialog } = useUI()
  const [busy, setBusy] = useState(false)

  const { drifts, publishedCount } = useMemo(() => {
    const ctx = { activities, quizzes, students, classes, eqScale }
    const out = []
    let published = 0
    for (const s of students) {
      const subs = Object.keys(s.gradeComponents || {})
      for (const sub of subs) {
        const comp = s.gradeComponents[sub]
        const isPublished = comp?.midterm != null && comp?.finals != null && s.gradeUploadedAt?.[sub]
        if (!isPublished) continue
        published += 1
        const a = auditSubjectGrade(s, sub, ctx)
        if (a.drift) out.push({ studentId: s.id, name: s.name || s.id, subject: sub, ...a })
      }
    }
    out.sort((a, b) => (b.delta || 0) - (a.delta || 0))
    return { drifts: out, publishedCount: published }
  }, [students, activities, quizzes, classes, eqScale])

  async function syncAll() {
    if (!drifts.length) return
    const ok = await openDialog({
      title: `Recompute ${drifts.length} grade${drifts.length > 1 ? 's' : ''}?`,
      msg: 'Each flagged grade will be recomputed from the current activities, quizzes, and attendance, then re-published. This overwrites the stored term grades for those subjects.',
      type: 'warn', confirmLabel: 'Recompute & sync', showCancel: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const n = await syncDriftedGrades(drifts.map(d => ({ studentId: d.studentId, subject: d.subject })))
      toast(`Synced ${n} student${n > 1 ? 's' : ''} — grades now match the live data.`, 'success')
    } catch (e) {
      toast('Sync failed: ' + e.message, 'error')
    } finally { setBusy(false) }
  }

  async function syncOne(d) {
    setBusy(true)
    try {
      await syncDriftedGrades([{ studentId: d.studentId, subject: d.subject }])
      toast(`${d.name} · ${d.subject} recomputed & synced.`, 'success')
    } catch (e) {
      toast('Sync failed: ' + e.message, 'error')
    } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* Summary header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', marginBottom: 18,
        borderRadius: 16, border: '1px solid var(--border)',
        background: drifts.length ? 'var(--yellow-l, rgba(234,179,8,.10))' : 'var(--surface)',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: drifts.length ? 'rgba(234,179,8,.18)' : 'var(--accent-l)',
          color: drifts.length ? 'var(--yellow)' : 'var(--accent)',
        }}>
          {drifts.length ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--ink)' }}>
            {drifts.length
              ? `${drifts.length} grade${drifts.length > 1 ? 's' : ''} need recomputing`
              : 'All published grades verified'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
            {drifts.length
              ? 'These no longer match the current activities, quizzes, or attendance.'
              : `Every one of the ${publishedCount} published grade${publishedCount === 1 ? '' : 's'} matches the live data exactly.`}
          </div>
        </div>
        {drifts.length > 0 && (
          <button className="btn btn-primary" disabled={busy} onClick={syncAll}>
            <RefreshCw size={15} /> Recompute &amp; sync all
          </button>
        )}
      </div>

      {/* Drift list */}
      {drifts.length === 0 ? (
        <div className="empty" style={{ padding: '32px 0' }}>
          <div className="empty-icon"><CheckCircle2 size={40} /></div>
          Nothing to fix. New drift shows up here automatically when activities,
          quizzes, or attendance change after a grade was published.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {drifts.map(d => (
            <div key={d.studentId + '|' + d.subject} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{d.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{d.subject}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 3 }}>
                  {d.reasons.length ? d.reasons.join(' · ') : 'Inputs changed since publish'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
                  <span style={{ textDecoration: 'line-through', color: 'var(--ink3)' }}>{d.stored}%</span>
                  {' → '}
                  <strong style={{ color: 'var(--accent)' }}>{d.live}%</strong>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--yellow)', fontWeight: 600 }}>Δ {d.delta}</div>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => syncOne(d)} style={{ flexShrink: 0 }}>
                <RefreshCw size={14} /> Sync
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
