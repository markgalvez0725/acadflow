// ── Whisper transcriber (server-accurate, on-device resilient) ───────────────
// The meeting's PRIMARY transcription engine. It reads the SAME MediaStream
// the meeting captured (the browser's built-in SpeechRecognition opens its own
// mic capture and goes silently deaf while WebRTC holds the microphone), cuts
// speech into RMS-gated utterances, and transcribes each one through a
// two-level engine:
//   1. SERVER: whisper-large-v3 via the shared Groq route (api/generate-quiz,
//      audio mode) - maximum accuracy, handles Taglish code-switching. Only
//      the speaker's own finished utterances are sent, over the app's own API.
//   2. LOCAL: on-device Whisper ladder via Transformers.js (same CDN + caching
//      pattern as utils/embeddings.js) whenever the server says 501 (no key),
//      rate-limits, errors, or the device is offline. Nothing leaves the
//      device on this path.
// Same contract as utils/transcribe.js: silent, per-speaker, onFlush(text)
// with finished phrases only.

import { loadEsmOnce } from '@/utils/cdnLoader'
import { getIdToken } from '@/firebase/firebaseInit'

const TRANSFORMERS_URLS = [
  'https://esm.sh/@xenova/transformers@2.17.2',
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm',
]

// Model ladder, best-first. All multilingual, all quantized, all cached by
// the browser after the first download:
//   whisper-small ~250 MB - the biggest that is practical in-browser
//   whisper-base   ~80 MB - solid middle ground
//   whisper-tiny   ~40 MB - the floor for weak hardware
// The starting tier is picked from device capability, remembered per device,
// and the pump() speed guard DOWNSHIFTS mid-class if inference cannot keep up
// with real time - accuracy on strong machines, no backlog on weak ones.
const MODELS = ['Xenova/whisper-small', 'Xenova/whisper-base', 'Xenova/whisper-tiny']
const TIER_KEY = 'acadflow_whisper_tier'
const TARGET_SR = 16000

// Room language codes -> Whisper language hints. 'en-PH' (the default) is
// deliberately ABSENT from both maps: PH classrooms code-switch mid-sentence,
// and forcing English is exactly what produced "(speaking in foreign
// language)" junk - auto-detect per utterance handles Taglish correctly.
// Local map uses Whisper language names; the server takes ISO-639-1 codes.
const WHISPER_LANG = {
  'fil-PH': 'tagalog', 'es-ES': 'spanish', 'zh-CN': 'chinese',
  'ja-JP': 'japanese', 'ko-KR': 'korean', 'ar-SA': 'arabic', 'hi-IN': 'hindi',
}
const SERVER_LANG = {
  'fil-PH': 'tl', 'es-ES': 'es', 'zh-CN': 'zh',
  'ja-JP': 'ja', 'ko-KR': 'ko', 'ar-SA': 'ar', 'hi-IN': 'hi',
}

// Utterance shaping: an utterance closes after 1s of trailing silence (or at
// 15s hard cap) and must contain at least 0.7s of voiced audio to be worth an
// inference. The gate also keeps Whisper away from pure silence, where it is
// known to hallucinate filler phrases.
const RMS_GATE = 0.008
const MAX_UTTER_S = 15
const END_SILENCE_S = 1.0
const MIN_VOICED_S = 0.7
const MAX_QUEUE = 4
const MERGE_CAP_S = 25 // queued utterances merge into one request up to this long
const WARMUP_TIMEOUT_MS = 300000 // generous: whisper-small is a ~250 MB first download

export function whisperSupported() {
  return typeof window !== 'undefined'
    && typeof WebAssembly !== 'undefined'
    && !!(window.AudioContext || window.webkitAudioContext)
}

// Starting tier: remembered per device (a past downshift sticks), otherwise
// picked from hardware - whisper-small needs a genuinely capable machine.
let _tier = null
function currentTier() {
  if (_tier !== null) return _tier
  try {
    const saved = parseInt(localStorage.getItem(TIER_KEY), 10)
    if (Number.isInteger(saved) && saved >= 0 && saved < MODELS.length) { _tier = saved; return _tier }
  } catch { /* private mode */ }
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4
  _tier = cores >= 8 && mem >= 8 ? 0 : 1
  return _tier
}
function downshiftTier() {
  if (currentTier() >= MODELS.length - 1) return false
  _tier = currentTier() + 1
  try { localStorage.setItem(TIER_KEY, String(_tier)) } catch { /* private mode */ }
  return true
}

const _pipes = new Map() // model name -> pipeline promise

