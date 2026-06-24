import React, { useState, useEffect } from 'react'
import { Fingerprint, ShieldCheck, AlertCircle } from 'lucide-react'
import Modal from '@/components/primitives/Modal'
import { useUI } from '@/context/UIContext'
import { verifyPassword } from '@/utils/crypto'
import {
  isBiometricSupported, isPlatformAuthAvailable,
  isBiometricEnabled, enableBiometric, disableBiometric,
} from '@/utils/biometric'

// Enable/disable biometric (Face ID / fingerprint) quick sign-in on THIS device.
// Enabling stores the student's password AES-encrypted, unlocked by a biometric
// assertion at the login screen. Password sign-in always remains as fallback.
export default function BiometricSetupModal({ student, onClose }) {
  const { toast } = useUI()
  const [available, setAvailable] = useState(null) // null = checking
  const [enabled, setEnabled] = useState(isBiometricEnabled())
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const ok = isBiometricSupported() && await isPlatformAuthAvailable()
      if (alive) setAvailable(ok)
    })()
    return () => { alive = false }
  }, [])

  async function handleEnable() {
    setErr('')
    if (!pass) { setErr('Enter your password to confirm.'); return }
    setBusy(true)
    try {
      const stored = student?.account?.pass
      if (stored) {
        const ok = await verifyPassword(pass, stored)
        if (!ok) { setErr('Incorrect password.'); setBusy(false); return }
      }
      await enableBiometric({ snum: student.id, name: student.name, password: pass })
      setEnabled(true)
      setPass('')
      toast('Face ID / fingerprint sign-in enabled on this device.', 'green')
    } catch (e) {
      setErr(e?.message || 'Could not enable biometric sign-in.')
    } finally {
      setBusy(false)
    }
  }

  function handleDisable() {
    disableBiometric()
    setEnabled(false)
    toast('Biometric sign-in turned off on this device.', 'dark')
  }

  return (
    <Modal onClose={onClose} size="md">
      <h3 className="text-lg font-bold text-ink mb-1">
        <Fingerprint size={18} className="inline-block mr-1 align-text-bottom" />Face ID / Fingerprint Sign-in
      </h3>
      <p className="modal-sub mb-3">Skip typing your password next time on this device. Your password stays the fallback.</p>

      {available === false && (
        <div className="px-3 py-2.5 rounded-lg text-sm" style={{ background: 'var(--yellow-l)', color: 'var(--gold-var, #92400e)' }}>
          <AlertCircle size={14} className="inline-block mr-1 align-text-bottom" />
          This device or browser doesn’t offer a built-in biometric (Face ID / fingerprint / Windows Hello), or you’re not on a secure (HTTPS) connection.
        </div>
      )}

      {available && enabled && (
        <>
          <div className="px-3 py-2.5 rounded-lg text-sm mb-3" style={{ background: 'var(--green-l)', color: 'var(--green)' }}>
            <ShieldCheck size={14} className="inline-block mr-1 align-text-bottom" />
            Biometric sign-in is <strong>on</strong> for this device.
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-danger" onClick={handleDisable}>Turn off on this device</button>
          </div>
        </>
      )}

      {available && !enabled && (
        <>
          <div className="field mb-2">
            <label className="text-xs font-semibold text-ink2" style={{ display: 'block', marginBottom: 4 }}>Confirm your password</label>
            <input
              className="input w-full" type="password" autoComplete="current-password"
              placeholder="Your AcadFlow password" value={pass}
              onChange={e => { setPass(e.target.value); setErr('') }}
              onKeyDown={e => { if (e.key === 'Enter') handleEnable() }}
            />
          </div>
          {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
          <p className="text-xs text-ink3 mt-1">After enabling, you’ll be asked for Face ID / fingerprint. Anyone who can unlock this device with their biometric could then sign in — only enable it on a device that’s yours.</p>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleEnable} disabled={busy || !pass}>
              {busy ? 'Enabling…' : <><Fingerprint size={14} className="inline-block mr-1" />Enable</>}
            </button>
          </div>
        </>
      )}

      {available === null && <p className="text-sm text-ink3">Checking device support…</p>}
    </Modal>
  )
}
