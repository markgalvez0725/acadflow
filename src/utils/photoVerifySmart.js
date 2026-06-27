// ── On-device profile-photo Smart ────────────────────────────────────────────
// Custom, in-browser replacement for the Gemini /api/validate-photo call.
// The student's photo NEVER leaves the device - every model runs client-side:
//
//   • MediaPipe FaceMesh (TF.js)       - fits a 468-point face mesh; used for
//     (face-landmarks-detection)         count, framing, and head angle. A mesh
//                                        model won't fit a face onto a logo or
//                                        object, so it does NOT false-positive
//                                        the way a bare face *detector* does.
//   • MediaPipe Selfie Segmentation    - person/background mask, so we can
//     (TF.js runtime)                    measure the TRUE backdrop, not a guess
//   • Heuristic attire read            - skin-vs-fabric + pattern busyness on
//                                        the segmented torso band
//
// Models lazy-load once from jsdelivr (the app already loads SheetJS/jsPDF the
// same way) and are cached for the session. Weight files are fetched by the
// model packages from their own hosts; the app sets no CSP so this is allowed.
//
// runOnDeviceSmart() returns null ONLY when the models can't load or the canvas is
// tainted - the caller (photoValidate.js) then falls back to legacy heuristics.
// When models load it returns structured signals (any field may be null if that
// individual stage failed):
//   {
//     faces, faceBox, faceFrac, faceCx, frontalScore,  // Stage A
//     bgSupported, bgWhiteFrac,                         // Stage B
//     skinFrac, busyness,                               // Stage C
//   }

const SRC = {
  tf:   'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  mesh: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/face-landmarks-detection@1.0.6/dist/face-landmarks-detection.min.js',
  seg:  'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.2/dist/body-segmentation.min.js',
}

/** Inject a CDN <script> once; resolve when it has loaded. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'))
    const prior = document.querySelector(`script[data-aiphoto="${src}"]`)
    if (prior) {
      if (prior.dataset.loaded) return resolve()
      prior.addEventListener('load', () => resolve())
      prior.addEventListener('error', () => reject(new Error('load failed: ' + src)))
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.dataset.aiphoto = src
    el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve() })
    el.addEventListener('error', () => reject(new Error('load failed: ' + src)))
    document.head.appendChild(el)
  })
}

// The two models load INDEPENDENTLY so a failure in one doesn't disable the
// other. FaceMesh (face/count) is the priority - segmentation is an enhancement
// for background + attire. Each cache clears itself on failure so a later photo
// can retry.
let _corePromise, _facePromise, _segPromise

/** Load TF.js once and pick the WebGL backend. */
function ensureCore() {
  if (!_corePromise) {
    _corePromise = loadScript(SRC.tf).then(async () => {
      const tf = window.tf
      if (tf?.setBackend) {
        try { await tf.setBackend('webgl'); await tf.ready() } catch { /* cpu fallback */ }
      }
    }).catch(err => { _corePromise = null; throw err })
  }
  return _corePromise
}

/** Load MediaPipe FaceMesh. Resolves to the detector. */
function ensureFace() {
  if (!_facePromise) {
    _facePromise = (async () => {
      await ensureCore()
      await loadScript(SRC.mesh)
      return window.faceLandmarksDetection.createDetector(
        window.faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
        { runtime: 'tfjs', refineLandmarks: false, maxFaces: 2 },
      )
    })().catch(err => { _facePromise = null; throw err })
  }
  return _facePromise
}

/** Load MediaPipe Selfie Segmentation (TF.js runtime). Resolves to a segmenter. */
function ensureSeg() {
  if (!_segPromise) {
    _segPromise = (async () => {
      await ensureCore()
      await loadScript(SRC.seg)
      return window.bodySegmentation.createSegmenter(
        window.bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
        // 'landscape' (144×256) is markedly faster than 'general' and plenty
        // accurate for backdrop-whiteness + torso sampling.
        { runtime: 'tfjs', modelType: 'landscape' },
      )
    })().catch(err => { _segPromise = null; throw err })
  }
  return _segPromise
}

/**
 * Warm the models up ahead of time: load the scripts/weights AND run one tiny
 * throwaway inference so the WebGL backend + shaders compile in the background.
 * Call this when the photo UI opens so the first real check isn't a cold, janky
 * download-and-compile. Safe to call repeatedly; all errors swallowed.
 */
export function prewarmOnDeviceSmart() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const warm = document.createElement('canvas')
  warm.width = 64; warm.height = 64
  ensureFace().then(d => d.estimateFaces(warm, { flipHorizontal: false, staticImageMode: true })).catch(() => {})
  ensureSeg().then(s => s.segmentPeople(warm, { flipHorizontal: false })).catch(() => {})
}

/** Yield to the browser for one paint so the "checking" spinner stays animated. */
function nextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

// ── Small pixel helpers ─────────────────────────────────────────────────────

/** Standard RGB skin-tone test (approximate, lighting-tolerant). */
function isSkin(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return r > 95 && g > 40 && b > 20 && (mx - mn) > 15 && Math.abs(r - g) > 15 && r > g && r > b
}

/** Quantize a pixel to one of 12 hue bins; -1 for near-gray (low saturation). */
function quantHue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (mx < 30 || d < 25) return -1
  let h
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return Math.floor(h / 30)
}

/** Normalized hue entropy (0 = one solid color, 1 = many colors / busy print). */
function hueEntropy(hues) {
  const bins = new Array(12).fill(0)
  let n = 0
  for (const hb of hues) { if (hb >= 0) { bins[hb]++; n++ } }
  if (n < 10) return 0
  let H = 0
  for (const c of bins) { if (c) { const p = c / n; H -= p * Math.log2(p) } }
  return H / Math.log2(12)
}

