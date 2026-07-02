// ── 720p meeting recorder (professor's device) ──────────────────────────────
// Composites the in-app class onto a hidden 1280x720 canvas - the presenter's
// screen fills the frame when someone is sharing, otherwise a tile grid with
// initials for cameras that are off - and mixes EVERYONE's audio (remote
// streams + the professor's own mic) into one track with the Web Audio API.
// Each MediaRecorder timeslice chunk is handed to the caller, which streams
// it into Google Drive (googleDrive.startResumableUpload). 720p hard cap.
//
// Container: MP4 (H.264 + AAC) whenever the browser can mux it - the encode
// is hardware-accelerated (lighter on the teaching device than software VP8),
// Google Drive turns it previewable much faster than WebM, and the downloaded
// file plays natively everywhere including iPhones. Chrome/Safari write the
// moov header first on fragmented MP4, so streamed chunks concatenate into a
// valid file exactly like WebM clusters do. Browsers without an MP4 muxer
// (or without a platform H.264 encoder) fall down the ladder to WebM.

const W = 1280
const H = 720
const FPS = 15
const GAP = 12

export function recordingSupported() {
  return typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined'
    && !!HTMLCanvasElement.prototype.captureStream
    && !!(window.AudioContext || window.webkitAudioContext)
}

const FORMAT_LADDER = [
  { mime: 'video/mp4;codecs="avc1.640028,mp4a.40.2"', ext: 'mp4', container: 'video/mp4' },  // H.264 High + AAC
  { mime: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: 'mp4', container: 'video/mp4' },  // H.264 Baseline + AAC
  { mime: 'video/mp4', ext: 'mp4', container: 'video/mp4' },                                 // UA default mp4 codecs
  { mime: 'video/webm;codecs=h264,opus', ext: 'webm', container: 'video/webm' },             // HW video, webm shell
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', container: 'video/webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', container: 'video/webm' },
  { mime: 'video/webm', ext: 'webm', container: 'video/webm' },
]

function pickFormat() {
  for (const f of FORMAT_LADDER) {
    try { if (MediaRecorder.isTypeSupported(f.mime)) return f } catch { /* keep trying */ }
  }
  return { mime: '', ext: 'webm', container: 'video/webm' } // let the UA choose
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

// Draw a video into a rect, letterboxed (contain).
function drawContain(ctx, el, x, y, w, h) {
  const vw = el.videoWidth, vh = el.videoHeight
  if (!vw || !vh) return false
  const scale = Math.min(w / vw, h / vh)
  const dw = vw * scale, dh = vh * scale
  ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  return true
}

function drawLabel(ctx, text, x, y) {
  ctx.font = '600 15px sans-serif'
  const w = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(x, y - 18, w + 14, 24)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, x + 7, y)
}

function drawAvatar(ctx, name, cx, cy, r) {
  ctx.fillStyle = '#5046e4'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${Math.round(r * 0.7)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials(name), cx, cy)
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}

// Background-safe clock: browsers throttle rAF and page timers hard when the
// tab is hidden, which starves the compositor and makes the recording stutter.
// A Worker's timer is NOT throttled, so the draw loop ticks from a tiny inline
// worker; plain setInterval is the fallback if workers are unavailable.
function makeTicker(fn, ms) {
  try {
    const url = URL.createObjectURL(new Blob(
      ['setInterval(function(){postMessage(0)},' + Math.max(15, ms) + ')'],
      { type: 'text/javascript' }
    ))
    const w = new Worker(url)
    URL.revokeObjectURL(url)
    w.onmessage = fn
    return { stop() { try { w.terminate() } catch { /* gone */ } } }
  } catch {
    const id = setInterval(fn, ms)
    return { stop() { clearInterval(id) } }
  }
}

// Best cols so n 16:9 tiles fit the canvas (same idea as the stage layout).
function gridFor(n) {
  let best = { cols: 1, tw: 0, th: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const availW = (W - GAP * (cols + 1)) / cols
    const availH = (H - GAP * (rows + 1)) / rows
    const tw = Math.min(availW, availH * (16 / 9))
    if (tw > best.tw) best = { cols, tw, th: tw / (16 / 9) }
  }
  return best
}

