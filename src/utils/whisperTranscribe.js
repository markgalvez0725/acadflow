// ── Whisper fallback transcriber (on-device, CDN) ────────────────────────────
// The browser's built-in SpeechRecognition opens its OWN microphone capture,
// and on plenty of systems it goes silently deaf while WebRTC already holds
// the mic (and Firefox has no engine at all). This fallback cannot go deaf:
// it transcribes the SAME MediaStream the meeting already captured, feeding
// RMS-gated utterance chunks into Whisper (Xenova/whisper-tiny, multilingual,
// ~40 MB quantized) via Transformers.js - the exact CDN + caching pattern the
// Smart features already use (see utils/embeddings.js; CSP already allows
// esm.sh / jsdelivr / huggingface). Everything runs in-browser; nothing about
// the class audio is uploaded anywhere.
//
// Used by useMeetingRoom when SpeechRecognition is unsupported OR its deaf-
// engine watchdog trips (speech energy seen, zero results). Same contract as
// utils/transcribe.js: silent, per-speaker, onFlush(text) with finished
// phrases only.

import { loadEsmOnce } from '@/utils/cdnLoader'

const TRANSFORMERS_URLS = [
  'https://esm.sh/@xenova/transformers@2.17.2',
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm',
]
const MODEL = 'Xenova/whisper-tiny'
const TARGET_SR = 16000

// Room language codes -> Whisper language names (unknown codes let the model
// auto-detect, which it does per-chunk).
const WHISPER_LANG = {
  'en-PH': 'english', 'fil-PH': 'tagalog', 'es-ES': 'spanish', 'zh-CN': 'chinese',
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
const MAX_QUEUE = 2
const WARMUP_TIMEOUT_MS = 120000

export function whisperSupported() {
  return typeof window !== 'undefined'
    && typeof WebAssembly !== 'undefined'
    && !!(window.AudioContext || window.webkitAudioContext)
}

let _asrPromise = null

function ensureAsr() {
  if (!_asrPromise) {
    _asrPromise = (async () => {
      const mod = await loadEsmOnce(TRANSFORMERS_URLS, { cacheKey: 'transformers' })
      if (mod.env) { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true }
      let timer
      const guard = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('Timed out loading the speech model')), WARMUP_TIMEOUT_MS)
      })
      try {
        return await Promise.race([mod.pipeline('automatic-speech-recognition', MODEL, { quantized: true }), guard])
      } finally {
        clearTimeout(timer)
      }
    })().catch(err => { _asrPromise = null; throw err })
  }
  return _asrPromise
}

// Start the (~40 MB, cached after first use) download ahead of the switch so
// engaging the fallback loses as little speech as possible. Errors swallowed.
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

// Nearest-sample downsample to 16 kHz - Whisper only needs speech bandwidth.
function downsample(f32, fromRate) {
  if (fromRate === TARGET_SR) return f32
  const ratio = fromRate / TARGET_SR
  const out = new Float32Array(Math.floor(f32.length / ratio))
  for (let i = 0; i < out.length; i++) out[i] = f32[Math.floor(i * ratio)]
  return out
}

// Start transcribing `stream` (the meeting's own local MediaStream). Returns
// { stop() } or null when it cannot run here. onFlush(text) receives one
// finished utterance at a time.
export function startWhisperTranscriber({ stream, lang, onFlush } = {}) {
  if (!whisperSupported() || !stream || !stream.getAudioTracks().length) return null
  const AC = window.AudioContext || window.webkitAudioContext
  let ac, src, proc, sink
  try {
    ac = new AC()
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
  ac.resume().catch(() => { /* resumes with playback */ })
  prewarmWhisper()

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

  async function pump() {
    if (inferring || stopped || !queue.length) return
    inferring = true
    const audio = queue.shift()
    try {
      const asr = await ensureAsr()
      if (stopped) return
      const opts = { task: 'transcribe' }
      const name = WHISPER_LANG[lang || '']
      if (name) opts.language = name
      const out = await asr(audio, opts)
      const text = String(out?.text || '').trim()
      // Skip empties and immediate repeats (Whisper's echo on borderline audio).
      if (text && text !== lastText && !stopped && onFlush) {
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
      finalizeUtter()
      queue.length = 0
      try { proc.disconnect() } catch { /* noop */ }
      try { src.disconnect() } catch { /* noop */ }
      try { sink.disconnect() } catch { /* noop */ }
      try { ac.close() } catch { /* noop */ }
    },
  }
}
