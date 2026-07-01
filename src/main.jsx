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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Installable PWA + offline shell (production only).
registerServiceWorker()