function ensureAsr() {
  const model = MODELS[currentTier()]
  if (!_pipes.has(model)) {
    const p = (async () => {
      const mod = await loadEsmOnce(TRANSFORMERS_URLS, { cacheKey: 'transformers' })
      if (mod.env) { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true }
      let timer
      const guard = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('Timed out loading the speech model')), WARMUP_TIMEOUT_MS)
      })
      try {
        return await Promise.race([mod.pipeline('automatic-speech-recognition', model, { quantized: true }), guard])
      } finally {
        clearTimeout(timer)
      }
    })().catch(err => { _pipes.delete(model); throw err })
    _pipes.set(model, p)
  }
  return _pipes.get(model)
}

// Start the download ahead of first speech so as little as possible is lost.
// Cached by the browser after the first use. Errors swallowed.
export function prewarmWhisper() {
  if (!whisperSupported()) return
  ensureAsr().catch(() => {})
}

// ── Server engine (whisper-large-v3 via the shared Groq route) ──────────────
// 501 = no key on this deployment: permanent for the page. 429 or repeated
// failures: back off a minute. Everything falls back to the local ladder.
let _serverDead = false
let _serverRetryAt = 0
let _serverFails = 0

// Float32 16 kHz mono -> 16-bit PCM WAV, base64 (JSON-safe for the API).
function wavBase64(f32) {
  const buf = new ArrayBuffer(44 + f32.length * 2)
  const v = new DataView(buf)
  const wstr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  wstr(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); wstr(8, 'WAVE')
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, TARGET_SR, true); v.setUint32(28, TARGET_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  wstr(36, 'data'); v.setUint32(40, f32.length * 2, true)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 0x8000)))
  }
  return btoa(bin)
}

// Returns the transcribed text, or throws (caller falls back to local).
async function serverTranscribe(f32, lang) {
  if (_serverDead || Date.now() < _serverRetryAt) throw new Error('server unavailable')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline')
  const idToken = await getIdToken()
  if (!idToken) throw new Error('not signed in')
  const r = await fetch('/api/generate-quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, audio: wavBase64(f32), lang: SERVER_LANG[lang || ''] || '' }),
  })
  if (r.status === 501) { _serverDead = true; throw new Error('server not configured') }
  if (r.status === 429) { _serverRetryAt = Date.now() + 60000; throw new Error('rate limited') }
  if (!r.ok) {
    if (++_serverFails >= 3) { _serverRetryAt = Date.now() + 60000; _serverFails = 0 }
    throw new Error('server error ' + r.status)
  }
  const data = await r.json().catch(() => null)
  _serverFails = 0
  return String(data?.text || '').trim()
}

function rmsOf(f32) {
  let s = 0
  const step = 4 // sampling every 4th value is plenty for a gate
  let n = 0
  for (let i = 0; i < f32.length; i += step) { s += f32[i] * f32[i]; n++ }
  return Math.sqrt(s / Math.max(1, n))
}

