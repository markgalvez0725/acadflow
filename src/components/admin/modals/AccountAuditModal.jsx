import React, { useMemo, useState } from 'react'
import { ShieldCheck, AlertTriangle, CheckCircle2, ChevronRight, BellRing, RefreshCw, Loader2, UserMinus } from 'lucide-react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { auditAccounts, legacyActiveIds, nudgeTargets, incompleteProfiles, demoteCandidates } from '@/utils/accountAudit'

// Teacher-side analyzer for EXISTING accounts (the AI identity check only runs at
// registration). Shows verification coverage + flags integrity anomalies, with a
// one-click "mark all legacy accounts verified" and a jump into each flagged row.
export default function AccountAuditModal({ onClose, onOpenStudent }) {
  const { students, classes, bulkVerifyAccounts, bulkNudgeProfiles, bulkDemoteAndNudge } = useData()
  const { toast, openDialog } = useUI()
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scannedTotal, setScannedTotal] = useState(null)

  const { coverage, registeredCount, flags } = useMemo(() => auditAccounts(students, classes), [students, classes])
  const legacyIds = useMemo(() => legacyActiveIds(students), [students])
  // Whole-roster scan (active accounts included): every incomplete profile, and
  // the subset eligible to nudge right now (the rest are within their cooldown).
  const incomplete = useMemo(() => incompleteProfiles(students), [students])
  const nudgeList  = useMemo(() => nudgeTargets(students), [students])
  // ACTIVE accounts with a self-fixable data gap — eligible to be sent back to
  // pending for re-verification (course/section gaps are excluded — see helper).
  const demoteList = useMemo(() => demoteCandidates(students), [students])
  // incomplete = pending accounts + active-with-data-gap accounts (disjoint:
  // active ≠ pending). Pending ones are the nudge audience; active ones are the
  // demote audience.
  const pendingCount  = incomplete.length - demoteList.length
  const alreadyNudged = pendingCount - nudgeList.length

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
      toast(n ? `Nudge sent to ${n} student${n > 1 ? 's' : ''}.` : 'Everyone was already nudged.', n ? 'green' : 'blue')
    } catch (e) { toast('Failed: ' + e.message, 'red') } finally { setBusy(false) }
  }

  async function demoteIncomplete() {
    if (!demoteList.length) return
    const ok = await openDialog({
      title: `Send ${demoteList.length} incomplete account${demoteList.length > 1 ? 's' : ''} back to pending?`,
      msg: 'These are ACTIVE students missing a profile photo or a properly formatted name. Each one is set back to "pending" (grade/quiz/activity access paused) and nudged to finish their profile. When they complete it, the AI re-checks them and restores full access automatically — or you can approve them manually. Only students who can fix the gap themselves are included.',
      type: 'warn', confirmLabel: 'Send to pending & nudge', showCancel: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const n = await bulkDemoteAndNudge(demoteList.map(t => t.id))
      toast(n ? `${n} account${n > 1 ? 's' : ''} set to pending and nudged.` : 'Could not reach those students — nothing changed.', n ? 'green' : 'blue')
    } catch (e) { toast('Failed: ' + e.message, 'red') } finally { setBusy(false) }
  }

  // The audit is computed live from the real-time roster, so it is always current
  // the moment this modal opens. This button re-evaluates the WHOLE roster on
  // demand and reports the result, so the teacher can see the scan ran and pick
  // up any students added/changed since opening.
  function rescan() {
    setScanning(true)
    setTimeout(() => {
      setScannedTotal(registeredCount)
      setScanning(false)
      toast(`Scanned ${registeredCount} account${registeredCount !== 1 ? 's' : ''} — ${demoteList.length} active to re-verify, ${nudgeList.length} pending to nudge.`, 'blue')
    }, 350)
  }

  const sevColor = s => s === 'high' ? 'var(--red)' : s === 'medium' ? 'var(--yellow)' : 'var(--ink3)'

  return (
    <Modal onClose={onClose} size="lg" zIndex={300}>
      <ModalHeader title="Account verification audit" subtitle="Analyze existing accounts for integrity issues" onClose={onClose} />

      <div className="flex items-center justify-between gap-2 mb-3" style={{ marginTop: -4 }}>
        <div className="text-[11px] text-ink3">
          {scannedTotal != null
            ? `Scanned ${scannedTotal} account${scannedTotal !== 1 ? 's' : ''} · ${incomplete.length} incomplete · ${nudgeList.length} ready to nudge`
            : `Live scan of all ${registeredCount} registered account${registeredCount !== 1 ? 's' : ''} — active included`}
        </div>
        <button className="btn btn-ghost btn-sm" disabled={busy || scanning} onClick={rescan} title="Re-evaluate every account on the roster now">
          {scanning ? <><Loader2 size={13} className="spin" /> Scanning…</> : <><RefreshCw size={13} /> Re-scan roster</>}
        </button>
      </div>

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

      {(legacyIds.length > 0 || incomplete.length > 0 || demoteList.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {legacyIds.length > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={markLegacyVerified}>
              <ShieldCheck size={14} /> Mark all {legacyIds.length} legacy account{legacyIds.length > 1 ? 's' : ''} verified
            </button>
          )}
          {demoteList.length > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={demoteIncomplete} style={{ color: 'var(--yellow)' }} title="Set active-but-incomplete accounts back to pending and nudge them to finish">
              <UserMinus size={14} /> Re-verify {demoteList.length} incomplete active account{demoteList.length > 1 ? 's' : ''}
            </button>
          )}
          {pendingCount > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy || nudgeList.length === 0}
              onClick={nudgeProfiles}
              title={nudgeList.length === 0 ? 'Every pending student has already been nudged.' : undefined}
            >
              <BellRing size={14} /> {nudgeList.length > 0
                ? `Nudge ${nudgeList.length} pending student${nudgeList.length > 1 ? 's' : ''} to finish profile`
                : 'All pending students nudged'}
            </button>
          )}
        </div>
      )}

      {incomplete.length > 0 && (
        <div className="text-[11px] text-ink3 mb-3" style={{ marginTop: -4 }}>
          {demoteList.length > 0 && <>{demoteList.length} active account{demoteList.length !== 1 ? 's' : ''} with incomplete details (re-verify) · </>}
          {pendingCount} pending account{pendingCount !== 1 ? 's' : ''}
          {alreadyNudged > 0 && <> · {alreadyNudged} already nudged (re-eligible after a week if still incomplete)</>}
          {nudgeList.length > 0 && <> · {nudgeList.length} awaiting a nudge</>}
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
