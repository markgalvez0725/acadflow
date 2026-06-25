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
