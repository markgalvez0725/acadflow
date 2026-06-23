// Canonical account-status state machine — single source of truth for the
// three states a student record can be in. Use these helpers everywhere a
// status is displayed, sorted, or exported so the logic never drifts.
//
// Lifecycle (driven entirely by the student's `account` object):
//
//   none ──(admin provisions account, or student self-registers)──▶ pending/active
//   pending ──(student sets their OWN password — first login change)──▶ active
//
//   • none    : no login credentials yet. `!account.registered`.
//               The student is on the roster but cannot sign in.
//   • pending : an account exists but the student hasn't taken ownership — they
//               are still on a teacher-set temporary password. `account._tempPass`
//               is true (admin "Add student" path) and/or `activated` is unset.
//   • active  : the student has taken ownership of the account — self-registered
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
export function accountStatusKey(student) {
  const a = student?.account
  if (!a?.registered) return 'none'
  if (a.activated && !a._tempPass) return 'active'
  return 'pending'
}

// Full descriptor { key, label, variant, rank } for a student.
export function accountStatus(student) {
  return ACCOUNT_STATUS[accountStatusKey(student)]
}

// Sort weight (No account → Pending → Active).
export function accountStatusRank(student) {
  return accountStatus(student).rank
}
