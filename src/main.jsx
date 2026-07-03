import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/primitives/ErrorBoundary'
import './styles/globals.css'
import './styles/design-system.css'
import { registerServiceWorker } from './pwa/registerSW'

// The old opt-in frosted-glass overlay (html[data-glass="on"]) was retired in
// favor of the dedicated frost THEME (data-theme="frost", see design-system.css).
// Drop the stale preference so the legacy data-glass CSS can never re-engage
// and fight the theme styling.
try { localStorage.removeItem('acadflow_glass') } catch (e) {}

// A lazy chunk's module preload failed - either the connection dropped mid
// fetch, or a fresh deploy replaced the hashed files this page was built
// against. If we're online and haven't already tried, one reload fetches the
// new index + chunks. Offline (or on a second failure) we let lazyRetry's
// in-place recovery screen handle it instead of reload-looping.
window.addEventListener('vite:preloadError', (event) => {
  let alreadyReloaded = false
  try { alreadyReloaded = sessionStorage.getItem('af_chunk_reloaded') === '1' } catch (e) {}
  if (alreadyReloaded || navigator.onLine === false) return
  try { sessionStorage.setItem('af_chunk_reloaded', '1') } catch (e) {}
  event.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Installable PWA + offline shell (production only).
registerServiceWorker()
