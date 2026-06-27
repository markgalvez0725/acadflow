import React from 'react'
import { Star } from 'lucide-react'

// Professor identity mark - a star "seal" shown next to the professor's name.
// This is the teacher-side counterpart to the student VerifiedBadge: the
// professor is verified by role, so they get a distinct seal rather than the
// blue account-verified check. Two shapes:
//   default        - icon-only seal (tight rows: bubbles, comments, sidebar)
//   label          - a pill "★ Professor" where there's room
export default function ProfessorBadge({ size = 14, label = false, className = '', title = 'Professor' }) {
  const seal = size + 4
  return (
    <span className={`prof-badge${label ? ' prof-badge--pill' : ''}${className ? ' ' + className : ''}`} title={title} aria-label={title}>
      <span className="prof-badge-seal" style={{ width: seal, height: seal }}>
        <Star size={Math.round(size * 0.64)} fill="currentColor" strokeWidth={0} />
      </span>
      {label && <span className="prof-badge-label">Professor</span>}
    </span>
  )
}
