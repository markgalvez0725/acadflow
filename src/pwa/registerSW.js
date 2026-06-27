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

  // Was there already a controlling SW when the page loaded? If so, a later
  // controllerchange means a NEW build took over and we should reload to pick
  // up its fresh JS/CSS. On the very first install there is no prior controller,
  // so we must NOT reload (that would be a pointless first-visit refresh).
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    // The updated worker has claimed this page; reload once so the user always
    // ends up on the deployed version instead of a stale cached bundle.
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        _swRegistration = reg
        // Proactively check for a new deploy on every load.
        reg.update().catch(() => {})
        // Activate a freshly installed worker immediately (it then claims the
        // page, firing controllerchange -> auto-reload above).
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
