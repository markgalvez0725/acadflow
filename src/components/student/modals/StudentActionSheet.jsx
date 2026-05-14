import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, KeyRound, LogOut } from 'lucide-react'

/**
 * Slide-up action sheet for the student portal.
 * Renders via createPortal to escape z-index stacking.
 *
 * Props:
 *  - open         {boolean}
 *  - onClose      {function}
 *  - onEditProfile    {function}
 *  - onChangePassword {function}
 *  - onLogout         {function}
 *  - student      {object}   — current student, used to display name/photo
 */
export default function StudentActionSheet({
  open,
  onClose,
  onEditProfile,
  onChangePassword,
  onLogout,
  student,
}) {
  const sheetRef = useRef(null)

  // Trap back-button / Escape key
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const actions = [
    {
      label: 'Edit Profile',
      Icon: Pencil,
      onClick: () => { onClose(); onEditProfile?.() },
    },
    {
      label: 'Change Password',
      Icon: KeyRound,
      onClick: () => { onClose(); onChangePassword?.() },
    },
    {
      label: 'Log Out',
      Icon: LogOut,
      onClick: () => { onClose(); onLogout?.() },
      danger: true,
    },
  ]

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.45)',
          zIndex: 800,
          animation: 'fadeIn .18s ease',
        }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 801,
          background: 'var(--surface)',
          borderRadius: '18px 18px 0 0',
          padding: '12px 0 calc(env(safe-area-inset-bottom) + 12px)',
          boxShadow: '0 -4px 24px rgba(0,0,0,.18)',
          animation: 'sheetSlideUp .22s cubic-bezier(.22,.8,.38,1) both',
        }}
      >
        {/* Handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'var(--border)', margin: '0 auto 12px',
        }} />

        {/* Student identity */}
        {student && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 20px 14px', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--c-royal)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexShrink: 0, overflow: 'hidden',
            }}>
              {student.photo
                ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 18, color: 'var(--c-gold)', lineHeight: 1 }}>
                    {(student.name || '?')[0].toUpperCase()}
                  </span>
              }
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {student.name || 'Student'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                {student.snum || student.id}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '8px 0' }}>
          {actions.map(action => (
            <button
              key={action.label}
              onClick={action.onClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                width: '100%',
                padding: '13px 20px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: 500,
                color: action.danger ? '#ef4444' : 'var(--ink)',
                textAlign: 'left',
                transition: 'background .12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
            >
              <action.Icon size={18} />
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes sheetSlideUp {
          from { transform: translateY(100%); opacity: 0 }
          to   { transform: translateY(0);    opacity: 1 }
        }
        @keyframes fadeIn {
          from { opacity: 0 }
          to   { opacity: 1 }
        }
      `}</style>
    </>,
    document.body
  )
}
