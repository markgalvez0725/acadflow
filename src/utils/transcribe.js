// ── Silent per-speaker speech transcription ─────────────────────────────────
// Wraps the browser's built-in SpeechRecognition engine (Chrome/Edge/Safari;
// $0, nothing to install). Each meeting participant transcribes their OWN
// microphone in their OWN language; finished phrases are buffered for a few
// seconds and flushed to the caller, which writes them to the meeting
// transcript. Nothing is ever displayed during the class.
//
// Engine quirks handled here:
//  - recognition self-stops after silence/timeouts: auto-restart while active,
//    with backoff so a hard failure can't hot-loop
//  - 'not-allowed' / 'service-not-allowed' are permanent: stop for good
//  - the recognizer listens even while the WebRTC mic track is disabled, so
//    the CALLER must stop() on mute and start a fresh one on unmute

const LANG_KEY = 'acadflow_meet_lang'

export function speechSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

// Speech languages offered in the room. The browser engine accepts any BCP-47
// tag; this list just keeps the picker short and classroom-relevant.
export const SPEECH_LANGS = [
  { code: 'en-PH', label: 'English' },
  { code: 'fil-PH', label: 'Filipino' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'zh-CN', label: 'Chinese' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'hi-IN', label: 'Hindi' },
]

export function getSpeechLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved) return saved
  } catch { /* private mode */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en-PH'
  return /^(fil|tl)/i.test(nav) ? 'fil-PH' : 'en-PH'
}

export function setSpeechLang(code) {
  try { localStorage.setItem(LANG_KEY, code) } catch { /* private mode */ }
}

// Start transcribing. Returns { stop() }. onFlush(text) receives a few
// seconds of finished speech at a time (never interim guesses). onResult()
// fires on EVERY recognition event (interim included) - it is the liveness
// signal the deaf-engine watchdog in useMeetingRoom listens for.
export function startTranscriber({ lang, onFlush, onResult, flushMs = 5000 } = {}) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null

  let stopped = false
  let rec = null
  let buf = ''
  let flushTimer = null
  let lastStartAt = 0
  let quickDeaths = 0

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    const text = buf.trim()
    buf = ''
    if (text && onFlush) { try { onFlush(text) } catch { /* caller's problem */ } }
  }

  function begin() {
    if (stopped) return
    rec = new Ctor()
    rec.lang = lang || getSpeechLang()
    rec.continuous = true
    // Interim results on: they are never flushed, but asking for them keeps
    // Chrome's recognizer session warm and proves the engine actually hears.
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = e => {
      if (onResult) { try { onResult() } catch { /* watchdog's problem */ } }
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (!r.isFinal) continue
        const t = (r[0]?.transcript || '').trim()
        if (!t) continue
        buf += (buf ? ' ' : '') + t
        if (!flushTimer) flushTimer = setTimeout(flush, flushMs)
      }
    }
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true
      // everything else ('no-speech', 'network', 'aborted') falls through to
      // onend, which restarts
    }
    rec.onend = () => {
      if (stopped) return
      // Backoff if the engine keeps dying instantly (broken service): after a
      // handful of sub-second lifetimes, wait 30s between attempts.
      quickDeaths = Date.now() - lastStartAt < 1000 ? quickDeaths + 1 : 0
      setTimeout(begin, quickDeaths >= 5 ? 30000 : 400)
    }
    try {
      lastStartAt = Date.now()
      rec.start()
    } catch { /* already started - onend will cycle */ }
  }

  begin()

  return {
    stop() {
      stopped = true
      flush()
      try { rec && rec.stop() } catch { /* already stopped */ }
      rec = null
    },
  }
}
