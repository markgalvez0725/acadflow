import React, { useRef } from 'react'
import { Pencil, KeyRound, LogOut, Bell, BellRing, Lock, Fingerprint, ScanFace, Palette, ShieldCheck, Info } from 'lucide-react'
import AboutPanel from '@/components/primitives/AboutPanel'
import { APP_VERSION } from '@/constants/changelog'
import { isBiometricSupported } from '@/utils/biometric'
import { accountStatusKey } from '@/utils/accountStatus'
import { verifyBannerSub } from '@/utils/verificationGuide'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { studentStanding } from '@/utils/groupChat'
import SettingsShell from '@/components/primitives/SettingsShell'
import VerifiedBadge from '@/components/primitives/VerifiedBadge'
import VerificationCenter from './VerificationCenter'
import EditProfileModal from './EditProfileModal'
import NotifPrefsModal from './NotifPrefsModal'
import ForceChangePasswordModal from './ForceChangePasswordModal'
import SetQuickPinModal from './SetQuickPinModal'
import BiometricSetupModal from './BiometricSetupModal'
import FaceEnrollModal from './FaceEnrollModal'

/**
 * Student settings - now driven by the shared SettingsShell so it matches the
 * admin side and behaves natively across viewports: a full-height push-nav sheet
 * on mobile, master-detail on tablet/desktop.
 *
 * EVERY settings row drills in IN PLACE via the modals' `embedded` mode - edit
 * profile, change password, app-lock PIN, biometric, Face-ID reset, and notif
 * preferences all render as panels inside the shell (the camera/WebAuthn/reauth
 * logic is unchanged; only their Modal chrome is swapped for the shell's). The
 * push-enable row stays an instant action (it just triggers a permission prompt,
 * there's no screen to show). Pending-badge + logout are actions.
 *
 * While the account isn't fully Active, a pinned "Get verified" banner appears at
 * the top and drills into the guided VerificationCenter (password → profile →
 * identity → Face ID → verified badge). `initialView="getverified"` deep-links
 * straight into it (used by the auto-open-on-load redirect).
 *
 * Props:
 *  - open {boolean} · onClose {fn}
 *  - onContact · onLogout {fn}
 *  - student {object} - current student (name/photo/standing)
 *  - push {object} - push-notification controller
 *  - initialView {string} - panel id to open straight into ('home' by default)
 */
export default function StudentActionSheet({
  open,
  onClose,
  onContact,
  onLogout,
  student,
  push,
  initialView = 'home',
}) {
  const { theme, toggleTheme } = useUI()
  const { classes = [] } = useData()
  // Latch the "Get verified" banner for the whole time the sheet is open: when the
  // account flips to Active mid-flow the live flag drops, but we must keep the
  // panel mounted so the VerificationCenter can show its congratulatory screen.
  const verifyLatchRef = useRef(false)

  if (!open) { verifyLatchRef.current = false; return null }

  const faceOn = !!student?.account?.faceResetEnabled
  const pushOn = push?.permission === 'granted'
  if (student?.account?.registered && accountStatusKey(student) !== 'active') verifyLatchRef.current = true
  const needsVerify = verifyLatchRef.current

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
            <VerifiedBadge student={student} size={15} showPendingLabel />
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{idLine}</div>
        </div>
      </div>
    </div>
  )

  const groups = [
    // Pinned "Get verified" banner - only while the account isn't fully Active.
    ...(needsVerify ? [{ title: null, rows: [
      { id: 'getverified', tone: 'accent', Icon: ShieldCheck, label: 'Get verified', sub: verifyBannerSub(student),
        panel: () => <VerificationCenter student={student} onDone={() => onClose?.()} onContact={() => { onClose?.(); onContact?.() }} /> },
    ] }] : []),
    { title: 'Account', rows: [
      { id: 'profile', Icon: Pencil, label: 'Edit profile', sub: 'Name, photo, contact details',
        panel: ({ onDone }) => <EditProfileModal embedded student={student} onClose={onDone} /> },
      { id: 'password', Icon: KeyRound, label: 'Change password', sub: 'Update your password',
        panel: ({ onDone }) => <ForceChangePasswordModal embedded student={student} onClose={onDone} /> },
    ] },
    { title: 'Security and sign-in', rows: [
      { id: 'pin', Icon: Lock, label: 'App lock PIN', sub: 'Lock the app with a 4-digit PIN',
        panel: ({ onDone }) => <SetQuickPinModal embedded onClose={onDone} /> },
      ...(isBiometricSupported() ? [{
        id: 'bio', Icon: Fingerprint, label: 'Face ID / fingerprint', sub: 'Quick biometric sign-in',
        panel: ({ onDone }) => <BiometricSetupModal embedded student={student} onClose={onDone} />,
      }] : []),
      { id: 'face', Icon: ScanFace,
        label: faceOn ? 'Face ID password reset' : 'Set up Face ID reset',
        sub: faceOn ? 'Reset is on - tap to manage' : 'Reset your password by face match',
        panel: ({ onDone }) => <FaceEnrollModal embedded student={student} onClose={onDone} /> },
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
    { title: 'About', rows: [
      { id: 'about', Icon: Info, label: 'About AcadFlow', sub: `Version ${APP_VERSION} · what's new`, panel: () => <AboutPanel /> },
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
      initialView={initialView}
    />
  )
}
