// ── Central CDN loader ──────────────────────────────────────────────────────
// One reliability layer for every runtime CDN dependency (Smart Assistance
// models, exporters, extractors). Replaces the five per-file loadScript
// copies, each of which had its own failure mode (no timeout anywhere, two
// modules that cached a failure forever, one that could hang un-settled).
//
// Guarantees:
//  - every load has a TIMEOUT, so a stalled CDN never leaves a spinner forever
//  - multiple mirror URLs are tried in order (never a single point of failure)
//  - the mirror that worked last is remembered (sessionStorage) and tried
//    first on the next load in this browser
//  - success promises are cached; FAILURES ARE NEVER CACHED - the next call
//    retries from scratch, so one network blip doesn't brick a feature until
//    the page is reloaded
//  - loads resolve to the expected window global and reject when a script
//    "loaded" without exposing it (e.g. an interstitial/offline portal page),
//    so callers get a real error instead of a TypeError downstream
//
// Runtime-injected fallbacks intentionally carry no SRI `integrity` attribute:
// one hash cannot cover multiple mirrors, and mirror bytes are not guaranteed
// identical. Transport security relies on HTTPS + the deployed CSP allowlist
// (vercel.json), which pins the loadable origins.

const DEFAULT_TIMEOUT = 20000 // ms; mirrors the fbWithTimeout budget

const _cache = new Map() // cacheKey -> in-flight/successful promise

function _timeoutErr(ms, what) {
  let id
  const p = new Promise((_, rej) => {
    id = setTimeout(() => rej(new Error(`Timed out loading ${what}`)), ms)
  })
  p.cancel = () => clearTimeout(id)
  return p
}

// Remember which mirror worked so the next session starts with it.
function _remember(key, url) {
  try { sessionStorage.setItem('cdn_ok:' + key, url) } catch { /* private mode */ }
}
function _orderFor(key, urls) {
  try {
    const good = sessionStorage.getItem('cdn_ok:' + key)
    if (good && urls.includes(good)) return [good, ...urls.filter(u => u !== good)]
  } catch { /* private mode */ }
  return urls
}

/**
 * Poll for a global that an index.html <script defer> tag sets (XLSX, jspdf,
 * QRCode, faceapi, ExcelJS). Resolves the global; rejects after timeoutMs.
 */
export function waitForGlobal(key, timeoutMs = 9000) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window[key]) return Promise.resolve(window[key])
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (window[key]) { clearInterval(iv); resolve(window[key]) }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error(`${key} is not available`)) }
    }, 150)
  })
}

// Inject one script URL. Settles exactly once: on load (verifying the global),
// on error, or on timeout - including when it attaches to a pre-existing tag
// (the old lessonExtract loader could hang forever on that path).
function _inject(url, globalKey, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'))
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) return reject(err)
      if (globalKey && !window[globalKey]) return reject(new Error(`${globalKey} missing after loading ${url}`))
      resolve(globalKey ? window[globalKey] : undefined)
    }
    const timer = setTimeout(() => finish(new Error(`Timed out loading ${url}`)), timeoutMs)

    const existing = document.querySelector(`script[data-cdn="${url}"]`)
    if (existing) {
      if ((globalKey && window[globalKey]) || existing.dataset.cdnLoaded) return finish()
      existing.addEventListener('load', () => finish())
      existing.addEventListener('error', () => finish(new Error(`Failed to load ${url}`)))
      return
    }
    const s = document.createElement('script')
    s.src = url
    s.async = true
    s.dataset.cdn = url
    s.addEventListener('load', () => { s.dataset.cdnLoaded = '1'; finish() })
    // Remove a failed tag so a retry can re-inject the same URL cleanly.
    s.addEventListener('error', () => { s.remove(); finish(new Error(`Failed to load ${url}`)) })
    document.head.appendChild(s)
  })
}

/**
 * Load a UMD script from the first mirror that works.
 *
 * @param {string|string[]} urls    mirror URLs, preferred first
 * @param {object}   opts
 * @param {string}   opts.globalKey window global the script must set; the
 *                                  promise resolves to window[globalKey]
 * @param {number}   opts.timeoutMs per-mirror timeout
 * @param {string}   opts.cacheKey  dedupe key (defaults to globalKey/first url)
 */
export function loadScriptOnce(urls, { globalKey, timeoutMs = DEFAULT_TIMEOUT, cacheKey } = {}) {
  const list = [].concat(urls)
  const key = cacheKey || globalKey || list[0]
  if (_cache.has(key)) return _cache.get(key)
  const p = (async () => {
    if (globalKey && typeof window !== 'undefined' && window[globalKey]) return window[globalKey]
    let lastErr
    for (const url of _orderFor(key, list)) {
      try {
        const val = await _inject(url, globalKey, timeoutMs)
        _remember(key, url)
        return val
      } catch (e) { lastErr = e }
    }
    throw lastErr || new Error('CDN load failed')
  })()
  _cache.set(key, p)
  p.catch(() => _cache.delete(key))
  return p
}

/**
 * Dynamic ESM import with the same mirror ladder + timeout + never-cache-
 * failure semantics. Used for esm.sh modules (Transformers.js) with a
 * jsdelivr `/+esm` mirror as fallback.
 */
export function loadEsmOnce(urls, { timeoutMs = 60000, cacheKey } = {}) {
  const list = [].concat(urls)
  const key = 'esm:' + (cacheKey || list[0])
  if (_cache.has(key)) return _cache.get(key)
  const p = (async () => {
    let lastErr
    for (const url of _orderFor(key, list)) {
      const guard = _timeoutErr(timeoutMs, url)
      try {
        const mod = await Promise.race([import(/* @vite-ignore */ url), guard])
        _remember(key, url)
        return mod
      } catch (e) { lastErr = e } finally { guard.cancel() }
    }
    throw lastErr || new Error('Module load failed')
  })()
  _cache.set(key, p)
  p.catch(() => _cache.delete(key))
  return p
}

/**
 * The mirror URL that most recently succeeded for a cacheKey (or null).
 * Lets a caller pair secondary assets (worker/core paths) to the same host
 * that served the main library.
 */
export function lastGoodUrl(cacheKey) {
  try { return sessionStorage.getItem('cdn_ok:' + cacheKey) } catch { return null }
}

/** fetch() with a hard timeout (for CDN asset downloads: fonts, ML models). */
export function fetchWithTimeout(url, ms = 15000, init = {}) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
  }
  if (typeof AbortController === 'undefined') return fetch(url, init)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t))
}

/** Fetch the first mirror that answers OK; rejects only when every one fails. */
export async function fetchAny(urls, ms = 15000, init = {}) {
  let lastErr
  for (const url of [].concat(urls)) {
    try {
      const res = await fetchWithTimeout(url, ms, init)
      if (res.ok) return res
      lastErr = new Error(`${url} responded ${res.status}`)
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('All sources failed')
}
