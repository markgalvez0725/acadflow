// ── Profile-photo validation ──────────────────────────────────────────────
// Layered check that a student profile photo is a professional headshot in
// business attire on a plain white background.
//
//   1. On-device (always, free, private): white-background analysis, face
//      detection (where the browser supports it), framing and resolution.
//   2. AI vision (optional): /api/validate-photo (Gemini) judges business
//      attire + background semantically. Skipped silently when unconfigured.
//
// Enforcement model (decided with the product owner):
//   • HARD FAIL (block save): non-white background, no clear face, more than
//     one person, image too small.
//   • WARNING (allow "use anyway"): borderline attire, loose framing, slightly
//     off-white background, can't verify face on this browser.
//
// Returns a single verdict object the UI can render directly.

import { getIdToken } from '@/firebase/firebaseInit'

/** Draw an image onto an offscreen canvas no larger than `max` px. */
function toCanvas(imgEl, max = 256) {
  const w = imgEl.naturalWidth || imgEl.width
  const h = imgEl.naturalHeight || imgEl.height
  const scale = Math.min(1, max / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw; canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(imgEl, 0, 0, cw, ch)
  return { canvas, ctx, cw, ch }
}

/**
 * Fraction of border pixels that are near-white and uniform.
 * Samples a band around all four edges (where a backdrop should be visible).
 */
function whiteBackgroundScore(imgEl) {
  let data, cw, ch
  try {
    const c = toCanvas(imgEl, 256)
    cw = c.cw; ch = c.ch
    data = c.ctx.getImageData(0, 0, cw, ch).data
  } catch {
    return { score: null, supported: false } // tainted/cross-origin — skip
  }
  const bandX = Math.max(2, Math.round(cw * 0.12))
  const bandY = Math.max(2, Math.round(ch * 0.12))
  let total = 0, white = 0
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const edge = x < bandX || x >= cw - bandX || y < bandY || y >= ch - bandY
      if (!edge) continue
      const i = (y * cw + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      total++
      const bright = r > 230 && g > 230 && b > 230
      const uniform = Math.max(r, g, b) - Math.min(r, g, b) < 24
      if (bright && uniform) white++
    }
  }
  return { score: total ? white / total : 0, supported: true }
}

/** Detect faces with the browser FaceDetector API when available. */
async function detectFaces(imgEl) {
  if (typeof window === 'undefined' || !('FaceDetector' in window)) {
    return { supported: false, faces: [] }
  }
  try {
    // eslint-disable-next-line no-undef
    const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 })
    const faces = await fd.detect(imgEl)
    return { supported: true, faces: faces || [] }
  } catch {
    return { supported: false, faces: [] }
  }
}

/** POST the (downscaled) image to the AI vision endpoint. Null when off/failed. */
async function runAIValidation(dataUrl, signal) {
  try {
    const idToken = await getIdToken()
    const r = await fetch('/api/validate-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: dataUrl, mimeType: 'image/jpeg', idToken }),
      signal,
    })
    if (r.status === 501) return { configured: false }   // no key — expected
    const j = await r.json()
    if (!r.ok) return { configured: true, error: j?.error || 'AI error' }
    return { configured: true, result: j.result || null }
  } catch (e) {
    return { configured: true, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'AI error') }
  }
}

/**
 * Run the full layered validation.
 * @param {HTMLImageElement} imgEl  a fully-loaded image element
 * @param {string} dataUrl          downscaled JPEG data URL (sent to AI)
 * @param {{ useAI?: boolean }} [opts]
 * @returns {Promise<{ ok:boolean, hardFails:string[], warnings:string[],
 *   passes:string[], aiUsed:boolean, aiError:?string }>}
 */
export async function validateProfilePhoto(imgEl, dataUrl, opts = {}) {
  const useAI = opts.useAI !== false
  const hardFails = []
  const warnings = []
  const passes = []

  // ── Resolution / framing ────────────────────────────────────────────────
  const w = imgEl.naturalWidth || imgEl.width
  const h = imgEl.naturalHeight || imgEl.height
  const minDim = Math.min(w, h)
  if (minDim < 160) hardFails.push('Image is too small — use at least 240×240px.')
  else if (minDim < 240) warnings.push('Low resolution — a sharper photo is recommended.')
  else passes.push('Resolution is sufficient.')

  // ── White background (on-device) ────────────────────────────────────────
  const bg = whiteBackgroundScore(imgEl)
  if (bg.supported && bg.score != null) {
    if (bg.score < 0.7) hardFails.push('Background is not plain white. Retake against a white wall.')
    else if (bg.score < 0.86) warnings.push('Background is only mostly white — a cleaner white is better.')
    else passes.push('Background looks plain white.')
  }

  // ── Face detection (on-device, where supported) ─────────────────────────
  const fdRes = await detectFaces(imgEl)
  if (fdRes.supported) {
    const n = fdRes.faces.length
    if (n === 0) hardFails.push('No face detected. Use a clear, front-facing headshot.')
    else if (n > 1) hardFails.push('More than one person detected. Photo must show only you.')
    else {
      passes.push('One face detected.')
      const box = fdRes.faces[0].boundingBox
      const faceFrac = box && h ? box.height / h : 0
      const cx = box ? (box.x + box.width / 2) / w : 0.5
      if (faceFrac && faceFrac < 0.18) warnings.push('Face is small — move closer for a head-and-shoulders shot.')
      if (cx < 0.25 || cx > 0.75) warnings.push('Face is off-center — center yourself in the frame.')
    }
  } else {
    warnings.push("This browser can't verify a face on-device — make sure your face is clear and front-facing.")
  }

  // ── AI vision (optional, semantic) ──────────────────────────────────────
  let aiUsed = false
  let aiError = null
  if (useAI && dataUrl) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null
    const ai = await runAIValidation(dataUrl, controller?.signal)
    if (timer) clearTimeout(timer)
    if (ai.configured && ai.result) {
      aiUsed = true
      const R = ai.result
      // Hard blocks the owner asked for: background, single person, clear face.
      if (R.whiteBackground === false && !hardFails.some(s => /background/i.test(s)))
        hardFails.push('AI: background is not plain white.')
      if (R.singlePerson === false && !hardFails.some(s => /one person|person detected/i.test(s)))
        hardFails.push('AI: more than one person in the photo.')
      if (R.faceClearlyVisible === false && !hardFails.some(s => /face/i.test(s)))
        hardFails.push('AI: face is not clearly visible.')
      // Attire / framing are warnings (allow override).
      if (R.businessAttire === false) warnings.push('AI: attire does not look like business/professional wear.')
      else if (R.businessAttire === true) passes.push('AI: professional attire detected.')
      if (R.headshot === false) warnings.push('AI: framing is not a standard headshot.')
      if (Array.isArray(R.issues)) for (const it of R.issues.slice(0, 4)) {
        const t = String(it || '').trim()
        if (t && !warnings.includes(t) && !hardFails.includes(t)) warnings.push('AI: ' + t)
      }
    } else if (ai.configured && ai.error) {
      aiError = ai.error
    }
  }

  return { ok: hardFails.length === 0, hardFails, warnings, passes, aiUsed, aiError }
}
