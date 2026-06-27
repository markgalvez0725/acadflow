import React, { useState, useEffect, useRef } from 'react'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { getFbAuth } from '@/firebase/firebaseInit'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { KeyRound, Check, X, ChevronLeft } from 'lucide-react'
import FieldCheck from '@/components/primitives/FieldCheck'
import { checkNewPassword, checkMatch } from '@/utils/settingsVerify'

// Voluntary password change for the signed-in student. Uses Firebase Auth:
// reauthenticate with the current password, then update to the new one.
export default function ForceChangePasswordModal({ student: s, onClose, forced = false }) {
  const { toast } = useUI()
  const { students, saveStudents } = useData()
  const { logout } = useAuth()

  const [oldPass, setOldPass] = useState('')
  const [pass,    setPass]    = useState('')
  const [pass2,   setPass2]   = useState('')
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)
  // True once the Firebase Auth password is changed but the account-status write
  // hasn't confirmed yet — lets the user retry the sync WITHOUT re-doing (and
  // failing) the one-time password change.
  const [pwDone, setPwDone] = useState(false)
  const pwChangedRef = useRef(false)
  const inputRef = useRef(null)

  // On-device smart check — kept in lockstep with the rules handleSubmitPassword
  // enforces. Passwords never auto-save (security): these only guide + gate.
  const newChk   = checkNewPassword(pass, { current: oldPass })
  const matchChk = checkMatch(pass, pass2)
  const blocked  = !pwDone && (newChk.state !== 'ok' || matchChk.state !== 'ok' || !oldPass)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100) }, [])

  // Clear the temporary-password flag in Firebase. This MUST land, or the forced
  // prompt returns on the next sign-in. We write through saveStudents DIRECTLY
  // (not the idempotent markAccountActive) so every retry genuinely re-hits
  // Firestore — saveStudents updates local state optimistically, so an
  // idempotency check would otherwise short-circuit a retry after a failed write.
  async function persistActive() {
    let lastErr
    for (let i = 0; i < 3; i++) {
      try {
        const base = students.find(x => x.id === s.id) || s
        const patched = { ...base, account: { ...(base.account || {}), registered: true, activated: true, _tempPass: false } }
        const updated = students.some(x => x.id === s.id)
          ? students.map(x => (x.id === s.id ? patched : x))
          : [...students, patched]
        await saveStudents(updated, [s.id])
        return
      } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 500)) }
    }
    throw lastErr || new Error('Could not save account status.')
  }

  async function handleSubmitPassword() {
    setError('')
    if (!pwChangedRef.current) {
      if (!oldPass) { setError('Please enter your current password.'); return }
      if (pass.length < 8) { setError('Password must be at least 8 characters.'); return }
      if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) { setError('Password must include at least one uppercase letter and one number.'); return }
      if (oldPass === pass) { setError('New password must be different from your current password.'); return }
      if (pass !== pass2) { setError('Passwords do not match.'); return }
    }

    const auth = getFbAuth()
    const user = auth?.currentUser
    if (!user) { setError('Your session expired. Please sign in again.'); return }

    setSaving(true)
    try {
      if (!pwChangedRef.current) {
        const cred = EmailAuthProvider.credential(user.email, oldPass)
        try {
          await reauthenticateWithCredential(user, cred)
        } catch (e) {
          setSaving(false)
          return setError('Your current password is incorrect.')
        }
        await updatePassword(user, pass)
        // Auth password is now changed — never re-run it (a retry would fail on
        // "new must differ from current"). Only the status sync below may retry.
        pwChangedRef.current = true
        setPwDone(true)
      }
      // Promote the account to Active (clears `_tempPass`) and confirm it persisted
      // to Firebase, so a later logout → sign-in does NOT re-prompt.
      await persistActive()
      if (forced) {
        // First-time temp-password change → sign out so the student signs in
        // cleanly with their new password (confirms it works). The _tempPass
        // clear is already persisted above, so re-login won't re-prompt.
        toast('Password set! Please sign in with your new password.', 'success')
        logout()
      } else {
        toast('Password changed successfully!', 'success')
        onClose()
      }
    } catch (e) {
      setError(pwChangedRef.current
        ? 'Your new password is saved, but syncing your account didn’t finish. Check your connection and tap “Finish” to retry.'
        : 'Failed to change password: ' + (e?.message || 'unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,50,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' }}>
      <div role="dialog" aria-modal="true" aria-label="Change password" style={{ background: 'var(--surface)', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>

        {!forced && (
          <button type="button" onClick={onClose} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink2)', fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 6 }}>
            <ChevronLeft size={16} /> Back
          </button>
        )}

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ marginBottom: 8, color: 'var(--accent)' }}><KeyRound size={40} style={{ display: 'inline-block' }} /></div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 6 }}>{forced ? 'Set your own password' : 'Change your password'}</h3>
          <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
            {forced
              ? 'Your account uses a temporary password. For your security, set your own password before continuing.'
              : 'Enter your current password, then choose a new one.'}
          </p>
        </div>

        {error && (
          <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'var(--red-l)', borderRadius: 8 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Current password</label>
          <input
            ref={inputRef}
            type="password"
            className="input"
            placeholder="Your current password"
            value={oldPass}
            disabled={pwDone}
            onChange={e => setOldPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>New password</label>
          <input
            type="password"
            className="input"
            placeholder="Min. 8 chars, 1 uppercase, 1 number"
            value={pass}
            disabled={pwDone}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
          />
          <FieldCheck result={newChk} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Confirm password</label>
          <input
            type="password"
            className="input"
            placeholder="Repeat your new password"
            value={pass2}
            disabled={pwDone}
            onChange={e => setPass2(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
          />
          <FieldCheck result={matchChk} />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 700 }}
          onClick={handleSubmitPassword}
          disabled={saving || blocked}
        >
          {saving ? 'Saving…' : <><Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{pwDone ? 'Finish' : 'Change password'}</>}
        </button>

        <button
          className="btn"
          style={{ width: '100%', padding: 10, fontSize: 14, marginTop: 8 }}
          onClick={() => { if (forced) logout(); else onClose() }}
          disabled={saving}
        >
          <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{forced ? 'Sign out instead' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
