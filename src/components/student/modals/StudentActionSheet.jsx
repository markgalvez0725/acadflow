import React from 'react'
import { Pencil, KeyRound, LogOut, Bell, BellRing, Lock, Fingerprint, ScanFace, Palette } from 'lucide-react'
import { isBiometricSupported } from '@/utils/biometric'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { studentStanding } from '@/utils/groupChat'
import SettingsShell from '@/components/primitives/SettingsShell'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import EditProfileModal from './EditProfileModal'
import NotifPrefsModal from './NotifPrefsModal'

/**
 * Student settings — now driven by the shared SettingsShell so it matches the
 * admin side and behaves natively across viewports: a full-height push-nav sheet
 * on mobile, master-detail on tablet/desktop.
 *
 * Two simple panels (Edit profile, Notification preferences) drill in IN PLACE
 * via the modals' `embedded` mode. The camera/WebAuthn flows (PIN, biometric,
 * Face-ID reset) and the reauth password change stay as actions that launch
 * their own dedicated modals — they're delegated to the handlers the layout
 * already wires up. Only the presentation changed, not what each action does.
 *
 * Props:
 *  - open {boolean} · onClose {fn}
 *  - onChangePassword · onSetPin · onBiometric · onFaceReset · onCompleteSetup
 *    · onLogout {fn}
 *  - student {object} — current student (name/photo/standing)
 *  - push {object} — push-notification controller
 */
export default function StudentActionSheet({
  open,
  onClose,
  onChangePassword,
  onSetPin,
  onBiometric,
  onFaceReset,
  onCompleteSetup,
  onLogout,
  student,
  push,
}) {
  const { theme, toggleTheme } = useUI()
  const { classes = [] } = useData()

  if (!open) return null

  const faceOn = !!student?.account?.faceResetEnabled
  const pushOn = push?.permission === 'granted'

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

  const themeControl = (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
      <button onClick={() => { if (theme !== 'light') toggleTheme() }} style={segBtn(theme === 'light')}>Light</button>
      <button onClick={() => { if (theme !== 'dark') toggleTheme() }} style={segBtn(theme === 'dark')}>Dark</button>
    </div>
  )

  const identity = student && (
    <div className="sset-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
          {student.photo
            ? <img src={student.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{(student.name || '?')[0].toUpperCase()}</span>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {student.name || 'Student'}
            </span>
            <VerifiedBadge student={student} size={15} showPendingLabel onPendingClick={() => { onClose?.(); onCompleteSetup?.() }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{idLine}</div>
        </div>
      </div>
    </div>
  )

  const groups = [
    { title: 'Account', rows: [
      { id: 'profile', Icon: Pencil, label: 'Edit profile', sub: 'Name, photo, contact details',
        panel: ({ onDone }) => <EditProfileModal embedded student={student} onClose={onDone} /> },
      { id: 'password', Icon: KeyRound, label: 'Change password', sub: 'Update your password',
        onClick: () => { onClose?.(); onChangePassword?.() } },
    ] },
    { title: 'Security and sign-in', rows: [
      { id: 'pin', Icon: Lock, label: 'App lock PIN', sub: 'Lock the app with a 4-digit PIN',
        onClick: () => { onClose?.(); onSetPin?.() } },
      ...(isBiometricSupported() ? [{
        id: 'bio', Icon: Fingerprint, label: 'Face ID / fingerprint', sub: 'Quick biometric sign-in',
        onClick: () => { onClose?.(); onBiometric?.() },
      }] : []),
      { id: 'face', Icon: ScanFace,
        label: faceOn ? 'Face ID password reset' : 'Set up Face ID reset',
        sub: faceOn ? 'Reset is on — tap to manage' : 'Reset your password by face match',
        onClick: () => { onClose?.(); onFaceReset?.() } },
    ] },
    { title: 'Notifications', rows: [
      ...(push?.supported ? [{
        id: 'push', Icon: pushOn ? BellRing : Bell,
        label: pushOn ? 'Notifications on' : push.busy ? 'Enabling…' : 'Enable push notifications',
        sub: pushOn ? 'Alerts on this device are on' : 'Get alerts on this device',
        onClick: () => { if (!pushOn) push.enable?.() },
      }] : []),
      { id: 'npref', Icon: Bell, label: 'Notification preferences', sub: 'Choose which alerts you get',
        panel: ({ onDone }) => <NotifPrefsModal embedded student={student} onClose={onDone} /> },
    ] },
    { title: 'Appearance', rows: [
      { id: 'theme', Icon: Palette, label: 'Theme', sub: 'Light or dark mode', control: themeControl },
    ] },
  ]

  const footer = (
    <div className="sset-card" style={{ marginBottom: 4 }}>
      <button type="button" className="sset-row" onClick={() => { onClose?.(); onLogout?.() }}>
        <span className="sset-ico" style={{ background: 'rgba(239,68,68,.12)', color: '#ef4444' }}><LogOut size={17} /></span>
        <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#ef4444' }}>Log out</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', marginTop: 1 }}>Sign out of this device</span>
        </span>
      </button>
    </div>
  )

  return (
    <SettingsShell
      open={open}
      onClose={onClose}
      title="Settings"
      identity={identity}
      groups={groups}
      footer={footer}
    />
  )
}
