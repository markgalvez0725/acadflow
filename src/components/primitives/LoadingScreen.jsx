import React from 'react'
import stackedWhite from '@/assets/brand/logo-stacked-white.svg?raw'

// Branded full-screen splash shown while Firebase initializes (before the app
// shell can render). Pure presentational - no data, no hooks - so it can mount
// instantly during bootstrap. The all-white stacked lockup (wordmark + tagline
// baked in) is inlined as SVG on the brand-purple field.
export default function LoadingScreen() {
  return (
    <div className="app-splash" role="status" aria-live="polite">
      <div className="app-splash-glow" aria-hidden="true" />
      <span className="app-splash-lockup" role="img" aria-label="AcadFlow" dangerouslySetInnerHTML={{ __html: stackedWhite }} />
      <div className="app-splash-bar"><span /></div>
      <div className="app-splash-hint">Connecting your campus…</div>
    </div>
  )
}
