// ── On-device telemetry for the System reports tab ────────────────────────
// Quietly measures how AcadFlow itself behaves on every signed-in device:
// JS errors, chunk-load failures, app start time, LCP, long tasks, offline
// spells, failed saves, and a per-class meeting quality summary. Everything
// accumulates in ONE localStorage object per day and flushes as ONE small
// Firestore doc per device per day (`telemetry/{deviceId}-{day}`), so the
// free-tier write cost is a handful of writes per device per day.
//
// Privacy: no student ids, names, or content - just technical signals plus
// a trimmed user agent. Only the professor can read the docs back (rules).
//
// Boot order matters: teleInit() is called from main.jsx BEFORE React mounts
// so even render-crash errors are captured; teleAttach(getDb) is called by
// DataContext once Firebase is ready and hands over a live db getter.

import { fbSaveTelemetry } from '@/firebase/telemetry'

const DEV_KEY = 'acadflow_devid'
const BUF_KEY = 'acadflow_tele'
const PREV_KEY = 'acadflow_tele_prev'
const ERR_CAP = 40
const LIST_CAP = 15
const MEET_CAP = 8

let _getDb = null
let _inited = false
let _dirty = false
let _sesErrored = false
let _flushTimer = 0

function dayStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function deviceId() {
  try {
    let id = localStorage.getItem(DEV_KEY)
    if (!id) {
      id = Math.random().toString(36).slice(2, 10)
      localStorage.setItem(DEV_KEY, id)
    }
    return id
  } catch { return 'nodev' }
}

function blank(day) {
  return {
    day,
    dev: deviceId(),
    ver: '',
    ua: String(navigator.userAgent || '').slice(0, 120),
    ses: 0,
    errSes: 0,
    errors: [],
    chunkFail: 0,
    saveFail: 0,
    offline: 0,
    slow: 0,
    boot: [],
    lcp: [],
    long: 0,
    memMax: 0,
    meet: [],
    at: 0,
  }
}

function load() {
  const today = dayStr()
  let buf = null
  try { buf = JSON.parse(localStorage.getItem(BUF_KEY) || 'null') } catch { buf = null }
  if (!buf || typeof buf !== 'object' || buf.day !== today) {
    // Day rolled over: park yesterday's data for one last flush attempt.
    if (buf && buf.day) {
      try { localStorage.setItem(PREV_KEY, JSON.stringify(buf)) } catch { /* full */ }
    }
    buf = blank(today)
  }
  return buf
}

function store(buf) {
  try { localStorage.setItem(BUF_KEY, JSON.stringify(buf)) } catch { /* full - keep in memory only */ }
}

function mutate(fn) {
  const buf = load()
  fn(buf)
  buf.at = Date.now()
  store(buf)
  _dirty = true
}

// ── Recording ──────────────────────────────────────────────────────────────

function recordError(msg, src) {
  const m = String(msg || 'Unknown error').slice(0, 200)
  // Never let the reporter loop on itself.
  if (m.includes('acadflow_tele')) return
  mutate(buf => {
    if (!_sesErrored) { _sesErrored = true; buf.errSes = (buf.errSes || 0) + 1 }
    const hit = buf.errors.find(e => e.m === m)
    if (hit) {
      hit.n += 1
      hit.t = Date.now()
    } else if (buf.errors.length < ERR_CAP) {
      buf.errors.push({ m, src: String(src || '').slice(0, 120), n: 1, t: Date.now() })
    }
  })
  scheduleFlush(30000) // batch error bursts into one write (quota discipline)
}

/** Bump a simple counter: 'saveFail' | 'chunkFail' | 'offline' | 'slow'. */
export function teleCount(key) {
  try {
    if (!['saveFail', 'chunkFail', 'offline', 'slow'].includes(key)) return
    mutate(buf => { buf[key] = (buf[key] || 0) + 1 })
    scheduleFlush(60000)
  } catch { /* telemetry never breaks the app */ }
}

/** Per-class meeting quality summary, called when a room closes. */
export function teleMeet(summary) {
  try {
    if (!summary || !summary.id) return
    mutate(buf => {
      buf.meet = (buf.meet || []).filter(x => x.id !== summary.id).slice(-(MEET_CAP - 1))
      buf.meet.push({
        id: String(summary.id).slice(0, 40),
        dur: Math.max(0, Math.round(summary.dur || 0)),
        rec: Math.max(0, summary.rec || 0),
        q: ['good', 'weak', 'bad'].includes(summary.q) ? summary.q : '',
        relay: summary.relay === true,
        peers: Math.max(0, summary.peers || 0),
        t: Date.now(),
      })
    })
    scheduleFlush(10000)
  } catch { /* nicety */ }
}

