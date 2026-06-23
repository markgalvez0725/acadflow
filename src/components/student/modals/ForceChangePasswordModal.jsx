import React, { useState, useEffect, useRef } from 'react'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { getFbAuth } from '@/firebase/firebaseInit'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { KeyRound, AlertTriangle, Check, X } from 'lucide-react'

// Voluntary password change for the signed-in student. Uses Firebase Auth:
// reauthenticate with the current password, then update to the new one.
export default function ForceChangePasswordModal({ student: s, onClose, forced = false }) {
  const { toast } = useUI()
  const { markAccountActive } = useData()

  const [oldPass, setOldPass] = useState('')
  const [pass,    setPass]    = useState('')
  const [pass2,   setPass2]   = useState('')
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100) }, [])

  async function handleSubmitPassword() {
    setError('')
    if (!oldPass) { setError('Please enter your current password.'); return }
    if (pass.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) { setError('Password must include at least one uppercase letter and one number.'); return }
    if (oldPass === pass) { setError('New password must be different from your current password.'); return }
    if (pass !== pass2) { setError('Passwords do not match.'); return }

    const auth = getFbAuth()
    const user = auth?.currentUser
    if (!user) { setError('Your session expired. Please sign in again.'); return }

    setSaving(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, oldPass)
      try {
        await reauthenticateWithCredential(user, cred)
      } catch (e) {
        setSaving(false)
        return setError('Your current password is incorrect.')
      }
      await updatePassword(user, pass)
      // The student now owns their password → promote the account to Active
      // (clears the teacher-set temporary-password flag). Idempotent & best-effort.
      try { await markAccountActive?.(s.id) } catch (e) { /* non-fatal */ }
      toast('Password changed successfully!', 'success')
      onClose()
    } catch (e) {
      setError('Failed to change password: ' + (e?.message || 'unknown error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,50,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' }}>
      <div role="dialog" aria-modal="true" aria-label="Change password" style={{ background: 'var(--surface)', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ marginBottom: 8, color: 'var(--accent)' }}><KeyRound size={40} style={{ display: 'inline-block' }} /></div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 6 }}>Change your password</h3>
          <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
            Enter your current password, then choose a new one.
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
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Confirm password</label>
          <input
            type="password"
            className="input"
            placeholder="Repeat your new password"
            value={pass2}
            onChange={e => setPass2(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 700 }}
          onClick={handleSubmitPassword}
          disabled={saving}
        >
          {saving ? 'Saving…' : <><Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Change password</>}
        </button>

        <button
          className="btn"
          style={{ width: '100%', padding: 10, fontSize: 14, marginTop: 8 }}
          onClick={onClose}
          disabled={saving}
        >
          <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Cancel
        </button>
      </div>
    </div>
  )
}
