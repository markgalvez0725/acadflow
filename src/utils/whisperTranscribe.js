// ── Whisper transcriber (on-device, keyless, CDN) ────────────────────────────
// The meeting's PRIMARY transcription engine. It reads the SAME MediaStream
// the meeting captured (the browser's built-in SpeechRecognition opens its own
// mic capture and goes silently deaf while WebRTC holds the microphone), cuts
// speech into RMS-gated utterances, and transcribes them fully in-browser via
// Transformers.js v3 - no API key, no server, class audio never leaves the
// device. Library from esm.sh/jsdelivr, model weights from the Hugging Face
// CDN (all already in the deployed CSP; see utils/embeddings.js for the same
// pattern on v2, which keeps its own separate cache).
//
// Accuracy comes from a DEVICE ladder, best-first:
//   webgpu + whisper-large-v3-turbo (~600 MB q4) - near large-v3 quality,
//     runs on WebGPU-capable browsers (most recent desktop Chrome/Edge)
//   wasm whisper-small (~250 MB) / base (~80 MB) / tiny (~40 MB)
// The starting tier is picked from hardware, remembered per device, and both
// guards walk DOWN the ladder: load failures (no WebGPU, OOM, timeout) and a
// speed guard when inference cannot keep up with real time. All downloads are
// one-time (browser-cached). Same contract as utils/transcribe.js: silent,
// per-speaker, onFlush(text) with finished phrases only.

import { loadEsmOnce } from '@/utils/cdnLoader'

const TRANSFORMERS_URLS = [
  'https://esm.sh/@huggingface/transformers@3.1.2',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2/+esm',
]

const TIERS = [
  { model: 'onnx-community/whisper-large-v3-turbo', device: 'webgpu', dtype: 'q4' },
  { model: 'Xenova/whisper-small', device: 'wasm', dtype: 'q8' },
  { model: 'Xenova/whisper-base', device: 'wasm', dtype: 'q8' },
  { model: 'Xenova/whisper-tiny', device: 'wasm', dtype: 'q8' },
]
const TIER_KEY = 'acadflow_whisper_tier2' // new key: indices shifted vs the old ladder
const TARGET_SR = 16000

// Room language codes -> Whisper language hints. 'en-PH' (the default) is
// deliberately ABSENT: PH classrooms code-switch mid-sentence, and forcing
// English is exactly what produced "(speaking in foreign language)" junk -
// per-utterance auto-detect handles Taglish correctly. Explicit picks force.
const WHISPER_LANG = {
  'fil-PH': 'tagalog', 'es-ES': 'spanish', 'zh-CN': 'chinese',
  'ja-JP': 'japanese', 'ko-KR': 'korean', 'ar-SA': 'arabic', 'hi-IN': 'hindi',
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
const MERGE_CAP_S = 25 // queued utterances merge into one inference up to this long
const WARMUP_TIMEOUT_MS = 480000 // the turbo tier is a ~600 MB one-time download

export function whisperSupported() {
  return typeof window !== 'undefined'
    && typeof WebAssembly !== 'undefined'
    && !!(window.AudioContext || window.webkitAudioContext)
}

// Starting tier: remembered per device (a past downshift sticks), otherwise
// picked from hardware - turbo needs WebGPU, whisper-small a capable CPU.
let _tier = null
function currentTier() {
  if (_tier !== null) return _tier
  try {
    const saved = parseInt(localStorage.getItem(TIER_KEY), 10)
    if (Number.isInteger(saved) && saved >= 0 && saved < TIERS.length) { _tier = saved; return _tier }
  } catch { /* private mode */ }
  const gpu = typeof navigator !== 'undefined' && !!navigator.gpu
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4
  _tier = gpu ? 0 : (cores >= 8 && mem >= 8 ? 1 : 2)
  return _tier
}
function downshiftTier() {
  if (currentTier() >= TIERS.length - 1) return false
  _tier = currentTier() + 1
  try { localStorage.setItem(TIER_KEY, String(_tier)) } catch { /* private mode */ }
  return true
}

const _pipes = new Map() // tier index -> pipeline promise

function ensureAsr() {
  const tier = currentTier()
  if (!_pipes.has(tier)) {
    const { model, device, dtype } = TIERS[tier]
    const p = (async () => {
      const mod = await loadEsmOnce(TRANSFORMERS_URLS, { cacheKey: 'transformers3' })
      if (mod.env) { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true }
      let timer
      const guard = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('Timed out loading the speech model')), WARMUP_TIMEOUT_MS)
      })
      try {
        return await Promise.race([
          mod.pipeline('automatic-speech-recognition', model, { device, dtype }),
          guard,
        ])
      } finally {
        clearTimeout(timer)
      }
    })().catch(err => { _pipes.delete(tier); throw err })
    _pipes.set(tier, p)
  }
  return _pipes.get(tier)
}

// Start the (one-time, browser-cached) download ahead of first speech so as
// little as possible is lost. Errors swallowed.
export function prewarmWhisper() {
  if (!whisperSupported()) return
  ensureAsr().catch(() => {})
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
// finished utterance at a time. onState reports 'loading' (one-time model
// download), 'on' (capturing) or 'unavailable' (every tier failed) so the
// room bar can show a live status dot.
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
  state('loading')
  // Eager-load the best tier this device can hold; failures walk down the
  // ladder instead of giving up - some transcript always beats none.
  ;(async () => {
    for (;;) {
      try { await ensureAsr(); if (!stopped) state('on'); return }
      catch { if (!downshiftTier()) { if (!stopped) state('unavailable'); return } }
    }
  })()
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

  async function pump() {
    if (inferring || stopped || !queue.length) return
    inferring = true
    // Merge queued utterances into one inference - fewer, meatier runs give
    // Whisper more context and keep long monologues from piling up a queue.
    let audio = queue.shift()
    while (queue.length && audio.length + queue[0].length <= MERGE_CAP_S * TARGET_SR) {
      const nxt = queue.shift()
      const merged = new Float32Array(audio.length + nxt.length)
      merged.set(audio, 0)
      merged.set(nxt, audio.length)
      audio = merged
    }
    try {
      if (!_pipes.has(currentTier())) state('loading')
      let asr
      for (;;) {
        try { asr = await ensureAsr(); break }
        catch { if (!downshiftTier()) { state('unavailable'); throw new Error('no model') } }
      }
      if (stopped) return
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
      const text = String(out?.text || '').trim()
      // Skip empties, punctuation-only outputs, and immediate repeats
      // (Whisper's echo/filler on borderline audio).
      const letters = text.replace(/[^\p{L}\p{N}]/gu, '')
      if (text && letters.length >= 2 && text !== lastText && !stopped && onFlush) {
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
