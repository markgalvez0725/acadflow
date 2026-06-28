import React from 'react'
import { WifiOff, RefreshCw } from 'lucide-react'

// Soft, in-tab error state for data-load / action failures. This is distinct
// from the hard render-crash ErrorBoundary (which catches thrown render errors):
// ErrorState is what a tab shows when data could not be fetched but the app is
// otherwise fine, giving the user a clear retry instead of a blank panel.
//
// Announces via role="alert" so screen readers surface the failure. Shares the
// `.empty-cta` shell with EmptyState for a consistent framed-icon look.
//
// Props:
//   Icon       lucide icon component (defaults to a connection icon)
//   title      headline, e.g. "Couldn't load grades"
//   text       one supporting line
//   onRetry    handler for the retry button; the button is hidden when omitted
//   retryLabel button text (default "Try again")
export default function ErrorState({
  Icon = WifiOff,
  title = "Couldn't load this",
  text = 'Check your connection and try again.',
  onRetry,
  retryLabel = 'Try again',
}) {
  return (
    <div className="empty-cta" role="alert">
      <div className="ec-ic ec-ic--danger" aria-hidden="true">
        <Icon size={26} />
      </div>
      {title && <b>{title}</b>}
      {text && <span>{text}</span>}
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          <RefreshCw size={14} /> {retryLabel}
        </button>
      )}
    </div>
  )
}
