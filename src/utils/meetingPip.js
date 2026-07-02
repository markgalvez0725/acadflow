// Pop-out (picture-in-picture) source for the in-app classroom.
//
// requestPictureInPicture can only project a <video> element, and pointing it
// at a raw remote camera goes BLACK the moment that camera is off - which is
// most of the time in lecture mode. So instead of popping out a peer's video,
// the room feeds this tiny compositor: it paints the CURRENT scene onto a
// canvas (presenter screen > any live camera > the same avatar card the
// in-room stage shows, with the real profile photo) and exposes the canvas
// stream through a hidden, always-playing <video> that the pop-out projects.
// The floating window therefore always matches what the room itself displays.
//
// Photos are drawn only after loading cleanly with crossOrigin='anonymous':
// a CORS-tainted canvas kills captureStream for good, while initials never
// taint. Painting is a light setTimeout chain - fast while the pop-out is
// showing or the tab is hidden, slow otherwise. Background-tab throttling is
// not a problem in practice because the room always has remote audio playing,
// which keeps the tab exempt from aggressive timer throttling.

const W = 640
const H = 360

export function createPipSource() {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof canvas.captureStream !== 'function') return null
  let stream = null
  try { stream = canvas.captureStream(12) } catch { return null }

  // The element the pop-out button projects. Kept tiny and off-screen (NOT
  // display:none, so the browser keeps treating it as a live media element).
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;'
  video.srcObject = stream

  // Plays the featured remote stream purely as a drawImage source.
  const feed = document.createElement('video')
  feed.muted = true
  feed.playsInline = true

  const imgCache = new Map() // url -> { img, ok }
  let scene = { stream: null, label: '', sub: '', photo: null, initials: '?', live: true }
  let timer = null
  let dead = false

  function loadPhoto(url) {
    if (!url) return null
    let rec = imgCache.get(url)
    if (!rec) {
      const img = new Image()
      img.crossOrigin = 'anonymous' // only CORS-clean pixels may touch the canvas
      rec = { img, ok: false }
      img.onload = () => { rec.ok = true }
      img.src = url
      imgCache.set(url, rec)
    }
    return rec.ok ? rec.img : null
  }

  function paint() {
    try {
      ctx.fillStyle = '#202124'
      ctx.fillRect(0, 0, W, H)
      const liveVideo = scene.stream && feed.readyState >= 2 && feed.videoWidth > 0
      if (liveVideo) {
        const s = Math.min(W / feed.videoWidth, H / feed.videoHeight)
        const dw = feed.videoWidth * s
        const dh = feed.videoHeight * s
        ctx.drawImage(feed, (W - dw) / 2, (H - dh) / 2, dw, dh)
      } else {
        // Avatar card, matching the in-room cam-off tile.
        const cx = W / 2
        const cy = H / 2 - 14
        const r = 48
        const img = loadPhoto(scene.photo)
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        if (img) {
          ctx.clip()
          const s = Math.max((r * 2) / img.naturalWidth, (r * 2) / img.naturalHeight)
          const dw = img.naturalWidth * s
          const dh = img.naturalHeight * s
          ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
        } else {
          ctx.fillStyle = '#5046e4'
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.font = '700 30px "Plus Jakarta Sans", Lexend, system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(scene.initials || '?', cx, cy + 2)
        }
        ctx.restore()
      }
      // Bottom label bar: who is featured + head count.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, H - 46, W, 46)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'
      ctx.font = '600 15px Lexend, system-ui, sans-serif'
      ctx.fillText(scene.label || '', 14, H - 30, W - 28)
      ctx.fillStyle = '#bdc1c6'
      ctx.font = '500 11px Lexend, system-ui, sans-serif'
      ctx.fillText(scene.sub || '', 14, H - 12, W - 28)
      if (scene.live) {
        ctx.fillStyle = '#dc2626'
        ctx.beginPath()
        ctx.arc(16, 17, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = '800 10px Lexend, system-ui, sans-serif'
        ctx.fillText('LIVE', 26, 17)
      }
    } catch { /* keep the loop alive - a mid-frame track death must not stop painting */ }
  }

  function tick() {
    if (dead) return
    paint()
    const hot = document.pictureInPictureElement === video || document.hidden
    timer = setTimeout(tick, hot ? 100 : 500)
  }

  return {
    video,
    setScene(next) {
      scene = { ...scene, ...next }
      const s = scene.stream || null
      if (feed.srcObject !== s) {
        feed.srcObject = s
        if (s) feed.play().catch(() => { /* muted autoplay is allowed */ })
      }
    },
    start() {
      if (timer || dead) return
      video.play().catch(() => { /* muted autoplay is allowed */ })
      tick()
    },
    destroy() {
      dead = true
      if (timer) clearTimeout(timer)
      timer = null
      try { stream.getTracks().forEach(t => t.stop()) } catch { /* already stopped */ }
      feed.srcObject = null
      video.srcObject = null
    },
  }
}
