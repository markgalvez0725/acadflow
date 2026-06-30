// ── useConnectionQuality ──────────────────────────────────────────────────
// Richer companion to useOnlineStatus. Beyond the binary online/offline that
// `navigator.onLine` reports, this also surfaces a SLOW (poor bandwidth/high
// latency) and an UNSTABLE (keeps dropping then recovering) state, so the UI
// can warn the user before Firestore writes start timing out.
//
// Returns one of: 'good' | 'slow' | 'unstable' | 'offline'.
//
// Signals combined:
//  - browser online/offline events (hard disconnect)
//  - Network Information API (effectiveType / downlink / rtt) where supported
//  - a light same-origin latency heartbeat (a tiny static asset), polled only
//    while the tab is visible, kept in a small rolling window
import { useState, useEffect, useRef } from 'react'

const HEARTBEAT_MS  = 30000   // poll cadence while the tab is visible
const HB_TIMEOUT_MS = 8000    // a heartbeat slower than this counts as a failure
const SLOW_RTT_MS   = 2500    // a completed-but-slow heartbeat marks the link slow
const WINDOW        = 4       // how many recent heartbeats we weigh
const HB_URL        = '/favicon-32.png' // 891 bytes, same-origin (no CSP/CORS cost)

function getConnection() {
  if (typeof navigator === 'undefined') return null
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null
}

export function useConnectionQuality() {
  const [status, setStatus] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'good'
  )
  const history = useRef([]) // recent heartbeat outcomes: 'ok' | 'slow' | 'fail'

  useEffect(() => {
    let cancelled = false
    let timer = null
    const conn = getConnection()

    // The Network Information API says the link is poor (2g-class, thin pipe,
    // or high round-trip) - only consulted where the browser exposes it.
    function apiSaysSlow() {
      if (!conn) return false
      const et = conn.effectiveType
      if (et === 'slow-2g' || et === '2g') return true
      if (typeof conn.downlink === 'number' && conn.downlink > 0 && conn.downlink < 0.4) return true
      if (typeof conn.rtt === 'number' && conn.rtt > 1200) return true
      return false
    }

    function record(outcome) {
      const h = history.current
      h.push(outcome)
      while (h.length > WINDOW) h.shift()
    }

    function recompute() {
      if (cancelled) return
      // A hard offline event always wins.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus('offline'); return }

      const recent = history.current.slice(-WINDOW)
      const fails = recent.filter(o => o === 'fail').length
      const slows = recent.filter(o => o === 'slow').length

      // Interface is up but nothing is getting through - treat as offline.
      if (recent.length >= 2 && fails === recent.length) { setStatus('offline'); return }
      // Some heartbeats fail while others succeed - the link keeps dropping.
      if (fails >= 1 && fails < recent.length) { setStatus('unstable'); return }
      // Persistently slow, by heartbeat timing or the Network Information API.
      if (slows >= 2 || apiSaysSlow()) { setStatus('slow'); return }
      setStatus('good')
    }

    async function heartbeat() {
      if (cancelled) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { recompute(); schedule(); return }
      // Pause polling in a backgrounded tab - no point spending the request.
      if (typeof document !== 'undefined' && document.hidden) { schedule(); return }

      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), HB_TIMEOUT_MS)
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())
      try {
        await fetch(`${HB_URL}?_hb=${Date.now()}`, { cache: 'no-store', method: 'GET', signal: ctrl.signal })
        const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
        record(dt > SLOW_RTT_MS ? 'slow' : 'ok')
      } catch {
        record('fail') // timeout or network error
      } finally {
        clearTimeout(to)
      }
      recompute()
      schedule()
    }

    function schedule() {
      if (cancelled) return
      clearTimeout(timer)
      timer = setTimeout(heartbeat, HEARTBEAT_MS)
    }

    const goOnline    = () => { heartbeat() }          // re-check immediately on reconnect
    const goOffline   = () => { setStatus('offline') }
    const onConnChange = () => recompute()
    const onVisible   = () => { if (!document.hidden) heartbeat() }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    if (conn && conn.addEventListener) conn.addEventListener('change', onConnChange)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)

    timer = setTimeout(heartbeat, 1500) // first probe shortly after mount

    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      if (conn && conn.removeEventListener) conn.removeEventListener('change', onConnChange)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return status
}
