import React from 'react'
import markWhite from '@/assets/brand/logo-mark-white.svg?raw'

// Branded full-screen splash shown while Firebase initializes (before the app
// shell can render). Pure presentational - no data, no hooks - so it can mount
// instantly during bootstrap. Matches the instant boot splash baked into
// index.html (same navy field + lockup) so the hand-off is seamless: the inline
// HTML splash paints on first byte, then React swaps in this identical screen
// until fbReady. The cap mark is the all-white inline SVG; "acadflow" is the
// Bricolage wordmark.
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
