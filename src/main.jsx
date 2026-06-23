import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/primitives/ErrorBoundary'
import './styles/globals.css'
import './styles/design-system.css'
import { registerServiceWorker } from './pwa/registerSW'

// Apply saved frosted-glass preference before first paint. Frosted glass is
// opt-in: the flat (Clean Academic) look is the default, and html[data-glass="on"]
// layers translucency/blur/aurora back on when the user enables it.
try {
  if (localStorage.getItem('acadflow_glass') === 'on') {
    document.documentElement.dataset.glass = 'on'
  }
} catch (e) {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Installable PWA + offline shell (production only).
registerServiceWorker()
