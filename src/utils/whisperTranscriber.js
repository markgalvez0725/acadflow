// ── On-device Whisper over the captured class audio ────────────────────────
// No key, no server, nothing leaves the machine: transformers.js v3 runs the
// multilingual whisper-base (~75 MB weights, handles English + Tagalog
// code-switching) on WebGPU where available, WASM otherwise. The model comes
// from the Hugging Face CDN - the SAME hosts the deployed CSP already allows
// for the Smart features - and is cached by the browser after the first run.
//
// Inference lives in a Blob module worker so an hour-long class never blocks
// the UI; audio is decoded on the MAIN thread (workers have no
// decodeAudioData) at 16 kHz mono - exactly what Whisper was trained on -
// and transferred as raw PCM. Segment start times + Whisper's per-phrase
// timestamps + the speaker timeline the room logged while recording combine
// into the legacy transcript shape: { at, name, text }.
//
// dtype matters: Whisper's encoder cannot survive q8 quantization on the
// WebGPU backend (transformers.js issue #1317 - output becomes multilingual
// gibberish while the exact same files work on WASM). WebGPU therefore gets
// the pairing the official Whisper WebGPU demos ship, fp32 encoder + q4
// decoder, and only the WASM path uses plain q8. Belt and braces on top:
// silent segments are skipped before inference, looping phrases collapse to
// one occurrence, and a segment that still decodes to gibberish is retried
// once on WASM, then dropped entirely rather than shown to anyone.

const T_URLS = [
  'https://esm.sh/@huggingface/transformers@3.3.3',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/+esm',
]
const MODEL = 'onnx-community/whisper-base'

const WORKER_SRC = `
let pipe = null
async function load(progress, forceWasm) {
  let mod = null, err = null
  for (const u of ${JSON.stringify(T_URLS)}) {
    try { mod = await import(u); break } catch (e) { err = e }
  }
  if (!mod) throw err || new Error('transformers.js failed to load')
  const prog = { progress_callback: progress }
  if (!forceWasm) {
    try {
      pipe = await mod.pipeline('automatic-speech-recognition', '${MODEL}', {
        ...prog,
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      })
      return 'webgpu'
    } catch { }
  }
  pipe = await mod.pipeline('automatic-speech-recognition', '${MODEL}', { ...prog, device: 'wasm', dtype: 'q8' })
  return 'wasm'
}
self.onmessage = async e => {
  const { type, id, audio, forceWasm } = e.data
  try {
    if (type === 'init') {
      const device = await load(p => {
        if (p && p.status === 'progress' && p.file && /onnx/.test(p.file)) {
          self.postMessage({ type: 'model', pct: Math.round(p.progress || 0) })
        }
      }, forceWasm)
      self.postMessage({ type: 'ready', id, device })
    } else if (type === 'run') {
      const out = await pipe(audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })
      self.postMessage({
        type: 'done',
        id,
        chunks: (out && out.chunks ? out.chunks : []).map(c => ({ ts: c.timestamp, text: c.text })),
      })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String((err && err.message) || err) })
  }
}
`

// Linear-interpolation resample - the safety net for browsers that ignore the
// requested AudioContext sample rate (feeding 48 kHz samples as if they were
// 16 kHz is another guaranteed gibberish source).
function resampleTo16k(data, fromRate) {
  if (!fromRate || fromRate === 16000) return data
  const ratio = fromRate / 16000
  const n = Math.floor(data.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const pos = i * ratio
    const j = Math.floor(pos)
    const k = Math.min(j + 1, data.length - 1)
    out[i] = data[j] + (data[k] - data[j]) * (pos - j)
  }
  return out
}

// Decode one captured segment to 16 kHz mono Float32 PCM. A dedicated
// AudioContext at 16 kHz makes the browser do the resample during decode;
// resampleTo16k covers the browsers that clamp the requested rate.
async function decodeTo16kMono(blob) {
  const AC = window.AudioContext || window.webkitAudioContext
  let ac = null
  try { ac = new AC({ sampleRate: 16000 }) } catch { ac = new AC() }
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer())
    let mono
    if (buf.numberOfChannels === 1) mono = new Float32Array(buf.getChannelData(0))
    else {
      mono = new Float32Array(buf.length)
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c)
        for (let i = 0; i < buf.length; i++) mono[i] += ch[i] / buf.numberOfChannels
      }
    }
    return resampleTo16k(mono, buf.sampleRate)
  } finally {
    try { await ac.close() } catch { /* closed */ }
  }
}

// Loudest 1-second RMS in the segment. Below SILENCE_RMS the mic was muted or
// the room was empty - Whisper fed silence invents text, so skip inference.
const SILENCE_RMS = 0.0025
function loudestRms(audio) {
  const win = 16000, hop = 8000
  let best = 0
  for (let s = 0; s + win <= audio.length; s += hop) {
    let sum = 0
    for (let i = s; i < s + win; i++) sum += audio[i] * audio[i]
    const rms = Math.sqrt(sum / win)
    if (rms > best) best = rms
  }
  if (!best && audio.length) {
    let sum = 0
    for (let i = 0; i < audio.length; i++) sum += audio[i] * audio[i]
    best = Math.sqrt(sum / audio.length)
  }
  return best
}