/** Frontal-ness from FaceMesh keypoints: nose centered between the eyes ≈ 1.
 *  Indices: 1 = nose tip, 33 = right-eye outer corner, 263 = left-eye outer. */
function frontalFromMesh(kp) {
  if (!kp || kp.length < 264) return null
  const rEye = kp[33], lEye = kp[263], nose = kp[1]
  if (!rEye || !lEye || !nose) return null
  const eyeMid = (rEye.x + lEye.x) / 2
  const eyeSpan = Math.abs(lEye.x - rEye.x) || 1
  const off = Math.abs(nose.x - eyeMid) / eyeSpan
  return Math.max(0, Math.min(1, 1 - off * 2))
}

// ── Main entry ──────────────────────────────────────────────────────────────

/**
 * Run the on-device model pipeline on a loaded <img>.
 * @param {HTMLImageElement} imgEl
 * @returns {Promise<object|null>} signals, or null if models/canvas unavailable.
 */
export async function runOnDeviceSmart(imgEl) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null

  // Load both independently; tolerate either one failing.
  const [faceModel, segmenter] = await Promise.all([
    ensureFace().catch(() => null),
    ensureSeg().catch(() => null),
  ])
  // Neither model available → let the caller fall back to legacy heuristics.
  if (!faceModel && !segmenter) return null

  // One downscaled canvas drives every model and every pixel read. 192px keeps
  // the GPU/CPU work light - FaceMesh resizes internally, so this costs no
  // accuracy, and the background/attire pixel loops shrink ~45% vs 256px.
  const MAX = 192
  const iw = imgEl.naturalWidth || imgEl.width
  const ih = imgEl.naturalHeight || imgEl.height
  const scale = Math.min(1, MAX / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * scale))
  const h = Math.max(1, Math.round(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(imgEl, 0, 0, w, h)
  let pixels
  try { pixels = ctx.getImageData(0, 0, w, h).data } catch { return null }

  // Let the "checking" UI paint before the heavy inference begins.
  await nextFrame()

  // Run both model inferences concurrently so the orchestration never blocks
  // sequentially on one before starting the other.
  const facePromise = faceModel
    ? faceModel.estimateFaces(canvas, { flipHorizontal: false, staticImageMode: true }).catch(() => null)
    : Promise.resolve(null)
  const maskPromise = segmenter
    ? segmenter.segmentPeople(canvas, { flipHorizontal: false })
        .then(seg => window.bodySegmentation.toBinaryMask(
          seg,
          { r: 255, g: 255, b: 255, a: 255 }, // person → alpha 255
          { r: 0, g: 0, b: 0, a: 0 },         // background → alpha 0
          false, 0.5,
        ))
        .then(m => m?.data || null)
        .catch(() => null)
    : Promise.resolve(null)

  const [det, mask] = await Promise.all([facePromise, maskPromise])

  // ── Stage A - face & pose (FaceMesh) ──────────────────────────────────────
  // null = the model errored (caller can fall back); a real run gives a count.
  let faces = det == null ? null : 0
  let faceBox = null, faceFrac = null, faceCx = null, frontalScore = null
  if (Array.isArray(det)) {
    // FaceMesh only returns a result when it can actually fit a face mesh, so a
    // logo/object yields zero faces. A light box sanity drops any stray fit.
    const valid = det.filter(f => {
      const b = f.box
      if (!b || !b.width || !b.height) return false
      const area = (b.width * b.height) / (w * h)
      if (area < 0.015) return false
      const ar = b.width / b.height
      return ar >= 0.4 && ar <= 1.9
    })
    faces = valid.length
    if (faces >= 1) {
      let best = valid[0]
      for (const f of valid) if (f.box.width * f.box.height > best.box.width * best.box.height) best = f
      const b = best.box
      faceBox = { x: b.xMin, y: b.yMin, w: b.width, h: b.height }
      faceFrac = b.height / h
      faceCx = (b.xMin + b.width / 2) / w
      frontalScore = frontalFromMesh(best.keypoints)
    }
  }

  // ── Stage B - true background whiteness ───────────────────────────────────
  let bgSupported = false, bgWhiteFrac = null
  if (mask) {
    let total = 0, white = 0
    for (let i = 0; i < w * h; i++) {
      if (mask[i * 4 + 3] > 0) continue // skip person pixels
      const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2]
      total++
      if (r > 220 && g > 220 && b > 220 && (Math.max(r, g, b) - Math.min(r, g, b)) < 30) white++
    }
    // Only trust the reading when enough backdrop is actually visible.
    if (total > w * h * 0.04) { bgSupported = true; bgWhiteFrac = white / total }
  }

  // ── Stage C - attire proxy on the torso band ──────────────────────────────
  let skinFrac = null, busyness = null
  if (mask && faceBox) {
    const bandTop = Math.min(h - 1, Math.round(faceBox.y + faceBox.h * 1.0)) // just below chin
    const bandBot = Math.min(h, Math.round(faceBox.y + faceBox.h * 2.2))     // upper chest
    let total = 0, skin = 0
    const hues = []
    for (let y = bandTop; y < bandBot; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x
        if (mask[idx * 4 + 3] === 0) continue // background, skip
        const r = pixels[idx * 4], g = pixels[idx * 4 + 1], b = pixels[idx * 4 + 2]
        total++
        if (isSkin(r, g, b)) skin++
        hues.push(quantHue(r, g, b))
      }
    }
    if (total > 30) { skinFrac = skin / total; busyness = hueEntropy(hues) }
  }

  return { faces, faceBox, faceFrac, faceCx, frontalScore, bgSupported, bgWhiteFrac, skinFrac, busyness }
}