/** Stamp the running app version onto the daily doc. */
export function teleVersion(ver) {
  try { mutate(buf => { buf.ver = String(ver || '').slice(0, 12) }) } catch { /* nicety */ }
}

// ── Flushing ───────────────────────────────────────────────────────────────

function scheduleFlush(ms) {
  if (_flushTimer) return
  _flushTimer = setTimeout(() => { _flushTimer = 0; flush() }, ms)
}

async function flush() {
  const db = _getDb ? _getDb() : null
  if (!db) return
  // Yesterday's leftover first (best-effort, once).
  try {
    const prev = JSON.parse(localStorage.getItem(PREV_KEY) || 'null')
    if (prev && prev.day && prev.dev) {
      localStorage.removeItem(PREV_KEY)
      fbSaveTelemetry(db, `${prev.dev}-${prev.day}`, prev).catch(() => { /* gone */ })
    }
  } catch { /* corrupt - drop */ }
  if (!_dirty) return
  const buf = load()
  try {
    await fbSaveTelemetry(db, `${buf.dev}-${buf.day}`, buf)
    _dirty = false
  } catch { /* offline or rules not published yet - keep buffering locally */ }
}

// ── Init ──────────────────────────────────────────────────────────────────

/** Call once from main.jsx before React mounts. Safe everywhere: any
 *  internal failure leaves the app untouched. */
export function teleInit() {
  if (_inited || typeof window === 'undefined') return
  _inited = true
  try {
    mutate(buf => { buf.ses = (buf.ses || 0) + 1 })

    window.addEventListener('error', e => {
      try {
        const msg = e?.message || (e?.target && e.target.tagName ? `Resource failed: ${e.target.tagName}` : 'Script error')
        recordError(msg, e?.filename ? `${e.filename}:${e.lineno || 0}` : '')
      } catch { /* never throw from the reporter */ }
    })
    window.addEventListener('unhandledrejection', e => {
      try {
        const r = e?.reason
        recordError(r && r.message ? r.message : String(r || 'Unhandled rejection'), r && r.stack ? String(r.stack).split('\n')[1] : '')
      } catch { /* noop */ }
    })

    // App start: how long until the page was usable.
    window.addEventListener('load', () => {
      try {
        const nav = performance.getEntriesByType('navigation')[0]
        const ms = nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : Math.round(performance.now())
        if (ms > 0 && ms < 120000) mutate(buf => { buf.boot = [...(buf.boot || []), ms].slice(-LIST_CAP) })
      } catch { /* noop */ }
    })

    // LCP + long tasks, where the browser supports them.
    try {
      new PerformanceObserver(list => {
        const last = list.getEntries().pop()
        if (last) mutate(buf => { buf.lcp = [...(buf.lcp || []), Math.round(last.startTime)].slice(-LIST_CAP) })
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    } catch { /* unsupported */ }
    try {
      new PerformanceObserver(list => {
        const n = list.getEntries().length
        if (n) mutate(buf => { buf.long = (buf.long || 0) + n })
      }).observe({ type: 'longtask', buffered: true })
    } catch { /* unsupported */ }

    // Memory high-water mark (Chrome only), sampled once a minute.
    setInterval(() => {
      try {
        const used = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0
        if (used) mutate(buf => { buf.memMax = Math.max(buf.memMax || 0, used) })
      } catch { /* noop */ }
    }, 60000)

    window.addEventListener('offline', () => teleCount('offline'))
    try {
      const conn = navigator.connection
      if (conn && conn.addEventListener) {
        conn.addEventListener('change', () => {
          if (String(conn.effectiveType || '').includes('2g')) teleCount('slow')
        })
      }
    } catch { /* noop */ }

    // Flush when the tab hides or unloads, and every 15 minutes while dirty.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    window.addEventListener('pagehide', () => flush())
    setInterval(() => { if (_dirty) flush() }, 900000)
  } catch { /* telemetry never breaks the app */ }
}

/** DataContext hands over a live db getter once Firebase is up. */
export function teleAttach(getDb) {
  _getDb = getDb
  scheduleFlush(8000)
}
