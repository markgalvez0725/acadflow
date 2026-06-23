import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/context/AuthContext'
import PinBoxes from '@/components/primitives/PinBoxes'
import { Lock } from 'lucide-react'

// Full-screen lock shown when a session with a quick-unlock PIN goes idle.
// Correct PIN lifts the lock (no re-login); "use password" is a full logout.
export default function QuickUnlock() {
  const { unlockWithPin, logout, currentStudent } = useAuth()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (pin.length === 4 && !busy) {
      setBusy(true); setErr('')
      unlockWithPin(pin).then(res => {
        if (cancelled) return
        if (!res.ok) { setErr(res.msg || 'Incorrect PIN.'); setPin('') }
        setBusy(false)
      })
    }
    return () => { cancelled = true }
  }, [pin])

  const raw = (currentStudent?.name || '').trim()
  const first = raw.includes(',') ? (raw.split(',')[1]?.trim().split(/\s+/)[0] || raw) : raw.split(/\s+/)[0]

  return createPortal(
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="Locked">
      <div className="onb-card" style={{ textAlign: 'center' }}>
        <div className="onb-ic" style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
          <Lock size={26} />
        </div>
        <h3 className="onb-title">{first ? `Welcome back, ${first}` : 'Locked'}</h3>
        <p className="onb-body">Enter your 4-digit PIN to continue.</p>
        <PinBoxes value={pin} onChange={setPin} disabled={busy} />
        {err && <div className="err-msg" style={{ marginTop: 4 }}>{err}</div>}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => logout('manual')}>
          Sign in with password instead
        </button>
      </div>
    </div>,
    document.body
  )
}
