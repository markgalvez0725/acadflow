// ── useInstallPrompt ──────────────────────────────────────────────────────
// Wraps the PWA "Add to Home Screen" flow. On Chromium it captures the
// `beforeinstallprompt` event so we can trigger the native prompt on demand;
// on iOS Safari (which has no such event) it reports `ios` so the UI can show
// the manual Share → Add to Home Screen hint instead. No-ops when already
// installed/standalone.
import { useState, useEffect, useCallback } from 'react'

function isIos() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS poses as Mac
}

function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [installed, setInstalled] = useState(isStandalone())

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferred(e) }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return null
    deferred.prompt()
    const choice = await deferred.userChoice
    setDeferred(null)
    return choice?.outcome // 'accepted' | 'dismissed'
  }, [deferred])

  const ios = isIos()
  return {
    installed,
    ios,
    canPromptDirectly: !!deferred,
    // Show install affordance when not installed AND we can either prompt
    // natively or guide an iOS user through the manual steps.
    canInstall: !installed && (!!deferred || (ios && !isStandalone())),
    promptInstall,
  }
}
