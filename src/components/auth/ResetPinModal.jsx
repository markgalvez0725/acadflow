import React, { useState } from 'react'
import Modal from '@/components/primitives/Modal'
import LoadingButton from '@/components/primitives/LoadingButton'
import PinBoxes from '@/components/primitives/PinBoxes'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'

/**
 * Modal for resetting the admin password using the recovery PIN.
 * Used as an alternative to the email OTP flow in AdminLoginScreen.
 *
 * Props:
 *  - onClose  {function}
 *  - onReset  {function}  — called after successful password reset
 */
export default function ResetPinModal({ onClose, onReset }) {
  const { hashPassword, verifyPassword } = useAuth()
  const { admin, saveAdmin } = useData()
  const { toast } = useUI()

  const [pin, setPin]         = useState('')
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [loading, setLoading] = useState(false)

  if (!admin?.resetPin) {
    return (
      <Modal onClose={onClose}>
        <div className="modal-header">
          <h2 className="modal-title">Recovery PIN Not Set</h2>
        </div>
        <div className="modal-body">
          <p className="text-sm text-ink2">
            No recovery PIN has been configured. Use the email OTP option to reset your password,
            then set a recovery PIN in Admin Settings.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>OK</button>
        </div>
      </Modal>
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (pin.length < 4) {
      toast('Please enter your 4-digit recovery PIN.', 'warn'); return
    }
    if (newPass.length < 8) {
      toast('Password must be at least 8 characters.', 'warn'); return
    }
    if (!/[A-Z]/.test(newPass) || !/[0-9]/.test(newPass)) {
      toast('Password must include at least one uppercase letter and one number.', 'warn'); return
    }
    if (newPass !== newPass2) {
      toast('Passwords do not match.', 'error'); return
    }

    setLoading(true)
    try {
      const ok = await verifyPassword(pin, admin.resetPin)
      if (!ok) { toast('Incorrect recovery PIN.', 'error'); return }

      const hashed = await hashPassword(newPass)
      await saveAdmin({ ...admin, pass: hashed })
      toast('Password reset successfully.', 'success')
      onReset?.()
      onClose()
    } catch (err) {
      toast('Failed to reset password: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-header">
        <h2 className="modal-title">Reset via Recovery PIN</h2>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <p className="text-sm text-ink2 mb-4">
            Enter your 4-digit recovery PIN to set a new admin password.
          </p>

          <div className="mb-2">
            <label className="form-label">Recovery PIN</label>
            <PinBoxes value={pin} onChange={setPin} disabled={loading} />
          </div>

          <div className="field">
            <label>New Password</label>
            <input
              type="password"
              placeholder="Min 8 chars, 1 uppercase, 1 number"
              value={newPass}
              onChange={e => setNewPass(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="field">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={newPass2}
              onChange={e => setNewPass2(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <LoadingButton loading={loading} loadingText="Saving…" className="btn btn-primary">
            Reset Password
          </LoadingButton>
        </div>
      </form>
    </Modal>
  )
}
