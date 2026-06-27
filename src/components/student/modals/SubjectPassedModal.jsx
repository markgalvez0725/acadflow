import React from 'react'
import { createPortal } from 'react-dom'
import { Trophy, X } from 'lucide-react'
import { subjectColor } from '@/utils/subjectColor'

// Celebratory overlay shown once when a student passes a subject. Confetti is
// pure CSS (respects prefers-reduced-motion via the global motion guard).
const CONFETTI = Array.from({ length: 28 })

export default function SubjectPassedModal({ subject, eq, studentName, remaining = 0, onClose }) {
  const col = subjectColor(subject).color
  const first = (studentName || '').split(',').pop()?.trim().split(/\s+/)[0] || ''

  return createPortal(
    <div className="passed-overlay" role="dialog" aria-modal="true" aria-label={`You passed ${subject}`}>
      <div className="passed-confetti" aria-hidden="true">
        {CONFETTI.map((_, i) => (
          <span key={i} className="passed-bit" style={{
            left: `${(i * 37) % 100}%`,
            background: ['var(--accent)', 'var(--green)', 'var(--yellow)', 'var(--purple)', col][i % 5],
            animationDelay: `${(i % 10) * 0.12}s`,
            animationDuration: `${2.4 + (i % 5) * 0.35}s`,
          }} />
        ))}
      </div>

      <div className="passed-card">
        <button className="passed-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <div className="passed-trophy" style={{ color: col }}><Trophy size={40} /></div>
        <div className="passed-eyebrow">Congratulations{first ? `, ${first}` : ''}! 🎉</div>
        <h3 className="passed-title">You passed</h3>
        <div className="passed-subject" style={{ color: col }}>{subject}</div>
        {eq && eq !== '-' && <div className="passed-eq">Final grade: <strong>{eq}</strong></div>}
        <p className="passed-msg">Hard work pays off. Keep up the great momentum!</p>
        <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 4 }}>
          {remaining > 0 ? `Next (${remaining} more)` : 'Awesome!'}
        </button>
      </div>
    </div>,
    document.body
  )
}
