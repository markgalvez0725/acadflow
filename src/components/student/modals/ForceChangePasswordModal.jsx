import React, { useState, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { useUI } from '@/context/UIContext'
import { hashPassword, verifyPassword } from '@/utils/crypto'
import { KeyRound, AlertTriangle, Check, X } from 'lucide-react'

export default function ForceChangePasswordModal({ student: s, onClose, forced = false }) {
  const { students, saveStudents } = useData()
  const { setCurrentStudent } = useAuth()
  const { toast } = useUI()

  const [oldPass, setOldPass] = useState('')
  const [pass,    setPass]    = useState('')
  const [pass2,   setPass2]   = useState('')
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  async function handleSubmit() {
    setError('')

    if (!forced) {
      if (!oldPass) { setError('Please enter your current password.'); return }
      const match = await verifyPassword(oldPass, s.account?.pass)
      if (!match) { setError('Current password is incorrect.'); return }
      if (oldPass === pass) { setError('New password must be different from your current password.'); return }
    }

    if (pass.length < 8)                             { setError('Password must be at least 8 characters.'); return }
    if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) { setError('Password must include at least one uppercase letter and one number.'); return }
    if (pass !== pass2)                              { setError('Passwords do not match.'); return }

    setSaving(true)
    try {
      const hashed = await hashPassword(pass)
      const updatedStudents = students.map(x => {
        if (x.id !== s.id) return x
        const updated = { ...x }
        if (!updated.account) updated.account = {}
        updated.account = { ...updated.account, pass: hashed }
        delete updated.account._tempPass
        delete updated.forceChangePassword
        return updated
      })
      await saveStudents(updatedStudents, [s.id])
      const updated = updatedStudents.find(x => x.id === s.id)
      if (updated) setCurrentStudent(updated)
      toast('✅ Password updated successfully!', 'success')
      onClose()
    } catch (e) {
      setError('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,50,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 20, padding: '28px 24px', width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0,0,0,.3)' }}>

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ marginBottom: 8, color: 'var(--accent)' }}><KeyRound size={40} style={{ display: 'inline-block' }} /></div>
          <h3 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.2rem', marginBottom: 6 }}>Change Your Password</h3>
          <p style={{ fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
            {forced
              ? 'Your account was set up with a temporary password. Please choose a personal password before continuing.'
              : 'Enter your current password, then choose a new one.'}
          </p>
        </div>

        {forced && (
          <div style={{ background: 'var(--yellow-l)', border: '1px solid var(--yellow)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--yellow)', fontWeight: 600 }}>
            <AlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />You cannot skip this step. Your temporary password will be replaced.
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'var(--red-l)', borderRadius: 8, borderLeft: '3px solid var(--red)' }}>
            {error}
          </div>
        )}

        {!forced && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Current Password</label>
            <input
              ref={inputRef}
              type="password"
              className="input"
              placeholder="Your current password"
              value={oldPass}
              onChange={e => setOldPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>New Password</label>
          <input
            ref={forced ? inputRef : undefined}
            type="password"
            className="input"
            placeholder="Min. 8 chars, 1 uppercase, 1 number"
            value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink2)', marginBottom: 5 }}>Confirm Password</label>
          <input
            type="password"
            className="input"
            placeholder="Repeat your new password"
            value={pass2}
            onChange={e => setPass2(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 700 }}
          onClick={handleSubmit}
          disabled={saving}
        >
          {saving ? 'Saving…' : <><Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Set My Password</>}
        </button>

        {!forced && (
          <button
            className="btn"
            style={{ width: '100%', padding: 10, fontSize: 14, marginTop: 8 }}
            onClick={onClose}
            disabled={saving}
          >
            <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Cancel
          </button>
        )}
      </div>
    </div>
  )
}
