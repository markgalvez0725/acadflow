import React from 'react'
import markWhite from '@/assets/brand/logo-mark-white.svg?raw'

// Branded full-screen splash. Pure presentational - no data, no hooks. The
// initial cold boot is NOT covered by this component: the instant #boot-splash
// baked into index.html (same navy field + lockup) stays up and animates
// continuously until the first real screen commits, so the splash never re-fires.
// This component is the React-side equivalent used as the Suspense fallback for
// lazy screen chunks that load AFTER boot (e.g. switching login -> layout). The
// cap mark is the all-white inline SVG; "acadflow" is the Bricolage wordmark.
export default function LoadingScreen() {
  return (
    <div className="app-splash" role="status" aria-live="polite" aria-label="Loading AcadFlow">
      <div className="app-splash-glow" aria-hidden="true" />
      <div className="app-splash-lockup">
        <span className="app-splash-cap" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markWhite }} />
        <span className="app-splash-word">acadflow</span>
        <span className="app-splash-tag">Where learning flows.</span>
      </div>
      <div className="app-splash-bar"><span /></div>
      <div className="app-splash-hint">Connecting your campus…</div>
    </div>
  )
}
