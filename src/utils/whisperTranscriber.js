// ── On-device Whisper over the captured class audio ────────────────────────
// No key, no server, nothing leaves the machine: transformers.js v3 runs the
// quantized multilingual whisper-base (~75 MB, handles English + Tagalog
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

const T_URLS = [
  'https://esm.sh/@huggingface/transformers@3.3.3',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/+esm',
]
const MODEL = 'onnx-community/whisper-base'

const WORKER_SRC = `
let pipe = null
async function load(progress) {
  let mod = null, err = null
  for (const u of ${JSON.stringify(T_URLS)}) {
    try { mod = await import(u); break } catch (e) { err = e }
  }
  if (!mod) throw err || new Error('transformers.js failed to load')
  const opts = { dtype: 'q8', progress_callback: progress }
  try {
    pipe = await mod.pipeline('automatic-speech-recognition', '${MODEL}', { ...opts, device: 'webgpu' })
  } catch {
    pipe = await mod.pipeline('automatic-speech-recognition', '${MODEL}', { ...opts, device: 'wasm' })
  }
}
self.onmessage = async e => {
  const { type, id, audio } = e.data
  try {
    if (type === 'init') {
      await load(p => {
        if (p && p.status === 'progress' && p.file && /onnx/.test(p.file)) {
          self.postMessage({ type: 'model', pct: Math.round(p.progress || 0) })
        }
      })
      self.postMessage({ type: 'ready', id })
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

// Decode one captured segment to 16 kHz mono Float32 PCM. A dedicated
// AudioContext at 16 kHz makes the browser do the resample during decode.
async function decodeTo16kMono(blob) {
  const AC = window.AudioContext || window.webkitAudioContext
  const ac = new AC({ sampleRate: 16000 })
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer())
    const ch0 = buf.getChannelData(0)
    if (buf.numberOfChannels === 1) return new Float32Array(ch0)
    const out = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c)
      for (let i = 0; i < buf.length; i++) out[i] += ch[i] / buf.numberOfChannels
    }
    return out
  } finally {
    try { await ac.close() } catch { /* closed */ }
  }
}

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
  const worker = new Worker(
    URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })),
    { type: 'module' },
  )
  const call = (msg, transfer) => new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2)
    const onMsg = e => {
      const d = e.data
      if (d.type === 'model') { onProgress?.({ stage: 'model', pct: d.pct }); return }
      if (d.id !== id) return
      worker.removeEventListener('message', onMsg)
      if (d.type === 'error') reject(new Error(d.message))
      else resolve(d)
    }
    worker.addEventListener('message', onMsg)
    worker.postMessage({ ...msg, id }, transfer || [])
  })

  const lines = []
  try {
    await call({ type: 'init' })
    const events = (speakers || []).slice().sort((a, b) => a.t - b.t)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      let audio
      try { audio = await decodeTo16kMono(seg.blob) } catch { continue }
      if (!audio || audio.length < 16000) continue // under a second of audio
      const { chunks } = await call({ type: 'run', audio }, [audio.buffer])
      let prevText = ''
      for (const c of chunks) {
        const text = String(c.text || '').trim()
        if (!text || text === prevText) continue // long-form hallucination guard
        prevText = text
        const off = Array.isArray(c.ts) && typeof c.ts[0] === 'number' ? c.ts[0] : 0
        const at = (seg.startedAt || 0) + Math.round(off * 1000)
        lines.push({ at, name: speakerAt(events, at) || 'Class', text })
      }
      onProgress?.({ stage: 'transcribe', pct: Math.round(((i + 1) / segments.length) * 100) })
    }
  } finally {
    worker.terminate()
  }
  lines.sort((a, b) => a.at - b.at)
  return lines
}
