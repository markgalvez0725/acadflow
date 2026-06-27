import React from 'react'

// Branded full-screen splash shown while Firebase initializes (before the app
// shell can render). Pure presentational - no data, no hooks - so it can mount
// instantly during bootstrap. The tagline is the app's voice line.
export default function LoadingScreen({ tagline = 'Where learning flows.' }) {
  return (
    <div className="app-splash" role="status" aria-live="polite">
      <div className="app-splash-glow" aria-hidden="true" />
      <div className="app-splash-logo">
        <img src="/logo.png" alt="" />
      </div>
      <div className="app-splash-word">AcadFlow</div>
      <div className="app-splash-tag">{tagline}</div>
      <div className="app-splash-bar"><span /></div>
      <div className="app-splash-hint">Connecting your campus…</div>
    </div>
  )
}