// onChunk(blob) fires every few seconds; onError(err) on recorder failure.
export function createMeetingRecorder({ onChunk, onError }) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const AC = window.AudioContext || window.webkitAudioContext
  const ac = new AC()
  const dest = ac.createMediaStreamDestination()
  // Summing many voices with no gain staging clips the mix the moment two
  // people talk at once - that clipping is what "choppy / cut" audio sounds
  // like. Every source runs through its own headroom gain into one shared
  // limiter-style compressor, so overlapping speech compresses cleanly
  // instead of distorting.
  const limiter = ac.createDynamicsCompressor()
  limiter.threshold.value = -10
  limiter.knee.value = 8
  limiter.ratio.value = 14
  limiter.attack.value = 0.003
  limiter.release.value = 0.25
  limiter.connect(dest)
  const audioNodes = new Map() // stream.id -> { src, gain }
  const videoEls = new Map()   // key -> detached <video> (playing = drawable)
  let scene = { featured: null, tiles: [], audioStreams: [] }
  let timer = null
  let mr = null

  function videoFor(key, stream) {
    let el = videoEls.get(key)
    if (!el) {
      el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.autoplay = true
      videoEls.set(key, el)
    }
    if (el.srcObject !== stream) {
      el.srcObject = stream || null
      if (stream) el.play().catch(() => { /* resumes on next frame */ })
    }
    return el
  }

  function syncAudio(streams) {
    const want = new Map()
    for (const s of streams) if (s && s.getAudioTracks().length) want.set(s.id, s)
    for (const [id, n] of [...audioNodes]) {
      if (!want.has(id)) {
        try { n.src.disconnect() } catch { /* gone */ }
        try { n.gain.disconnect() } catch { /* gone */ }
        audioNodes.delete(id)
      }
    }
    for (const [id, s] of want) {
      if (audioNodes.has(id)) continue
      try {
        const src = ac.createMediaStreamSource(s)
        const gain = ac.createGain()
        gain.gain.value = 0.85 // headroom so the limiter works, not the clipper
        src.connect(gain)
        gain.connect(limiter)
        audioNodes.set(id, { src, gain })
      } catch { /* stream without live audio yet */ }
    }
  }

  // scene: { featured: {stream, label} | null,
  //          tiles: [{ key, stream, name, camOn }],
  //          audioStreams: [MediaStream] }
  function setScene(next) {
    scene = next || { featured: null, tiles: [], audioStreams: [] }
    syncAudio(scene.audioStreams || [])
    // Drop video elements for keys that left the scene.
    const keys = new Set((scene.tiles || []).map(t => t.key))
    if (scene.featured) keys.add('featured')
    for (const [key, el] of [...videoEls]) {
      if (!keys.has(key)) { el.srcObject = null; videoEls.delete(key) }
    }
  }

  function draw() {
    ctx.fillStyle = '#202124'
    ctx.fillRect(0, 0, W, H)
    const { featured, tiles } = scene
    if (featured && featured.stream) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const el = videoFor('featured', featured.stream)
      drawContain(ctx, el, 0, 0, W, H)
      if (featured.label) drawLabel(ctx, featured.label, 14, H - 16)
      return
    }
    const list = (tiles || []).slice(0, 9) // 9 tiles max on the recording
    if (!list.length) return
    const { cols, tw, th } = gridFor(list.length)
    const rows = Math.ceil(list.length / cols)
    const totalH = rows * th + (rows - 1) * GAP
    const y0 = (H - totalH) / 2
    list.forEach((t, i) => {
      const row = Math.floor(i / cols)
      const inRow = Math.min(cols, list.length - row * cols)
      const rowW = inRow * tw + (inRow - 1) * GAP
      const x = (W - rowW) / 2 + (i % cols) * (tw + GAP)
      const y = y0 + row * (th + GAP)
      ctx.fillStyle = '#3c4043'
      ctx.fillRect(x, y, tw, th)
      let drew = false
      if (t.stream && t.camOn !== false) {
        // Every feed is recorded WHOLE (contain), matching the live tiles -
        // portrait phones and odd-shaped webcams letterbox, never crop.
        drew = drawContain(ctx, videoFor(t.key, t.stream), x, y, tw, th)
      }
      if (!drew) drawAvatar(ctx, t.name, x + tw / 2, y + th / 2, Math.min(tw, th) * 0.22)
      drawLabel(ctx, t.name || '', x + 8, y + th - 10)
    })
  }

  const fmt = pickFormat()

  return {
    setScene,
    // The caller names the Drive file and sets its MIME off these.
    fileExt: fmt.ext,
    fileMime: fmt.container,
    start() {
      ac.resume().catch(() => { /* resumes with the stream */ })
      draw()
      const stream = canvas.captureStream(FPS)
      const audioTrack = dest.stream.getAudioTracks()[0]
      if (audioTrack) stream.addTrack(audioTrack)
      mr = new MediaRecorder(stream, {
        ...(fmt.mime ? { mimeType: fmt.mime } : {}),
        videoBitsPerSecond: 1_500_000, // 720p budget - clear for slides + faces
        audioBitsPerSecond: 128_000,   // voice priority: never starve the audio
      })
      mr.ondataavailable = e => { if (e.data && e.data.size && onChunk) onChunk(e.data) }
      mr.onerror = e => { if (onError) onError(e?.error || new Error('Recorder failed.')) }
      mr.start(4000) // hand a chunk to the Drive uploader every 4s
      timer = makeTicker(draw, Math.round(1000 / FPS))
    },
    // Resolves after the FINAL chunk has been delivered to onChunk.
    stop() {
      return new Promise(resolve => {
        const cleanup = () => {
          if (timer) { timer.stop(); timer = null }
          for (const [, el] of videoEls) el.srcObject = null
          videoEls.clear()
          for (const [, n] of audioNodes) {
            try { n.src.disconnect() } catch { /* noop */ }
            try { n.gain.disconnect() } catch { /* noop */ }
          }
          audioNodes.clear()
          ac.close().catch(() => { /* noop */ })
          resolve()
        }
        if (!mr || mr.state === 'inactive') { cleanup(); return }
        mr.onstop = cleanup
        try { mr.stop() } catch { cleanup() }
      })
    },
  }
}
