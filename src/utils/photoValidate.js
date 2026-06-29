// ── Profile-photo validation ──────────────────────────────────────────────
// One coherent verdict that a student profile photo is a professional headshot:
// the SAME person who enrolled Face ID, alone, in business attire, on a plain
// white background.
//
// A single face engine decides everything about the FACE. face-api.js (the exact
// engine + 0.6 threshold that anchors Face ID enrollment, password reset, and the
// identity match) reads the photo ONCE via readPhotoFace -> count, framing, and a
// descriptor. That descriptor is matched server-side. Because count and identity
// come from one read, the panel can never show "no face on this browser" next to
// "matches your Face ID" (the old bug, caused by a separate native FaceDetector
// running alongside face-api). MediaPipe Selfie Segmentation is kept ONLY for
// what it is genuinely good at - the true background and an attire proxy.
//
// Enforcement model (strict, decided with the product owner):
//   • HARD FAIL (block save): no clear face, more than one person, a photo that
//     does NOT match the enrolled Face ID, a non-white background, image too small.
//   • RETRYABLE (block save, offer "Try again"): the face engine or the identity
//     server couldn't run (usually a flaky connection). We NEVER fabricate a match
//     we didn't make - the photo simply can't be saved until it verifies.
//   • WARNING (allow save): borderline attire, loose framing, slightly off-white.
//
// Returns a single verdict object the UI can render directly.

import { readPhotoFace } from '@/utils/faceId'
import { matchDescriptorToEnrolledFace } from '@/utils/faceMatch'
import { runOnDeviceSmart } from '@/utils/photoVerifySmart'

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
 * Fraction of backdrop pixels that are near-white and uniform (FALLBACK only).
 * Only samples where a backdrop is actually visible behind a headshot - the
 * full-width TOP strip and the UPPER portion of the left/right sides. The
 * bottom is intentionally skipped: it's filled by the subject's shoulders and
 * clothing, so sampling it falsely tanks the score for a correct photo. Used
 * only when the on-device segmentation model is unavailable.
 */
function whiteBackgroundScore(imgEl) {
  let data, cw, ch
  try {
    const c = toCanvas(imgEl, 256)
    cw = c.cw; ch = c.ch
    data = c.ctx.getImageData(0, 0, cw, ch).data
  } catch {
    return { score: null, supported: false } // tainted/cross-origin - skip
  }
  const bandX  = Math.max(2, Math.round(cw * 0.12))
  const topY   = Math.max(2, Math.round(ch * 0.16)) // full-width top strip
  const sideY  = Math.round(ch * 0.55)              // sides only above the torso
  let total = 0, white = 0
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const inTop  = y < topY
      const inSide = y < sideY && (x < bandX || x >= cw - bandX)
      if (!inTop && !inSide) continue
      const i = (y * cw + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2]
      total++
      // Slightly tolerant of lighting/JPEG so a real white wall still counts.
      const bright = r > 220 && g > 220 && b > 220
      const uniform = Math.max(r, g, b) - Math.min(r, g, b) < 30
      if (bright && uniform) white++
    }
  }
  return { score: total ? white / total : 0, supported: true }
}

/** Background + attire from the segmentation model, with a pixel fallback. */
async function checkBackgroundAndAttire(imgEl, hardFails, warnings, passes) {
  let smartUsed = false
  let ai = null
  try { ai = await runOnDeviceSmart(imgEl) } catch { ai = null }

  // ── Background (the mask makes this reliable, so it can hard-fail) ─────────
  if (ai && ai.bgSupported && ai.bgWhiteFrac != null) {
    smartUsed = true
    if (ai.bgWhiteFrac >= 0.85) passes.push('Plain white background.')
    else if (ai.bgWhiteFrac < 0.5) hardFails.push('Background is not plain white. Remove objects behind you and use a white wall.')
    else warnings.push('Background may not be fully white - a clean white wall is best.')
  } else {
    // Segmentation unavailable - pixel heuristic. A clearly non-white reading
    // still blocks; a borderline one only warns (the heuristic is less precise).
    const bg = whiteBackgroundScore(imgEl)
    if (bg.supported && bg.score != null) {
      if (bg.score >= 0.82) passes.push('Background looks plain white.')
      else if (bg.score >= 0.5) warnings.push('Background may not be fully white - a clean white wall is best.')
      else hardFails.push('Background doesn’t look plain white. Use a white wall with nothing behind you.')
    }
  }

  // ── Attire proxy (warnings only) ──────────────────────────────────────────
  if (ai) {
    smartUsed = true
    if (ai.skinFrac != null) {
      if (ai.skinFrac > 0.45) warnings.push('Attire looks casual or too revealing for an ID photo - wear professional attire.')
      else passes.push('Professional attire detected.')
    }
    if (ai.busyness != null && ai.busyness > 0.6) {
      warnings.push('Outfit has busy patterns - plain professional attire is best.')
    }
  }

  return smartUsed
}

