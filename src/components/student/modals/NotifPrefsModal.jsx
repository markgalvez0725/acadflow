import React, { useState } from 'react'
import Modal, { ModalHeader, ModalFooter } from '@/components/primitives/Modal'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import { useUI } from '@/context/UIContext'
import { NOTIF_CATEGORIES, defaultNotifPrefs } from '@/utils/notifPrefs'

/**
 * Lets a student choose which categories of notifications they receive.
 * Saves a `notifPrefs` map onto their own student record. Muting takes effect
 * immediately because notifications are filtered by these prefs at display time.
 */
export default function NotifPrefsModal({ student: s, onClose }) {
  const { students, saveStudents, db, fbReady } = useData()
  const { setCurrentStudent } = useAuth()
  const { toast } = useUI()

  const [prefs, setPrefs] = useState(() => ({ ...defaultNotifPrefs(), ...(s.notifPrefs || {}) }))
  const [saving, setSaving] = useState(false)

  function toggle(key) {
    setPrefs(p => ({ ...p, [key]: !p[key] }))
  }

  async function handleSave() {
    if (!fbReady || !db.current) { toast('Firebase not connected.', 'red'); return }
    setSaving(true)
    try {
      const updatedStudent = { ...s, notifPrefs: prefs }
      await saveStudents(students.map(x => x.id === s.id ? updatedStudent : x), [s.id])
      setCurrentStudent(updatedStudent) // instant badge/list refresh
      toast('Notification preferences saved.', 'green')
      onClose()
    } catch (e) {
      toast('Could not save preferences: ' + e.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal size="sm" onClose={onClose}>
      <ModalHeader
        title="Notification preferences"
        subtitle="Choose what you'd like to be notified about."
        onClose={onClose}
      />

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

      <ModalFooter>
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
