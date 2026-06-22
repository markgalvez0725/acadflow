// ── Firebase Auth identity mapping ────────────────────────────────────────
// Students keep signing in with their student number. Behind the scenes each
// student number maps to a synthetic Firebase Auth email so we can use real
// Email/Password authentication without changing the student-facing UX.
// The teacher/admin signs in with a real email.

export const ADMIN_EMAIL = 'markgalvez@ucc-caloocan.edu.ph'

// Synthetic Firebase Auth email for a student number (case-insensitive).
export function studentEmail(snum) {
  return String(snum || '').trim().toLowerCase().replace(/\s+/g, '') + '@acadflow.app'
}

// Student records are stored with an UPPERCASE Firestore document id.
export function studentDocId(snum) {
  return String(snum || '').trim().toUpperCase()
}
