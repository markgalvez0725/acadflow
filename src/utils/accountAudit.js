// ── Existing-account verification audit (on-device) ───────────────────────
// The AI identity check only runs at self-registration; accounts that already
// existed were grandfathered. This analyzes the CURRENT registered accounts for
// integrity signals the roster row can still reveal — there is no separate
// "claim vs record" left, so it checks consistency + anomalies instead of an
// identity re-match: duplicate names, section/course vs the assigned class,
// missing/!malformed fields, and verification coverage. Pure + deterministic.

import { normName, normSection } from './identityVerify'
import { accountStatusKey, isPendingVerification } from './accountStatus'

export function auditAccounts(students = [], classes = []) {
  const classById = new Map(classes.map(c => [c.id, c]))
  const registered = students.filter(s => s.account?.registered)

  // Verification coverage of every account that can sign in.
  const coverage = { ai: 0, teacher: 0, legacy: 0, pendingVerify: 0 }

  // Duplicate-name detection across all registered accounts.
  const nameCount = {}
  for (const s of registered) { const k = normName(s.name); if (k) nameCount[k] = (nameCount[k] || 0) + 1 }

  const RANK = { high: 0, medium: 1, low: 2 }
  const flags = []

  for (const s of registered) {
    const a = s.account || {}
    const method = a.verification?.method
    if (isPendingVerification(s)) coverage.pendingVerify++
    else if (method === 'ai') coverage.ai++
    else if (method === 'teacher') coverage.teacher++
    else coverage.legacy++

    const reasons = []
    let severity = 'low'
    const bump = lvl => { if (RANK[lvl] < RANK[severity]) severity = lvl }

    // Name present + formatted "SURNAME, First".
    if (!String(s.name || '').trim()) { reasons.push('No name on file'); bump('high') }
    else if (!String(s.name).includes(',')) reasons.push('Name has no surname separator (expected "SURNAME, First")')

    // Duplicate name with another account.
    const dn = normName(s.name)
    if (dn && nameCount[dn] > 1) { reasons.push(`Same name as ${nameCount[dn] - 1} other account${nameCount[dn] - 1 > 1 ? 's' : ''}`); bump('high') }

    // Incomplete profile.
    const missing = ['course', 'year', 'section'].filter(f => !String(s[f] || '').trim())
    if (missing.length) { reasons.push(`Missing ${missing.join(', ')}`); bump('medium') }

    // Section vs the assigned class section.
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const enrolledClasses = enrolledIds.map(id => classById.get(id)).filter(Boolean)
    if (String(s.section || '').trim() && enrolledClasses.length) {
      const anyMatch = enrolledClasses.some(c => !c.section || normSection(c.section) === normSection(s.section))
      if (!anyMatch) {
        const cs = enrolledClasses.map(c => c.section).filter(Boolean).join(', ')
        reasons.push(`Section "${s.section}" differs from class section${enrolledClasses.length > 1 ? 's' : ''} ${cs}`)
        bump('medium')
      }
    }

    // Provisioned but never claimed (still on the teacher's temporary password).
    if (a._tempPass) { reasons.push('On a temporary password — not yet activated'); bump('low') }

    if (reasons.length) flags.push({ id: s.id, name: s.name || s.id, severity, reasons, status: accountStatusKey(s) })
  }

  flags.sort((a, b) => RANK[a.severity] - RANK[b.severity] || String(a.name).localeCompare(String(b.name)))
  return { coverage, registeredCount: registered.length, flags }
}

// Re-nudge cooldown: once a student is nudged we stamp account.profileNudgedAt
// and exclude them from the target set until this window elapses. That makes the
// teacher's "Nudge" button disable as soon as everyone flagged has been notified,
// and re-enable later only for students who are NEW (never stamped) or who are
// still incomplete after the cooldown. Tunable in one place.
export const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Whether a notification can even reach this account: the student has claimed it
// (registered + activated + off the temp password) so they can sign in and see an
// in-app notification. The never-logged-in / temp-password crowd is unreachable.
export function isReachable(s) {
  const a = s?.account || {}
  return !!(a.registered && a.activated && !a._tempPass)
}

// DATA gaps a student can FIX THEMSELVES in Edit Profile — no photo, or a name
// without a surname. These are the ONLY gaps allowed to demote an active account
// back to pending, precisely because the student can resolve them. Course / year /
// section are teacher-owned and locked on the student side, so they are NEVER
// here — demoting on those would lock the student out with no way to self-fix.
// Pure + deterministic.
export function dataGapReasons(s) {
  const reasons = []
  if (!s.photo) reasons.push('No profile photo')
  if (String(s.name || '').trim() && !String(s.name).includes(',')) reasons.push('Name is missing a surname')
  return reasons
}

// All gaps shown to the teacher for a reachable account: the verification status
// plus the self-fixable data gaps. (Display only.)
export function profileGapReasons(s) {
  const reasons = []
  if (isPendingVerification(s)) reasons.push('Awaiting verification — confirm your details')
  return reasons.concat(dataGapReasons(s))
}

// EVERY reachable account with a gap — scanned across the WHOLE roster, active
// accounts included (an active student can still be missing a photo). This is the
// "audit" view: how many profiles are incomplete right now, regardless of nudge
// state. Each entry carries `nudgedAt` so the UI can show who is still awaiting a
// first nudge vs. already notified.
export function incompleteProfiles(students = []) {
  const out = []
  for (const s of students) {
    if (!isReachable(s)) continue
    const reasons = profileGapReasons(s)
    if (reasons.length) out.push({ id: s.id, name: s.name || s.id, reasons, nudgedAt: s.account?.profileNudgedAt || 0 })
  }
  return out
}

// ACTIVE accounts with a self-fixable DATA gap (name/photo) — the accounts the
// "send to pending & nudge" action re-verifies. Demoting these to pending is safe
// because the student can resolve the gap themselves; teacher-owned gaps
// (course/section/year) are deliberately excluded. Active = not already pending.
export function demoteCandidates(students = []) {
  const out = []
  for (const s of students) {
    if (!isReachable(s)) continue
    if (accountStatusKey(s) !== 'active') continue // already pending/none → not a demotion
    const reasons = dataGapReasons(s)
    if (reasons.length) out.push({ id: s.id, name: s.name || s.id, reasons })
  }
  return out
}

// Already-PENDING accounts to remind right now: pending verification, reachable,
// and not nudged within the cooldown. Empty → the Nudge button disables. New /
// just-demoted / cooled-down students flow back in on the next (live) audit pass.
// `now` is injectable for testing. Pure + deterministic.
export function nudgeTargets(students = [], now = Date.now()) {
  return students
    .filter(s => isReachable(s) && isPendingVerification(s))
    .filter(s => { const t = s.account?.profileNudgedAt || 0; return !(t && now - t < NUDGE_COOLDOWN_MS) })
    .map(s => ({ id: s.id, name: s.name || s.id, reasons: profileGapReasons(s), nudgedAt: s.account?.profileNudgedAt || 0 }))
}

// IDs of grandfathered accounts — registered + active but never AI/teacher
// verified — for the "mark all legacy accounts verified" bulk action.
export function legacyActiveIds(students = []) {
  return students.filter(s => {
    const a = s.account
    if (!a?.registered) return false
    if (a.verification?.method === 'ai' || a.verification?.method === 'teacher') return false
    return accountStatusKey(s) === 'active'
  }).map(s => s.id)
}
