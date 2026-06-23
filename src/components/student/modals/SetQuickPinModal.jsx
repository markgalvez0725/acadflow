import React, { useState } from 'react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import PinBoxes from '@/components/primitives/PinBoxes'
import { useAuth } from '@/context/AuthContext'
import { useUI } from '@/context/UIContext'
import { Lock } from 'lucide-react'

// Set / change / remove the device quick-unlock PIN. The PIN re-gates the app
// after it sits idle, so you can return without re-typing your password.
export default function SetQuickPinModal({ onClose }) {
  const { setSessionPin, clearSessionPin, sessionHasPin } = useAuth()
  const { toast } = useUI()
  const had = sessionHasPin()

  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (pin.length !== 4) { toast('Enter a 4-digit PIN.', 'warn'); return }
    if (pin !== confirm) { toast('PINs don’t match. Try again.', 'warn'); return }
    setBusy(true)
    try {
      await setSessionPin(pin)
      toast(had ? 'PIN updated.' : 'Quick-unlock PIN set.', 'green')
      onClose()
    } catch (e) {
      toast('Could not save PIN.', 'red')
    } finally { setBusy(false) }
  }

  function remove() {
    clearSessionPin()
    toast('PIN removed.', 'green')
    onClose()
  }

  return (
    <Modal onClose={onClose} size="sm">
      <ModalHeader title={had ? 'Change app lock PIN' : 'Set app lock PIN'} onClose={onClose} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, margin: '4px auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
          <Lock size={24} />
        </div>
        <p className="text-xs text-ink2" style={{ marginBottom: 8 }}>
          A 4-digit PIN lets you return to AcadFlow after it sits idle — without re-typing your password. Stored only on this device.
        </p>

        <div className="text-xs font-semibold text-ink2" style={{ marginTop: 8 }}>New PIN</div>
        <PinBoxes value={pin} onChange={setPin} disabled={busy} />
        <div className="text-xs font-semibold text-ink2">Confirm PIN</div>
        <PinBoxes value={confirm} onChange={setConfirm} disabled={busy} />
      </div>
      <div className="modal-footer" style={{ marginTop: 8 }}>
        {had && <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={remove} disabled={busy}>Remove PIN</button>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || pin.length !== 4}>{busy ? 'Saving…' : 'Save PIN'}</button>
      </div>
    </Modal>
  )
}
