import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import './styles/design-system.css'
import { registerServiceWorker } from './pwa/registerSW'

// Apply saved frosted-glass preference before first paint (default: on).
try {
  if (localStorage.getItem('acadflow_glass') === 'off') {
    document.documentElement.dataset.glass = 'off'
  }
} catch (e) {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Installable PWA + offline shell (production only).
registerServiceWorker()
