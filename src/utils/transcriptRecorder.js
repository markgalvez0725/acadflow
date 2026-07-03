// ── Speech-tuned parallel audio capture for on-device transcription ────────
// Runs beside the video recorder while a class records (about 1% of a core -
// it must never add meeting lag). Quality chain, in order:
//   every mic is already echo-cancelled / noise-suppressed / auto-gained by
//   getUserMedia -> all voices summed to MONO -> 90 Hz high-pass (room
//   rumble, laptop fan lows) -> gentle compressor that lifts quiet students
//   toward the level of loud ones (the classic classroom ASR killer) ->
//   96 kbps Opus (transparent for speech).
// The MediaRecorder is restarted every SEGMENT_MS so EVERY file is
// self-contained and independently decodable; each finished segment is
// handed to onSegment(blob, index, startedAtMs) with its absolute wall-clock
// start - that is what keeps the transcript's timestamps in sync with who
// was speaking when.

const SEGMENT_MS = 5 * 60000

function pickMime() {
  const tries = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const t of tries) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t } catch { /* next */ }
  }
  return ''
}

export function transcriptCaptureSupported() {
  return typeof window !== 'undefined' && !!window.MediaRecorder && !!pickMime()
}

export function createTranscriptRecorder({ onSegment }) {
  const ac = new (window.AudioContext || window.webkitAudioContext)()
  const dest = ac.createMediaStreamDestination()
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 90
  const comp = ac.createDynamicsCompressor()
  comp.threshold.value = -26
  comp.knee.value = 18
  comp.ratio.value = 3
  comp.attack.value = 0.003
  comp.release.value = 0.25
  hp.connect(comp)
  comp.connect(dest)

  const taps = new Map() // MediaStream.id -> { src, stream }
  const mime = pickMime()
  let recorder = null
  let chunks = []
  let segIndex = 0
  let segStart = 0
  let rotate = null
  let stopped = false
  let flushChain = Promise.resolve()

  // Same contract as the video recorder's audio side: call with the CURRENT
  // set of streams whenever the roster changes; stale taps are disconnected.
  function setAudioStreams(streams) {
    if (stopped) return
    const seen = new Set()
    for (const stream of streams || []) {
      if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) continue
      seen.add(stream.id)
      const cur = taps.get(stream.id)
      if (cur && cur.stream === stream) continue
      if (cur) { try { cur.src.disconnect() } catch { /* gone */ } }
      try {
        const src = ac.createMediaStreamSource(stream)
        src.connect(hp)
        taps.set(stream.id, { src, stream })
      } catch { /* stream not tappable yet */ }
    }
    for (const id of [...taps.keys()]) {
      if (!seen.has(id)) {
        try { taps.get(id).src.disconnect() } catch { /* gone */ }
        taps.delete(id)
      }
    }
  }

  function startSegment() {
    if (stopped || !mime) return
    recorder = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 96000 })
    chunks = []
    segStart = Date.now()
    const myIndex = segIndex
    const myStart = segStart
    const mine = recorder
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(';')[0] })
      chunks = []
      if (blob.size > 0) {
        flushChain = flushChain.then(() => onSegment(blob, myIndex, myStart)).catch(() => { /* segment lost, next one still lands */ })
      }
      if (mine === recorder) recorder = null
    }
    recorder.start()
    segIndex += 1
  }

  return {
    setAudioStreams,
    start() {
      if (stopped) return
      if (ac.state === 'suspended') ac.resume().catch(() => { /* stays quiet */ })
      startSegment()
      rotate = setInterval(() => {
        try { recorder && recorder.state !== 'inactive' && recorder.stop() } catch { /* already stopping */ }
        startSegment()
      }, SEGMENT_MS)
    },
    async stop() {
      if (stopped) return
      stopped = true
      if (rotate) { clearInterval(rotate); rotate = null }
      try {
        if (recorder && recorder.state !== 'inactive') {
          await new Promise(res => {
            const r = recorder
            const prev = r.onstop
            r.onstop = e => { try { prev && prev(e) } finally { res() } }
            try { r.stop() } catch { res() }
          })
        }
      } catch { /* last segment best-effort */ }
      await flushChain
      for (const t of taps.values()) { try { t.src.disconnect() } catch { /* gone */ } }
      taps.clear()
      try { await ac.close() } catch { /* already closed */ }
    },
  }
}