// Gibberish detector. Classes here are Tagalog + English (Latin script), so a
// segment full of replacement chars or CJK/Hangul/Cyrillic glyphs is a broken
// decode, not speech. Thresholds are loose enough that a quoted foreign word
// or a name never trips them.
const NON_LATIN_RE = /[\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g
function looksGarbled(text) {
  if (!text) return false
  const bad = (text.match(/\ufffd/g) || []).length
  if (bad >= 3) return true
  const nonLatin = (text.match(NON_LATIN_RE) || []).length
  if (!nonLatin) return false
  const letters = (text.match(/[a-z\u00c0-\u024f]/gi) || []).length
  return nonLatin / (nonLatin + letters || 1) > 0.22
}

// Whisper's decoder can lock into a loop and emit the same phrase dozens of
// times inside one 30 s chunk. Collapse any immediately-repeated word block
// (2..20 words) down to a single occurrence.
function collapseLoops(text) {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (words.length < 6) return words.join(' ')
  const maxN = Math.min(20, Math.floor(words.length / 2))
  for (let n = maxN; n >= 2; n--) {
    let i = 0
    while (i + 2 * n <= words.length) {
      const a = words.slice(i, i + n).join(' ').toLowerCase()
      const b = words.slice(i + n, i + 2 * n).join(' ').toLowerCase()
      if (a === b) words.splice(i + n, n)
      else i++
    }
  }
  return words.join(' ')
}

// Classic silence hallucinations whisper-base emits when nobody talks.
const JUNK_RE = /^(you|bye|thank you( very much| so much)?|thanks? for watching|please (like and )?subscribe|subtitles by [^]*)[\s.!,]*$/i

// Who was speaking at absolute time t, from the timeline the room logged
// (events: [{ t, names: [] }], appended only when the speaking set changed).
function speakerAt(events, t) {
  if (!events || !events.length) return ''
  let best = null
  for (const e of events) {
    if (e.t <= t + 1200) best = e
    else break
  }
  if (!best || !best.names || !best.names.length) return ''
  return best.names.length === 1 ? best.names[0] : best.names.join(' + ')
}

// segments: [{ blob, startedAt }] in order; speakers: timeline events.
// onProgress({ stage: 'model' | 'transcribe', pct }).
export async function transcribeSession({ segments, speakers, onProgress }) {
  let worker = null
  let device = ''

  const call = (msg, transfer) => new Promise((resolve, reject) => {
    const w = worker
    const id = Math.random().toString(36).slice(2)
    const onMsg = e => {
      const d = e.data
      if (d.type === 'model') { onProgress?.({ stage: 'model', pct: d.pct }); return }
      if (d.id !== id) return
      w.removeEventListener('message', onMsg)
      if (d.type === 'error') reject(new Error(d.message))
      else resolve(d)
    }
    w.addEventListener('message', onMsg)
    w.postMessage({ ...msg, id }, transfer || [])
  })

  const spawn = async forceWasm => {
    if (worker) worker.terminate()
    worker = new Worker(
      URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })),
      { type: 'module' },
    )
    const ready = await call({ type: 'init', forceWasm: !!forceWasm })
    device = ready.device || (forceWasm ? 'wasm' : '')
  }

  const lines = []
  try {
    await spawn(false)
    const events = (speakers || []).slice().sort((a, b) => a.t - b.t)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const bump = () => onProgress?.({ stage: 'transcribe', pct: Math.round(((i + 1) / segments.length) * 100) })
      let audio
      try { audio = await decodeTo16kMono(seg.blob) } catch { bump(); continue }
      if (!audio || audio.length < 16000) { bump(); continue } // under a second
      if (loudestRms(audio) < SILENCE_RMS) { bump(); continue } // dead air

      // Transferring detaches the buffer, so keep a copy while the engine is
      // still WebGPU in case this segment needs the WASM retry.
      let retryCopy = device === 'webgpu' ? audio.slice() : null
      let { chunks } = await call({ type: 'run', audio }, [audio.buffer])
      if (device === 'webgpu' && looksGarbled(chunks.map(c => c.text).join(' '))) {
        await spawn(true) // this GPU garbles Whisper - finish the job on WASM
        const redo = await call({ type: 'run', audio: retryCopy }, [retryCopy.buffer])
        chunks = redo.chunks
      }
      retryCopy = null
      if (looksGarbled(chunks.map(c => c.text).join(' '))) { bump(); continue }

      let prevText = ''
      for (const c of chunks) {
        const text = collapseLoops(String(c.text || '').trim())
        if (!text || text === prevText) continue // long-form hallucination guard
        if (JUNK_RE.test(text) || looksGarbled(text)) continue
        prevText = text
        const off = Array.isArray(c.ts) && typeof c.ts[0] === 'number' ? c.ts[0] : 0
        const at = (seg.startedAt || 0) + Math.round(off * 1000)
        lines.push({ at, name: speakerAt(events, at) || 'Class', text })
      }
      bump()
    }
  } finally {
    if (worker) worker.terminate()
  }
  lines.sort((a, b) => a.at - b.at)
  return lines
}
