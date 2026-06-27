import React from 'react'
import { BadgeCheck, Hourglass } from 'lucide-react'
import { accountStatusKey } from '@/utils/accountStatus'

// Verified blue (Facebook/Instagram-style seal) and pending amber. Hard-coded so
// the verification mark reads the same in light/dark and never tracks the theme
// accent — a verified check is always the recognizable blue.
const VERIFIED_BLUE = '#1d9bf0'
const PENDING_AMBER  = '#f59e0b'

/**
 * Inline account-verification badge shown next to a student's name (Facebook/
 * Instagram-style). Drop it anywhere a student identity is rendered.
 *
 *  • active  → solid blue check seal (verified). Display-only.
 *  • pending → small amber "Pending" mark. With `onPendingClick` it becomes a
 *    button that routes the student to finish account setup so they turn Active.
 *  • none / unresolved → renders NOTHING (no account, unknown id, or a non-student
 *    author such as the teacher) — so it never shows a stray mark.
 *
 * Status is derived from the single source of truth (accountStatusKey), so this
 * never drifts from the gating/lock logic elsewhere.
 *
 * Props (pass ONE of student / studentId+students):
 *  - student {object}        — the student record, when already in scope
 *  - studentId {string}       — resolve from `students` when no object is handy
 *  - students {array}         — roster used to resolve `studentId`
 *  - size {number}           — icon px (default 15)
 *  - onPendingClick {fn}      — optional; makes the pending mark an action button
 *  - showPendingLabel {bool}  — show the "Pending" text chip (default false → icon only)
 *  - className {string}
 */
export default function VerifiedBadge({ student, studentId, students, size = 15, onPendingClick, showPendingLabel = false, className = '' }) {
  // Resolve the record: explicit object, else look up by id in a provided roster.
  const resolved = student || (studentId && Array.isArray(students)
    ? students.find(s => s && s.id === studentId)
    : null)
  if (!resolved) return null

  const key = accountStatusKey(resolved)
  if (key === 'none') return null // no account yet → no badge

  if (key === 'active') {
    return (
      <BadgeCheck
        size={size}
        role="img"
        aria-label="Verified account"
        className={className}
        style={{ color: VERIFIED_BLUE, fill: VERIFIED_BLUE, stroke: '#fff', flexShrink: 0, verticalAlign: 'text-bottom' }}
      />
    )
  }

  // pending
  const inner = (
    <>
      <Hourglass size={Math.max(11, size - 2)} aria-hidden="true" style={{ flexShrink: 0 }} />
      {showPendingLabel && <span>Pending</span>}
    </>
  )
  const baseStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
    fontSize: 11, fontWeight: 600, lineHeight: 1, color: PENDING_AMBER,
    padding: showPendingLabel ? '2px 7px' : 0,
    borderRadius: 999,
    background: showPendingLabel ? 'rgba(245,158,11,.14)' : 'transparent',
    verticalAlign: 'text-bottom',
  }

  if (onPendingClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={e => { e.stopPropagation(); onPendingClick() }}
        aria-label="Account pending — finish setting up your account"
        title="Finish setting up your account to get verified"
        style={{ ...baseStyle, border: 'none', cursor: 'pointer' }}
      >
        {inner}
      </button>
    )
  }

  return (
    <span className={className} role="img" aria-label="Account pending verification" title="Pending verification" style={baseStyle}>
      {inner}
    </span>
  )
}
