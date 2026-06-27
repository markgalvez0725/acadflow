import { useEffect, useRef } from 'react'

// ── Best-effort screenshot / capture detection ─────────────────────────────
// IMPORTANT, read before relying on this: browsers cannot reliably detect a
// screenshot. iOS Safari and Android Chrome expose NO API for it, and macOS
// intercepts its own screenshot shortcuts (Cmd+Shift+3/4/5) before the page
// ever sees the keypress. There is no "Smart detector" that changes this - the
// pixels never reach JavaScript.
//
// So this hook only catches the cases that ARE observable from the page:
//   • Windows PrintScreen
//   • Some desktop capture shortcuts that still bubble a keydown
// When it fires, the Messages tab posts an Instagram/Messenger-style
// "… took a screenshot" notice into the conversation and alerts the professor.
//
// onDetect is best-effort and debounced; treat a fire as "likely capture",
// never as proof. On mobile web (iOS/Android) a real screenshot emits no event,
// so the notice can't fire there - true mobile parity needs a native wrapper.
export function useScreenshotGuard({ enabled = true, onDetect } = {}) {
  const lastRef = useRef(0)
  const cbRef = useRef(onDetect)
  cbRef.current = onDetect

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const fire = (reason) => {
      const now = Date.now()
      if (now - lastRef.current < 1500) return // collapse key-repeat / down+up bursts
      lastRef.current = now
      try { cbRef.current?.(reason) } catch (e) { /* never throw from a listener */ }
    }

    const onKey = (e) => {
      const k = e.key
      if (k === 'PrintScreen') return fire('printscreen')
      // macOS screenshot shortcuts - usually swallowed by the OS, but fire if seen.
      if (e.metaKey && e.shiftKey && (k === '3' || k === '4' || k === '5')) return fire('mac-shortcut')
      // Windows Snipping Tool (Win+Shift+S); the Win key maps to metaKey when exposed.
      if (e.metaKey && e.shiftKey && (k === 'S' || k === 's')) return fire('snip')
    }

    // PrintScreen typically only emits on keyup; listen to both to be safe.
    window.addEventListener('keyup', onKey)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('keydown', onKey)
    }
  }, [enabled])
}

export default useScreenshotGuard
