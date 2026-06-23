import React, { useState } from 'react'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { Download, X, Share } from 'lucide-react'

// Dismissible "install this app" banner. Renders nothing unless the app is
// installable and the user hasn't dismissed it. Dismissal is remembered so we
// don't nag on every visit.
const DISMISS_KEY = 'cp_install_dismissed'

export default function InstallPrompt() {
  const { canInstall, canPromptDirectly, ios, promptInstall, installed } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch (e) { return false }
  })
  const [showIosHelp, setShowIosHelp] = useState(false)

  if (installed || dismissed || !canInstall) return null

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch (e) {}
  }

  async function onInstall() {
    if (canPromptDirectly) {
      const outcome = await promptInstall()
      if (outcome === 'accepted') dismiss()
    } else if (ios) {
      setShowIosHelp(v => !v)
    }
  }

  return (
    <div
      className="card"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', marginBottom: 12, border: '1px solid var(--accent)', background: 'var(--accent-l)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Download size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>Install AcadFlow</div>
          <div style={{ fontSize: 12, color: 'var(--ink2)' }}>Add it to your home screen for faster, full-screen access.</div>
        </div>
        <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }} onClick={onInstall}>
          {ios && !canPromptDirectly ? <><Share size={13} className="inline-block mr-1" />How to</> : 'Install'}
        </button>
        <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0, padding: '4px 6px' }} onClick={dismiss} aria-label="Dismiss install prompt">
          <X size={14} />
        </button>
      </div>
      {showIosHelp && ios && (
        <div style={{ fontSize: 12, color: 'var(--ink2)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          Tap the <strong>Share</strong> icon in Safari, then choose <strong>Add to Home Screen</strong>.
        </div>
      )}
    </div>
  )
}
