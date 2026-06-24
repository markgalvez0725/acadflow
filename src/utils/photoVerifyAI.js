// ── On-device profile-photo AI ────────────────────────────────────────────
// Custom, in-browser replacement for the Gemini /api/validate-photo call.
// The student's photo NEVER leaves the device — every model runs client-side:
//
//   • BlazeFace (TF.js)                — face detection + 6 keypoints
//                                        (count, framing, head angle)
//   • MediaPipe Selfie Segmentation    — person/background mask, so we can
//     (TF.js runtime)                    measure the TRUE backdrop, not a guess
//   • Heuristic attire read            — skin-vs-fabric + pattern busyness on
//                                        the segmented torso band
//
// Models lazy-load once from jsdelivr (the app already loads SheetJS/jsPDF the
// same way) and are cached for the session. Weight files are fetched by the
// model packages from their own hosts; the app sets no CSP so this is allowed.
//
// runOnDeviceAI() returns null ONLY when the models can't load or the canvas is
// tainted — the caller (photoValidate.js) then falls back to legacy heuristics.
// When models load it returns structured signals (any field may be null if that
// individual stage failed):
//   {
//     faces, faceBox, faceFrac, faceCx, frontalScore,  // Stage A
//     bgSupported, bgWhiteFrac,                         // Stage B
//     skinFrac, busyness,                               // Stage C
//   }

const SRC = {
  tf:    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  // NOTE: the UMD bundle is `blazeface.min.umd.js` — the package's own
  // package.json "main" points at a `blazeface.min.js` that does not exist.
  blaze: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.umd.js',
  seg:   'https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.2/dist/body-segmentation.min.js',
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
// other. BlazeFace (face/count) is the priority — segmentation is an
// enhancement for background + attire. Each cache clears itself on failure so a
// later photo can retry.
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

/** Load BlazeFace. Resolves to the loaded model. */
function ensureFace() {
  if (!_facePromise) {
    _facePromise = (async () => {
      await ensureCore()
      await loadScript(SRC.blaze)
      return window.blazeface.load()
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
        { runtime: 'tfjs', modelType: 'general' },
      )
    })().catch(err => { _segPromise = null; throw err })
  }
  return _segPromise
}

/**
 * Warm the models up ahead of time: load the scripts/weights AND run one tiny
 * throwaway inference so the WebGL backend + shaders compile in the background.
 * Call this when the photo UI opens so the first real check isn't a cold,
 * janky download-and-compile. Safe to call repeatedly; all errors swallowed.
 */
export function prewarmOnDeviceAI() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const warm = document.createElement('canvas')
  warm.width = 64; warm.height = 64
  // A blank canvas is enough to trigger weight load + shader compile.
  ensureFace().then(m => m.estimateFaces(warm, false)).catch(() => {})
  ensureSeg().then(s => s.segmentPeople(warm, { flipHorizontal: false })).catch(() => {})
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

/** Frontal-ness from BlazeFace landmarks: nose centered between the eyes ≈ 1. */
function frontalFromLandmarks(lm) {
  if (!lm || lm.length < 3) return null
  const rightEye = lm[0], leftEye = lm[1], nose = lm[2]
  const eyeMid = (rightEye[0] + leftEye[0]) / 2
  const eyeSpan = Math.abs(leftEye[0] - rightEye[0]) || 1
  const off = Math.abs(nose[0] - eyeMid) / eyeSpan
  return Math.max(0, Math.min(1, 1 - off * 2))
}

// ── Main entry ──────────────────────────────────────────────────────────────

/**
 * Run the on-device model pipeline on a loaded <img>.
 * @param {HTMLImageElement} imgEl
 * @returns {Promise<object|null>} signals, or null if models/canvas unavailable.
 */
export async function runOnDeviceAI(imgEl) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null

  // Load both independently; tolerate either one failing.
  const [faceModel, segmenter] = await Promise.all([
    ensureFace().catch(() => null),
    ensureSeg().catch(() => null),
  ])
  // Neither model available → let the caller fall back to legacy heuristics.
  if (!faceModel && !segmenter) return null

  // One downscaled canvas drives every model and every pixel read.
  const MAX = 256
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

  // ── Stage A — face & pose (BlazeFace) ─────────────────────────────────────
  let faces = null, faceBox = null, faceFrac = null, faceCx = null, frontalScore = null
  if (faceModel) try {
    const preds = await faceModel.estimateFaces(canvas, false)
    faces = preds.length
    if (faces >= 1) {
      let best = preds[0], bestArea = -1
      for (const p of preds) {
        const a = (p.bottomRight[0] - p.topLeft[0]) * (p.bottomRight[1] - p.topLeft[1])
        if (a > bestArea) { bestArea = a; best = p }
      }
      const x0 = best.topLeft[0], y0 = best.topLeft[1]
      const x1 = best.bottomRight[0], y1 = best.bottomRight[1]
      faceBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      faceFrac = (y1 - y0) / h
      faceCx = ((x0 + x1) / 2) / w
      frontalScore = frontalFromLandmarks(best.landmarks)
    }
  } catch { faces = null } // unknown → caller can fall back for the face check

  // ── Person/background mask (Selfie Segmentation) ──────────────────────────
  let mask = null
  if (segmenter) try {
    const seg = await segmenter.segmentPeople(canvas, { flipHorizontal: false })
    const m = await window.bodySegmentation.toBinaryMask(
      seg,
      { r: 255, g: 255, b: 255, a: 255 }, // person → alpha 255
      { r: 0, g: 0, b: 0, a: 0 },         // background → alpha 0
      false, 0.5,
    )
    mask = m?.data || null
  } catch { mask = null }

  // ── Stage B — true background whiteness ───────────────────────────────────
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

  // ── Stage C — attire proxy on the torso band ──────────────────────────────
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
