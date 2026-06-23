// ── AI request gateway ────────────────────────────────────────────────────
// All Gemini-backed API calls (ai-generate, generate-quiz, validate-photo) go
// through here to protect a free-tier quota:
//
//   • SERIALIZED — only ONE request is ever in flight at a time (a promise
//     queue), so the app never fans out concurrent calls.
//   • DE-DUPLICATED — identical requests already in flight share the same
//     promise (no double-fire from double-clicks / re-renders), and callers
//     may opt into a session cache so an identical request never repeats.
//
// Every caller gets a normalized { ok, status, data, error }. The shared
// id-token is injected here so callers don't each fetch it.
import { getIdToken } from '@/firebase/firebaseInit'

let _chain = Promise.resolve()   // serialization queue — one request at a time
const _inflight = new Map()      // key -> Promise (collapse concurrent dupes)
const _cache = new Map()         // key -> result (collapse repeated dupes)
const CACHE_MAX = 60

// Stable key from endpoint + body, excluding volatile fields (idToken/signal).
function keyFor(url, body) {
  const { idToken, ...rest } = body || {}
  return url + '|' + JSON.stringify(rest)
}

/**
 * Make a serialized, de-duplicated POST to a Gemini-backed endpoint.
 * @param {string} url           e.g. '/api/ai-generate'
 * @param {object} body          JSON body (idToken is added automatically)
 * @param {{cache?:boolean, signal?:AbortSignal}} [opts]
 *        cache: reuse an identical successful result for the session.
 * @returns {Promise<{ok:boolean,status:number,data:any,error:?string}>}
 */
export async function aiRequest(url, body, opts = {}) {
  const { cache = false, signal } = opts
  const key = keyFor(url, body)

  if (cache && _cache.has(key)) return _cache.get(key)
  if (_inflight.has(key)) return _inflight.get(key)

  const task = async () => {
    let idToken = null
    try { idToken = await getIdToken() } catch (e) { /* unauth — endpoint will 401 */ }
    let res
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(body || {}), idToken }),
        signal,
      })
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e?.name === 'AbortError' ? 'aborted' : (e?.message || 'network error') }
    }
    let data = null
    try { data = await res.json() } catch (e) { data = null }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data?.error || ('HTTP ' + res.status)) }
  }

  // Append to the chain so requests run strictly one after another. Continue
  // the chain through failures so one error can't stall the whole queue.
  const run = _chain.then(task, task)
  _chain = run.then(() => {}, () => {})
  _inflight.set(key, run)

  try {
    const result = await run
    if (cache && result && result.ok) {
      _cache.set(key, result)
      if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value)
    }
    return result
  } finally {
    _inflight.delete(key)
  }
}

/** Drop any cached AI results (e.g. on logout). */
export function clearAiCache() { _cache.clear() }
