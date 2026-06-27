import React from 'react'

// Branded full-screen splash shown while Firebase initializes (before the app
// shell can render). Pure presentational - no data, no hooks - so it can mount
// instantly during bootstrap. Uses the all-white stacked lockup (wordmark +
// tagline baked in) on the brand-purple field.
export default function LoadingScreen() {
  return (
    <div className="app-splash" role="status" aria-live="polite">
      <div className="app-splash-glow" aria-hidden="true" />
      <img className="app-splash-lockup" src="/brand/logo-stacked-white.png" alt="AcadFlow" />
      <div className="app-splash-bar"><span /></div>
      <div className="app-splash-hint">Connecting your campus…</div>
    </div>
  )
}
