import React, { useState } from 'react'
import Modal from '@/components/primitives/Modal'
import { Bell, BellRing, Check } from 'lucide-react'

/**
 * Persistent notification opt-in popup shown after a student logs in, until
 * they enable notifications. Only rendered by StudentLayout when push is
 * supported and permission is still 'default' (i.e. actionable).
 *
 * @param {{ push: any, onClose: () => void }} props
 *   push: the usePushNotifications() return ({ supported, permission, busy, enable })
 *   onClose: dismiss for this session ("Maybe later")
 */
export default function NotifyPrompt({ push, onClose }) {
  const [done, setDone] = useState(false)

  async function handleEnable() {
    const ok = await push?.enable?.()
    if (ok) {
      setDone(true)
      setTimeout(() => onClose?.(), 1100) // brief success, then close
    }
    // On failure the hook already toasts the reason; leave the popup open so
    // the student can try again or pick "Maybe later".
  }

  return (
    <Modal isOpen onClose={onClose} size="sm" zIndex={240}>
      <div style={{ padding: '26px 24px 22px', textAlign: 'center' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: done ? 'var(--green-l)' : 'var(--blue-l, var(--bg2))',
          color: done ? 'var(--green)' : 'var(--blue, var(--primary))',
        }}>
          {done ? <Check size={30} /> : <BellRing size={30} />}
        </div>

        {done ? (
          <>
            <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>You’re all set!</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink2)' }}>
              You’ll now get alerts for grades, announcements, messages, and quizzes.
            </p>
          </>
        ) : (
          <>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>Turn on notifications</h3>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--ink2)', lineHeight: 1.5 }}>
              Get notified the moment your teacher posts <strong>grades</strong>, <strong>announcements</strong>,
              <strong> activities</strong>, <strong>quizzes</strong>, or sends you a <strong>message</strong> - even when AcadFlow isn’t open.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleEnable} disabled={push?.busy}
                style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Bell size={16} /> {push?.busy ? 'Enabling…' : 'Enable notifications'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: '100%' }}>
                Maybe later
              </button>
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--ink3)' }}>
              You can change this anytime from your account menu.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
