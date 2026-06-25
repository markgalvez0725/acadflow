import React, { useMemo, useState } from 'react'
import { ShieldCheck, AlertTriangle, CheckCircle2, ChevronRight, BellRing } from 'lucide-react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { auditAccounts, legacyActiveIds, nudgeTargets } from '@/utils/accountAudit'

// Teacher-side analyzer for EXISTING accounts (the AI identity check only runs at
// registration). Shows verification coverage + flags integrity anomalies, with a
// one-click "mark all legacy accounts verified" and a jump into each flagged row.
export default function AccountAuditModal({ onClose, onOpenStudent }) {
  const { students, classes, bulkVerifyAccounts, bulkNudgeProfiles } = useData()
  const { toast, openDialog } = useUI()
  const [busy, setBusy] = useState(false)

  const { coverage, registeredCount, flags } = useMemo(() => auditAccounts(students, classes), [students, classes])
  const legacyIds = useMemo(() => legacyActiveIds(students), [students])
  const nudgeList = useMemo(() => nudgeTargets(students), [students])

  async function markLegacyVerified() {
    if (!legacyIds.length) return
    const ok = await openDialog({
      title: `Mark ${legacyIds.length} legacy account${legacyIds.length > 1 ? 's' : ''} verified?`,
      msg: 'These are active accounts that pre-date AI verification. Marking them teacher-verified clears the "never checked" state — it does not change their access.',
      type: 'warn', confirmLabel: 'Mark verified', showCancel: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const n = await bulkVerifyAccounts(legacyIds)
      toast(`${n} account${n > 1 ? 's' : ''} marked verified.`, 'green')
    } catch (e) { toast('Failed: ' + e.message, 'red') } finally { setBusy(false) }
  }

  async function nudgeProfiles() {
    if (!nudgeList.length) return
    const ok = await openDialog({
      title: `Nudge ${nudgeList.length} student${nudgeList.length > 1 ? 's' : ''} to finish their profile?`,
      msg: 'Sends an in-app notification that opens Edit Profile. When they save, the AI re-checks their details and can activate them automatically. Only reaches students who have signed in and have something they can fix themselves — never-logged-in accounts are not included (use “Verify & activate” for those).',
      type: 'info', confirmLabel: 'Send nudge', showCancel: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const n = await bulkNudgeProfiles(nudgeList.map(t => t.id))
      toast(n ? `Nudge sent to ${n} student${n > 1 ? 's' : ''}.` : 'Everyone was already nudged today.', n ? 'green' : 'blue')
    } catch (e) { toast('Failed: ' + e.message, 'red') } finally { setBusy(false) }
  }

  const sevColor = s => s === 'high' ? 'var(--red)' : s === 'medium' ? 'var(--yellow)' : 'var(--ink3)'

  return (
    <Modal onClose={onClose} size="lg" zIndex={300}>
      <ModalHeader title="Account verification audit" subtitle="Analyze existing accounts for integrity issues" onClose={onClose} />

      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
        {[
          ['AI-verified', coverage.ai, 'var(--green)'],
          ['Teacher-verified', coverage.teacher, 'var(--green)'],
          ['Legacy (unchecked)', coverage.legacy, coverage.legacy > 0 ? 'var(--yellow)' : undefined],
          ['Awaiting review', coverage.pendingVerify, coverage.pendingVerify > 0 ? 'var(--yellow)' : undefined],
        ].map(([label, val, color]) => (
          <div key={label} className="rounded-lg p-3" style={{ background: 'var(--bg)' }}>
            <div className="text-xs text-ink2">{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: color || 'var(--ink)' }}>{val}</div>
          </div>
        ))}
      </div>

      {(legacyIds.length > 0 || nudgeList.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {legacyIds.length > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={markLegacyVerified}>
              <ShieldCheck size={14} /> Mark all {legacyIds.length} legacy account{legacyIds.length > 1 ? 's' : ''} verified
            </button>
          )}
          {nudgeList.length > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={nudgeProfiles}>
              <BellRing size={14} /> Nudge {nudgeList.length} student{nudgeList.length > 1 ? 's' : ''} to finish profile
            </button>
          )}
        </div>
      )}

      <div className="text-[11px] font-bold uppercase tracking-wide text-ink3 mb-2 flex items-center gap-1.5">
        <AlertTriangle size={12} /> {flags.length} account{flags.length !== 1 ? 's' : ''} flagged
      </div>

      {flags.length === 0 ? (
        <div className="empty" style={{ padding: '24px 0' }}>
          <div className="empty-icon"><CheckCircle2 size={36} /></div>
          No integrity issues across {registeredCount} account{registeredCount !== 1 ? 's' : ''}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
          {flags.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => { onOpenStudent?.(f.id); onClose() }}
              className="text-left rounded-lg p-3 flex items-start gap-3"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: sevColor(f.severity), marginTop: 6, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="font-semibold text-ink block">{f.name}</span>
                <span className="text-xs text-ink2" style={{ lineHeight: 1.5 }}>{f.reasons.join(' · ')}</span>
              </span>
              <ChevronRight size={16} className="text-ink3 shrink-0" style={{ marginTop: 4 }} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
