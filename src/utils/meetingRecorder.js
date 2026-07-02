// ── 720p meeting recorder (professor's device) ──────────────────────────────
// Composites the in-app class onto a hidden 1280x720 canvas - the presenter's
// screen fills the frame when someone is sharing, otherwise a tile grid with
// initials for cameras that are off - and mixes EVERYONE's audio (remote
// streams + the professor's own mic) into one track with the Web Audio API.
// The combined stream records as .webm through MediaRecorder; each timeslice
// chunk is handed to the caller, which streams it into Google Drive
// (googleDrive.startResumableUpload). Resolution is hard-capped at 720p.

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

function pickMime() {
  const prefs = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  for (const m of prefs) { try { if (MediaRecorder.isTypeSupported(m)) return m } catch { /* keep trying */ } }
  return ''
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

// Draw a video into a rect, cropped to fill (cover).
function drawCover(ctx, el, x, y, w, h) {
  const vw = el.videoWidth, vh = el.videoHeight
  if (!vw || !vh) return false
  const scale = Math.max(w / vw, h / vh)
  const sw = w / scale, sh = h / scale
  ctx.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h)
  return true
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
  const audioNodes = new Map() // stream.id -> MediaStreamAudioSourceNode
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
    for (const [id, node] of [...audioNodes]) {
      if (!want.has(id)) { try { node.disconnect() } catch { /* gone */ } audioNodes.delete(id) }
    }
    for (const [id, s] of want) {
      if (audioNodes.has(id)) continue
      try {
        const node = ac.createMediaStreamSource(s)
        node.connect(dest)
        audioNodes.set(id, node)
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
      if (t.stream && t.camOn !== false) drew = drawCover(ctx, videoFor(t.key, t.stream), x, y, tw, th)
      if (!drew) drawAvatar(ctx, t.name, x + tw / 2, y + th / 2, Math.min(tw, th) * 0.22)
      drawLabel(ctx, t.name || '', x + 8, y + th - 10)
    })
  }

  return {
    setScene,
    start() {
      ac.resume().catch(() => { /* resumes with the stream */ })
      draw()
      const stream = canvas.captureStream(FPS)
      const audioTrack = dest.stream.getAudioTracks()[0]
      if (audioTrack) stream.addTrack(audioTrack)
      const mimeType = pickMime()
      mr = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 1_500_000, // 720p budget - clear for slides + faces
        audioBitsPerSecond: 96_000,
      })
      mr.ondataavailable = e => { if (e.data && e.data.size && onChunk) onChunk(e.data) }
      mr.onerror = e => { if (onError) onError(e?.error || new Error('Recorder failed.')) }
      mr.start(4000) // hand a chunk to the Drive uploader every 4s
      timer = setInterval(draw, Math.round(1000 / FPS))
    },
    // Resolves after the FINAL chunk has been delivered to onChunk.
    stop() {
      return new Promise(resolve => {
        const cleanup = () => {
          if (timer) { clearInterval(timer); timer = null }
          for (const [, el] of videoEls) el.srcObject = null
          videoEls.clear()
          for (const [, node] of audioNodes) { try { node.disconnect() } catch { /* noop */ } }
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
