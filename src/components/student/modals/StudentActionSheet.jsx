import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, KeyRound, LogOut, Bell, BellRing, Lock, Fingerprint, ScanFace, Palette, ChevronRight } from 'lucide-react'
import { isBiometricSupported } from '@/utils/biometric'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { studentStanding } from '@/utils/groupChat'

/**
 * Slide-up settings sheet for the student portal — grouped (Facebook/Instagram
 * style) into Account · Security and sign-in · Notifications · Appearance, with
 * Log out separated at the bottom. Renders via createPortal to escape z-index
 * stacking. Every row delegates to the same handlers the layout already wires
 * up — only the presentation changed, not what each action does.
 *
 * Props:
 *  - open {boolean} · onClose {fn}
 *  - onEditProfile · onChangePassword · onNotifPrefs · onSetPin · onBiometric
 *    · onFaceReset · onLogout {fn}
 *  - student {object} — current student (name/photo/standing)
 *  - push {object} — push-notification controller
 */
export default function StudentActionSheet({
  open,
  onClose,
  onEditProfile,
  onChangePassword,
  onNotifPrefs,
  onSetPin,
  onBiometric,
  onFaceReset,
  onLogout,
  student,
  push,
}) {
  const sheetRef = useRef(null)
  const { theme, toggleTheme } = useUI()
  const { classes = [] } = useData()

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

  const faceOn = !!student?.account?.faceResetEnabled
  const pushOn = push?.permission === 'granted'

  const groups = [
    {
      title: 'Account',
      rows: [
        { label: 'Edit profile', sub: 'Name, photo, contact details', Icon: Pencil, onClick: () => { onClose(); onEditProfile?.() } },
        { label: 'Change password', sub: 'Update your password', Icon: KeyRound, onClick: () => { onClose(); onChangePassword?.() } },
      ],
    },
    {
      title: 'Security and sign-in',
      rows: [
        { label: 'App lock PIN', sub: 'Lock the app with a 4-digit PIN', Icon: Lock, onClick: () => { onClose(); onSetPin?.() } },
        ...(isBiometricSupported() ? [{
          label: 'Face ID / fingerprint', sub: 'Quick biometric sign-in', Icon: Fingerprint,
          onClick: () => { onClose(); onBiometric?.() },
        }] : []),
        {
          label: faceOn ? 'Face ID password reset' : 'Set up Face ID reset',
          sub: faceOn ? 'Reset is on — tap to manage' : 'Reset your password by face match',
          Icon: ScanFace,
          onClick: () => { onClose(); onFaceReset?.() },
        },
      ],
    },
    {
      title: 'Notifications',
      rows: [
        ...(push?.supported ? [{
          label: pushOn ? 'Notifications on' : push.busy ? 'Enabling…' : 'Enable push notifications',
          sub: pushOn ? 'Alerts on this device are on' : 'Get alerts on this device',
          Icon: pushOn ? BellRing : Bell,
          onClick: () => { if (!pushOn) push.enable?.() },
        }] : []),
        { label: 'Notification preferences', sub: 'Choose which alerts you get', Icon: Bell, onClick: () => { onClose(); onNotifPrefs?.() } },
      ],
    },
  ]

  const idLine = (() => {
    const snum = student?.snum || student?.id
    const tag = studentStanding(student, classes)
    return tag && tag !== snum ? `${tag} · ${snum}` : snum
  })()

  const segBtn = active => ({
    padding: '5px 12px', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent-l)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--ink3)',
  })

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 800, animation: 'fadeIn .18s ease' }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 801,
          background: 'var(--surface)', borderRadius: '18px 18px 0 0',
          maxHeight: '88vh', overflowY: 'auto',
          padding: '12px 0 calc(env(safe-area-inset-bottom) + 16px)',
          boxShadow: '0 -4px 24px rgba(0,0,0,.18)',
          animation: 'sheetSlideUp .22s cubic-bezier(.22,.8,.38,1) both',
        }}
      >
        {/* Handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 12px' }} />

        {/* Student identity */}
        {student && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 20px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--c-royal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
              {student.photo
                ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 18, color: 'var(--c-gold)', lineHeight: 1 }}>{(student.name || '?')[0].toUpperCase()}</span>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {student.name || 'Student'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{idLine}</div>
            </div>
          </div>
        )}

        {/* Grouped sections */}
        <div style={{ padding: '14px 16px 4px' }}>
          {groups.map(g => (
            <div key={g.title} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--ink3)', margin: '0 0 6px 4px' }}>{g.title}</div>
              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {g.rows.map((row, i) => (
                  <button
                    key={row.label}
                    className="sas-row"
                    onClick={row.onClick}
                    style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
                  >
                    <span className="sas-ico"><row.Icon size={17} /></span>
                    <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{row.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>{row.sub}</span>
                    </span>
                    <ChevronRight size={18} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Appearance — inline theme toggle */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--ink3)', margin: '0 0 6px 4px' }}>Appearance</div>
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px' }}>
                <span className="sas-ico"><Palette size={17} /></span>
                <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Theme</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>Light or dark mode</span>
                </span>
                <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
                  <button onClick={() => { if (theme !== 'light') toggleTheme() }} style={segBtn(theme === 'light')}>Light</button>
                  <button onClick={() => { if (theme !== 'dark') toggleTheme() }} style={segBtn(theme === 'dark')}>Dark</button>
                </div>
              </div>
            </div>
          </div>

          {/* Log out */}
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 4 }}>
            <button className="sas-row" onClick={() => { onClose(); onLogout?.() }}>
              <span className="sas-ico" style={{ background: 'rgba(239,68,68,.12)', color: '#ef4444' }}><LogOut size={17} /></span>
              <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#ef4444' }}>Log out</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>Sign out of this device</span>
              </span>
            </button>
          </div>
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
        .sas-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 13px; background: none; border: none; cursor: pointer; transition: background .12s }
        .sas-row:hover { background: var(--bg2) }
        .sas-ico { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: var(--accent-l); color: var(--accent); flex-shrink: 0 }
      `}</style>
    </>,
    document.body
  )
}
