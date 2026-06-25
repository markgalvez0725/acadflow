import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ShieldCheck } from 'lucide-react'

// Brief celebratory panel shown once a teacher-provisioned student finishes
// onboarding (password change + profile completion). Their account is verified,
// so this confirms it and auto-dismisses after 5 seconds. Reuses the shared
// `.passed-*` overlay styles for a consistent celebratory look.
const CONFETTI = Array.from({ length: 24 })

export default function AccountVerifiedModal({ studentName, onClose }) {
  const first = (studentName || '').split(',').pop()?.trim().split(/\s+/)[0] || ''

  // Auto-dismiss after 5 seconds (the student can also tap to continue sooner).
  useEffect(() => {
    const t = setTimeout(() => onClose?.(), 5000)
    return () => clearTimeout(t)
  }, [onClose])

  return createPortal(
    <div className="passed-overlay" role="dialog" aria-modal="true" aria-label="Account verified">
      <div className="passed-confetti" aria-hidden="true">
        {CONFETTI.map((_, i) => (
          <span key={i} className="passed-bit" style={{
            left: `${(i * 41) % 100}%`,
            background: ['var(--accent)', 'var(--green)', 'var(--yellow)', 'var(--purple)'][i % 4],
            animationDelay: `${(i % 10) * 0.12}s`,
            animationDuration: `${2.4 + (i % 5) * 0.35}s`,
          }} />
        ))}
      </div>

      <div className="passed-card" style={{ textAlign: 'center' }}>
        <div className="passed-trophy" style={{ color: 'var(--green)' }}><ShieldCheck size={44} /></div>
        <div className="passed-eyebrow">Welcome{first ? `, ${first}` : ''}! 🎉</div>
        <h3 className="passed-title" style={{ color: 'var(--green)' }}>Account Verified!</h3>
        <p className="passed-msg">You may now explore the AcadFlow app.</p>
        <button className="btn btn-primary" onClick={onClose} style={{ marginTop: 4 }}>Let’s go</button>
      </div>
    </div>,
    document.body
  )
}