/**
 * Run the full validation and return ONE coherent verdict.
 * @param {HTMLImageElement} imgEl  a fully-loaded image element
 * @param {string} [dataUrl]        unused (kept for call-site compatibility)
 * @returns {Promise<{ ok:boolean, hardFails:string[], warnings:string[],
 *   passes:string[], smartUsed:boolean, retryable:boolean }>}
 *   retryable=true means we couldn't verify (engine/connection), not that the
 *   photo failed - the UI should offer "Try again", never let it save.
 */
export async function validateProfilePhoto(imgEl, dataUrl) {
  const hardFails = []
  const warnings = []
  const passes = []
  let retryable = false

  // ── Resolution / framing ────────────────────────────────────────────────
  const w = imgEl.naturalWidth || imgEl.width
  const h = imgEl.naturalHeight || imgEl.height
  const minDim = Math.min(w, h)
  if (minDim < 160) hardFails.push('Image is too small - use at least 240×240px.')
  else if (minDim < 240) warnings.push('Low resolution - a sharper photo is recommended.')
  else passes.push('Resolution is sufficient.')

  // ── Face + identity: ONE face-api pass (the Face ID engine) ───────────────
  const face = await readPhotoFace(imgEl)
  if (!face.models) {
    // The engine couldn't load - we cannot confirm a face OR identity. Block,
    // but mark it retryable so the student can try again on a better connection.
    retryable = true
    hardFails.push("Couldn’t load the verification models - check your connection and tap Try again.")
    return { ok: false, hardFails, warnings, passes, smartUsed: false, retryable }
  }

  if (face.faces === 0) {
    hardFails.push('No face detected. Use a clear, front-facing headshot.')
  } else if (face.faces > 1) {
    hardFails.push('More than one person detected. Photo must show only you.')
  } else {
    passes.push('One clear face detected.')
    if (face.faceFrac != null && face.faceFrac < 0.18) warnings.push('Face is small - move closer for a head-and-shoulders shot.')
    if (face.faceCx != null && (face.faceCx < 0.25 || face.faceCx > 0.75)) warnings.push('Face is off-center - center yourself in the frame.')
    if (face.frontalScore != null && face.frontalScore < 0.5) warnings.push('Face looks turned - look straight at the camera.')

    // Identity: match the photo's descriptor to the enrolled Face ID, decided
    // server-side. The descriptor was just read above, so the photo is read once.
    const id = await matchDescriptorToEnrolledFace(face.descriptor)
    if (id.error) {
      // Couldn't reach the identity check (flaky connection / auth). Don't claim
      // a match we didn't make - block, retryable.
      retryable = true
      hardFails.push("Couldn’t confirm it’s you - check your connection and tap Try again.")
    } else if (id.enrolled === false) {
      // No enrolled signature. In the guided flow Face ID is set up BEFORE the
      // photo, so this is only legacy/edge accounts - the on-device face check
      // stands so they're never dead-ended, but we don't fabricate a match.
      passes.push('Face verified on your device.')
    } else if (id.match === false) {
      hardFails.push('This doesn’t match the face you enrolled for Face ID. Use a clear, front-facing photo of yourself.')
    } else if (id.match === true) {
      passes.push('Matches the face you enrolled for Face ID.')
    }
  }

  // ── Background + attire (segmentation, with pixel fallback) ───────────────
  const smartUsed = await checkBackgroundAndAttire(imgEl, hardFails, warnings, passes)

  return { ok: hardFails.length === 0, hardFails, warnings, passes, smartUsed, retryable }
}