// Box-filter downsample to 16 kHz. Averaging the window (instead of picking
// every Nth sample) suppresses the aliasing that measurably hurt accuracy.
// Only used when the AudioContext could not be created at 16 kHz directly.
function downsample(f32, fromRate) {
  if (fromRate === TARGET_SR) return f32
  const ratio = fromRate / TARGET_SR
  const out = new Float32Array(Math.floor(f32.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(f32.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
    let s = 0
    for (let j = start; j < end; j++) s += f32[j]
    out[i] = s / (end - start)
  }
  return out
}

// Start transcribing `stream` (the meeting's own local MediaStream). Returns
// { stop() } or null when it cannot run here. onFlush(text) receives one
// finished utterance at a time. onState reports 'loading' (model download,
// first use only), 'on' (capturing) or 'unavailable' (model failed to load)
// so the room bar can show a live status dot.
export function startWhisperTranscriber({ stream, lang, onFlush, onState } = {}) {
  if (!whisperSupported() || !stream || !stream.getAudioTracks().length) return null
  const AC = window.AudioContext || window.webkitAudioContext
  let ac, src, proc, sink
  try {
    // Ask for a 16 kHz context so the browser resamples with its own proper
    // low-pass filter (best quality); fall back to the device rate + our
    // box-filter downsample where the option is unsupported.
    try { ac = new AC({ sampleRate: TARGET_SR }) } catch { ac = new AC() }
    src = ac.createMediaStreamSource(stream)
    // ScriptProcessor is deprecated but universal, and unlike AudioWorklet it
    // needs no worklet module fetch. It only runs while routed to the
    // destination, so it flows through a zero-gain sink (nothing is audible).
    proc = ac.createScriptProcessor(4096, 1, 1)
    sink = ac.createGain()
    sink.gain.value = 0
    src.connect(proc)
    proc.connect(sink)
    sink.connect(ac.destination)
  } catch {
    try { if (ac) ac.close() } catch { /* noop */ }
    return null
  }
  const state = s => { if (onState) { try { onState(s) } catch { /* display-only */ } } }
  ac.resume().catch(() => { /* retried by the keepalive below */ })
  // Capture is live from here; the server engine needs no warm-up, and the
  // local ladder only downloads if/when the server is actually unavailable.
  state('on')
  // Autoplay policy can leave the context suspended (a suspended context
  // captures NOTHING); sticky activation from the Join click normally lets
  // resume() succeed, and this keepalive keeps retrying if it did not.
  const keepalive = setInterval(() => {
    if (ac.state === 'suspended') ac.resume().catch(() => { /* keep trying */ })
  }, 4000)

  const srcRate = ac.sampleRate
  let stopped = false
  let pieces = []        // Float32Array frames of the current utterance
  let utterSamples = 0
  let voicedSamples = 0
  let silenceSamples = 0
  let inUtter = false
  const queue = []
  let inferring = false
  let lastText = ''

  function resetUtter() {
    pieces = []
    utterSamples = 0
    voicedSamples = 0
    silenceSamples = 0
    inUtter = false
  }

  function finalizeUtter() {
    const keep = inUtter && voicedSamples >= MIN_VOICED_S * srcRate
    if (keep) {
      const whole = new Float32Array(utterSamples)
      let off = 0
      for (const p of pieces) { whole.set(p, off); off += p.length }
      queue.push(downsample(whole, srcRate))
      while (queue.length > MAX_QUEUE) queue.shift() // stay live, drop the oldest backlog
      pump()
    }
    resetUtter()
  }

  proc.onaudioprocess = e => {
    if (stopped) return
    const input = e.inputBuffer.getChannelData(0)
    const frame = new Float32Array(input) // the engine reuses its buffer
    const voiced = rmsOf(frame) >= RMS_GATE
    if (!inUtter) {
      if (!voiced) return
      inUtter = true
    }
    pieces.push(frame)
    utterSamples += frame.length
    if (voiced) { voicedSamples += frame.length; silenceSamples = 0 }
    else silenceSamples += frame.length
    if (silenceSamples >= END_SILENCE_S * srcRate || utterSamples >= MAX_UTTER_S * srcRate) finalizeUtter()
  }

  let slowStrikes = 0

  // Local ladder inference for one chunk (server unavailable). Reports the
  // one-time model download through the status dot.
  async function localTranscribe(audio) {
    const model = MODELS[currentTier()]
    if (!_pipes.has(model)) state('loading')
    let asr
    for (;;) {
      try { asr = await ensureAsr(); break }
      catch { if (!downshiftTier()) { state('unavailable'); throw new Error('no local model') } }
    }
    if (stopped) return ''
    state('on')
    const opts = { task: 'transcribe' }
    const name = WHISPER_LANG[lang || '']
    if (name) opts.language = name
    const t0 = Date.now()
    const out = await asr(audio, opts)
    // Speed guard: falling behind real time twice in a row means this tier
    // is too heavy for this machine - downshift for the rest of the class
    // (and, via localStorage, for future classes on this device).
    const audioMs = (audio.length / TARGET_SR) * 1000
    if (Date.now() - t0 > audioMs * 1.5) {
      if (++slowStrikes >= 2 && downshiftTier()) slowStrikes = 0
    } else {
      slowStrikes = 0
    }
    return String(out?.text || '').trim()
  }

  async function pump() {
    if (inferring || stopped || !queue.length) return
    inferring = true
    // Merge queued utterances into one request (fewer, meatier calls keeps
    // the route's per-IP rate limit far away even during a long monologue).
    let audio = queue.shift()
    while (queue.length && audio.length + queue[0].length <= MERGE_CAP_S * TARGET_SR) {
      const nxt = queue.shift()
      const merged = new Float32Array(audio.length + nxt.length)
      merged.set(audio, 0)
      merged.set(nxt, audio.length)
      audio = merged
    }
    try {
      let text
      try { text = await serverTranscribe(audio, lang) }        // max accuracy
      catch { text = await localTranscribe(audio) }              // private + offline-safe
      if (stopped) return
      // Skip empties, punctuation-only outputs, and immediate repeats
      // (Whisper's echo/filler on borderline audio).
      const letters = text.replace(/[^\p{L}\p{N}]/gu, '')
      if (text && letters.length >= 2 && text !== lastText && onFlush) {
        lastText = text
        try { onFlush(text) } catch { /* caller's problem */ }
      }
    } catch { /* drop this chunk, keep the session */ }
    finally {
      inferring = false
      if (!stopped && queue.length) setTimeout(pump, 50)
    }
  }

  return {
    stop() {
      stopped = true
      clearInterval(keepalive)
      finalizeUtter()
      queue.length = 0
      try { proc.disconnect() } catch { /* noop */ }
      try { src.disconnect() } catch { /* noop */ }
      try { sink.disconnect() } catch { /* noop */ }
      try { ac.close() } catch { /* noop */ }
    },
  }
}
