import React, { useState } from 'react'
import Modal from '@/components/primitives/Modal'
import LoadingButton from '@/components/primitives/LoadingButton'
import PinBoxes from '@/components/primitives/PinBoxes'
import { useAuth } from '@/context/AuthContext'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'

/**
 * Modal for setting or changing the admin recovery PIN.
 * If a PIN is already set, requires the current PIN before allowing a new one.
 *
 * Props:
 *  - onClose {function}
 */
export default function SetPinModal({ onClose }) {
  const { hashPassword, verifyPassword } = useAuth()
  const { admin, saveAdmin } = useData()
  const { toast } = useUI()

  const hasPin = Boolean(admin?.resetPin)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin]         = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [loading, setLoading]       = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()

    if (hasPin && currentPin.length < 4) {
      toast('Enter your current 4-digit PIN.', 'warn'); return
    }
    if (newPin.length < 4) {
      toast('New PIN must be exactly 4 digits.', 'warn'); return
    }
    if (newPin !== confirmPin) {
      toast('PINs do not match.', 'error'); return
    }

    setLoading(true)
    try {
      if (hasPin) {
        const ok = await verifyPassword(currentPin, admin.resetPin)
        if (!ok) { toast('Current PIN is incorrect.', 'error'); return }
      }
      const hashed = await hashPassword(newPin)
      await saveAdmin({ ...admin, resetPin: hashed })
      toast('Recovery PIN saved.', 'success')
      onClose()
    } catch (err) {
      toast('Failed to save PIN: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-header">
        <h2 className="modal-title">{hasPin ? 'Change Recovery PIN' : 'Set Recovery PIN'}</h2>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <p className="text-sm text-ink2 mb-4">
            The recovery PIN lets you reset the admin password without email access.
          </p>

          {hasPin && (
            <div className="mb-2">
              <label className="form-label">Current PIN</label>
              <PinBoxes value={currentPin} onChange={setCurrentPin} disabled={loading} />
            </div>
          )}

          <div className="mb-2">
            <label className="form-label">New PIN</label>
            <PinBoxes value={newPin} onChange={setNewPin} disabled={loading} />
          </div>

          <div>
            <label className="form-label">Confirm New PIN</label>
            <PinBoxes value={confirmPin} onChange={setConfirmPin} disabled={loading} />
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <LoadingButton loading={loading} loadingText="Saving…" className="btn btn-primary">
            Save PIN
          </LoadingButton>
        </div>
      </form>
    </Modal>
  )
}
