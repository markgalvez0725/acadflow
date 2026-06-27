import React, { useState, useRef, useEffect } from 'react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { NOTIF_CATEGORIES, defaultNotifPrefs } from '@/utils/notifPrefs'
import { SaveStatus } from '@/components/primitives/FieldCheck'
import { ChevronLeft } from 'lucide-react'

/**
 * Lets a student choose which categories of notifications they receive. Each
 * toggle AUTO-SAVES (debounced) onto their own student record - muting takes
 * effect immediately because notifications are filtered by these prefs at
 * display time. A Back button returns to the settings sheet.
 */
export default function NotifPrefsModal({ student: s, onClose, embedded = false }) {
  const { students, saveStudents, db, fbReady } = useData()
  const { setCurrentStudent } = useAuth()

  const [prefs, setPrefs] = useState(() => ({ ...defaultNotifPrefs(), ...(s.notifPrefs || {}) }))
  const [status, setStatus] = useState('idle') // idle | saving | saved
  const firstRef = useRef(true)

  function toggle(key) {
    setPrefs(p => ({ ...p, [key]: p[key] === false }))
  }

  // Auto-save whenever a toggle changes (debounced to batch quick taps). Skips
  // the initial mount so simply opening the panel never writes.
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return }
    if (!fbReady || !db.current) return
    setStatus('saving')
    const t = setTimeout(async () => {
      try {
        const updated = { ...s, notifPrefs: prefs }
        await saveStudents(students.map(x => x.id === s.id ? updated : x), [s.id])
        setCurrentStudent(updated) // instant badge/list refresh
        setStatus('saved')
        setTimeout(() => setStatus('idle'), 1500)
      } catch { setStatus('idle') }
    }, 600)
    return () => clearTimeout(t)
  }, [prefs]) // eslint-disable-line react-hooks/exhaustive-deps

  const inner = (
    <>
      {embedded ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--ink3)' }}>Changes save automatically.</span>
          <SaveStatus status={status} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button type="button" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink2)', fontSize: 13, fontWeight: 600, padding: 0 }}>
              <ChevronLeft size={16} /> Back
            </button>
            <SaveStatus status={status} />
          </div>
          <ModalHeader
            title="Notification preferences"
            subtitle="Choose what you'd like to be notified about. Changes save automatically."
          />
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NOTIF_CATEGORIES.map(cat => {
          const on = prefs[cat.key] !== false
          return (
            <label
              key={cat.key}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '12px 4px', cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{cat.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)' }}>{cat.desc}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={on}
                aria-label={`${cat.label} notifications`}
                onChange={() => toggle(cat.key)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)', flexShrink: 0, cursor: 'pointer' }}
              />
            </label>
          )
        })}
      </div>
    </>
  )

  if (embedded) return inner
  return <Modal size="sm" onClose={onClose}>{inner}</Modal>
}
