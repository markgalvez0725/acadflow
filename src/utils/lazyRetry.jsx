import React, { useEffect, useRef, useState } from 'react'
import ErrorState from '@/components/ds/ErrorState'
import { teleCount } from '@/utils/telemetry'

// Chunk-load resilience for React.lazy on flaky networks (mobile data).
//
// Two problems with bare React.lazy(() => import(...)):
//   1. A single dropped fetch rejects the import - one hiccup on weak mobile
//      data and the tab (or the whole app shell) throws into an error boundary.
//   2. React caches that rejection, so once a chunk fails the component stays
//      broken until a full page reload - "Try again" buttons can't fix it.
//
// lazyRetry fixes both: the import is retried with short breathers, and if it
// still fails the lazy component resolves to a small recovery screen whose
// "Try again" re-imports and swaps in the real component in place - no reload
// needed. It also retries by itself the moment the browser fires 'online'.
//
// Use lazyRetry(() => import('...')) everywhere React.lazy would be used.

const RETRY_DELAYS = [900, 2300]

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function importWithRetry(importer) {
  let lastErr
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try {
      return await importer()
    } catch (e) {
      lastErr = e
    }
    if (i < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[i])
  }
  // Every retry burned: count it for the System reports tab before the
  // recovery screen takes over.
  try { teleCount('chunkFail') } catch (e) { /* telemetry is a nicety */ }
  throw lastErr
}

// The module React.lazy resolves to when every attempt failed: renders a soft
// retry screen in the component's place and, on success, becomes the real
// component (props pass straight through).
function makeRecovery(importer) {
  return function ChunkRecovery(props) {
    const [Real, setReal] = useState(null)
    const [busy, setBusy] = useState(false)
    const busyRef = useRef(false)

    const retry = () => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      importWithRetry(importer)
        .then(m => setReal(() => m.default))
        .catch(() => {
          busyRef.current = false
          setBusy(false)
        })
    }

    // Heal without asking as soon as the connection comes back.
    useEffect(() => {
      window.addEventListener('online', retry)
      return () => window.removeEventListener('online', retry)
    }, [])

    if (Real) return <Real {...props} />
    return (
      <div style={{ padding: '28px 16px' }}>
        <ErrorState
          title="Couldn't load this part"
          text={navigator.onLine === false
            ? 'You are offline. This will load as soon as you are back on the internet.'
            : 'The connection dropped while loading. Check your signal and try again.'}
          onRetry={retry}
          retryLabel={busy ? 'Retrying…' : 'Try again'}
        />
      </div>
    )
  }
}

export function lazyRetry(importer) {
  return React.lazy(() =>
    importWithRetry(importer).catch(() => ({ default: makeRecovery(importer) }))
  )
}

export default lazyRetry
