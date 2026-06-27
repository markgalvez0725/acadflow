// ── PWA service-worker registration ───────────────────────────────────────
// Registered only in production builds so the dev server / HMR is never
// affected. Failure is swallowed - the app works identically without it.
let _swRegistration = null

export function getSWRegistration() {
  return _swRegistration
}

export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  // Skip in dev to avoid caching the Vite dev bundle / interfering with HMR.
  if (import.meta.env && import.meta.env.DEV) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        _swRegistration = reg
        // Activate a freshly installed worker without forcing a hard reload.
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING')
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          if (!sw) return
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && reg.waiting) {
              reg.waiting.postMessage('SKIP_WAITING')
            }
          })
        })
      })
      .catch(() => { /* SW registration failed - app still works fully */ })
  })
}
