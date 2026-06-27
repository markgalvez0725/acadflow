// Canonical account-status state machine - single source of truth for the
// three states a student record can be in. Use these helpers everywhere a
// status is displayed, sorted, or exported so the logic never drifts.
//
// Lifecycle (driven entirely by the student's `account` object):
//
//   none ──(admin provisions account, or student self-registers)──▶ pending/active
//   pending ──(student sets their OWN password - first login change)──▶ active
//
//   • none    : no login credentials yet. `!account.registered`.
//               The student is on the roster but cannot sign in.
//   • pending : an account exists but the student hasn't taken ownership - they
//               are still on a teacher-set temporary password. `account._tempPass`
//               is true (admin "Add student" path) and/or `activated` is unset.
//   • active  : the student has taken ownership of the account - self-registered
//               (sets their own password + security question) or has changed the
//               temporary password. `account.activated && !account._tempPass`.
//
// Why both flags? `activated` records that the student completed setup; clearing
// `_tempPass` records that the password is the student's own, not the teacher's.
// A record only counts as Active once BOTH are true, so a student sitting on a
// teacher-set password reads as Pending even if some legacy write set `activated`.

export const ACCOUNT_STATUS = {
  none:    { key: 'none',    label: 'No account', variant: 'gray',   rank: 0 },
  pending: { key: 'pending', label: 'Pending',    variant: 'yellow', rank: 1 },
  active:  { key: 'active',  label: 'Active',     variant: 'green',  rank: 2 },
}

// The state key for a student: 'none' | 'pending' | 'active'.
//
// A self-registered account is now also gated on IDENTITY VERIFICATION: it is
// Active only once `account.verified` is true (set server-side by the AI gate or
// by a teacher) AND the student owns their password. Legacy accounts have no
// `verified` field - they are grandfathered (treated as verified) so existing
// students never flip back to Pending. Only `verified === false` (a brand-new
// self-registration awaiting verification) holds an account in Pending.
// Activation is now a TWO-step sequence: (1) identity verification (photo +
// course/year/section), then (2) Face ID enrollment. An account is Active only
// once BOTH are done (plus the student owning their password). Face ID is a hard
// requirement - `account.faceResetEnabled` must be true.
export function accountStatusKey(student) {
  const a = student?.account
  if (!a?.registered) return 'none'
  const verifiedOk = a.verified !== false // true OR undefined(legacy) → ok
  if (a.activated && !a._tempPass && verifiedOk && a.faceResetEnabled === true) return 'active'
  return 'pending'
}

// True when a student is registered but is specifically awaiting identity
// verification (vs. a teacher-temp-password pending). Drives the teacher queue.
export function isPendingVerification(student) {
  return student?.account?.registered === true && student?.account?.verified === false
}

// Step 2 of activation: identity is settled and the student owns their password,
// but Face ID isn't enrolled yet. This gates the protected tabs until they set
// it up (a camera device is required - there is no exception).
export function needsFaceStep(student) {
  const a = student?.account
  return a?.registered === true
    && a.verified !== false
    && !a._tempPass
    && a.faceResetEnabled !== true
}

// The stored AI/teacher verification record, or null.
export function verificationInfo(student) {
  return student?.account?.verification || null
}

// Full descriptor { key, label, variant, rank } for a student.
export function accountStatus(student) {
  return ACCOUNT_STATUS[accountStatusKey(student)]
}

// Sort weight (No account → Pending → Active).
export function accountStatusRank(student) {
  return accountStatus(student).rank
}
