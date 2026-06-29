// ── Profile-photo validation ──────────────────────────────────────────────
// One coherent verdict that a student profile photo is a professional headshot:
// the SAME person who enrolled Face ID, alone, in business attire, on a plain
// white background.
//
// EXACTLY ONE model stack runs: face-api.js (the same engine + 0.6 threshold that
// anchors Face ID enrollment, password reset, and the identity match), loaded
// from jsdelivr. readPhotoFace reads the photo ONCE -> face count, framing, the
// face box, and a descriptor; the descriptor is matched server-side. Background
// and attire are then derived from plain pixels using that face box - no second
// model, no external model host, nothing for the CSP to block (the old MediaPipe
// path fetched from tfhub.dev, which the CSP blocks and Google is sunsetting, and
// it spammed the console with TensorFlow.js kernel warnings).
//
// Because count, framing, identity, background, and attire all come from one read
// of one engine, the panel can never contradict itself (the old bug: "no face on
// this browser" next to "matches your Face ID", caused by a separate detector).
//
// Enforcement model (strict, decided with the product owner):
//   • HARD FAIL (block save): no clear face, more than one person, a photo that
//     does NOT match the enrolled Face ID, a clearly non-white background, image
//     too small.
//   • RETRYABLE (block save, offer "Try again"): the face engine or the identity
//     server couldn't run (usually a flaky connection). We NEVER fabricate a match
//     we didn't make - the photo simply can't be saved until it verifies.
//   • WARNING (allow save): borderline attire, loose framing, slightly off-white.

import { readPhotoFace } from '@/utils/faceId'
import { matchDescriptorToEnrolledFace } from '@/utils/faceMatch'

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

/** Approximate, lighting-tolerant RGB skin-tone test. */
function isSkin(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  return r > 95 && g > 40 && b > 20 && (mx - mn) > 15 && Math.abs(r - g) > 15 && r > g && r > b
}

/**
 * Read background whiteness and an attire skin proxy from ONE canvas, using the
 * face box to know where the backdrop and torso are - so no segmentation model
 * is needed. Returns { bgScore, bgSupported, skinFrac }.
 *
 * Background is sampled only where a backdrop actually shows behind a headshot:
 * the full-width strip ABOVE the head plus the columns to the LEFT and RIGHT of
 * the face, down to roughly the shoulders. The subject's own pixels are skipped,
 * so an object behind the person (non-white) drags the score down while the
 * person never does. Attire samples the torso band just below the chin.
 */
function pixelChecks(imgEl, faceBox) {
  let data, cw, ch
  try {
    const c = toCanvas(imgEl, 256)
    cw = c.cw; ch = c.ch
    data = c.ctx.getImageData(0, 0, cw, ch).data
  } catch {
    return { bgScore: null, bgSupported: false, skinFrac: null } // tainted/cross-origin
  }

  const isWhite = (r, g, b) => r > 220 && g > 220 && b > 220 && (Math.max(r, g, b) - Math.min(r, g, b)) < 30

  // Face box in canvas pixels (fall back to a centered guess when we have none).
  const fb = faceBox || { x: 0.3, y: 0.18, w: 0.4, h: 0.45 }
  const fx0 = fb.x * cw, fx1 = (fb.x + fb.w) * cw
  const fy0 = fb.y * ch, fy1 = (fb.y + fb.h) * ch
  // Backdrop region: above the head, and beside the head/shoulders down to ~1.6×
  // the face height below the chin (where shoulders end for a headshot).
  const sideBottom = Math.min(ch, fy1 + fb.h * ch * 1.6)
  // A small margin around the face so stray hair/ears don't count as backdrop.
  const mx = fb.w * cw * 0.12

  let bgTotal = 0, bgWhite = 0
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const aboveHead = y < fy0 - 2
      const besideHead = y >= fy0 && y < sideBottom && (x < fx0 - mx || x > fx1 + mx)
      if (!aboveHead && !besideHead) continue
      const i = (y * cw + x) * 4
      bgTotal++
      if (isWhite(data[i], data[i + 1], data[i + 2])) bgWhite++
    }
  }
  const bgScore = bgTotal > (cw * ch * 0.02) ? bgWhite / bgTotal : null

  // Attire: torso band just below the chin, center columns (under the face).
  const bandTop = Math.min(ch - 1, Math.round(fy1 + fb.h * ch * 0.15))
  const bandBot = Math.min(ch, Math.round(fy1 + fb.h * ch * 1.4))
  const tx0 = Math.max(0, Math.round(fx0 - fb.w * cw * 0.25))
  const tx1 = Math.min(cw, Math.round(fx1 + fb.w * cw * 0.25))
  let tTotal = 0, tSkin = 0
  for (let y = bandTop; y < bandBot; y++) {
    for (let x = tx0; x < tx1; x++) {
      const i = (y * cw + x) * 4
      tTotal++
      if (isSkin(data[i], data[i + 1], data[i + 2])) tSkin++
    }
  }
  const skinFrac = tTotal > 30 ? tSkin / tTotal : null

  return { bgScore, bgSupported: bgScore != null, skinFrac }
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

  // ── Background + attire: model-free pixel read off the face box ────────────
  // Only meaningful when we actually found the single subject's face.
  if (face.models && face.faces === 1) {
    const px = pixelChecks(imgEl, face.faceBox)
    if (px.bgSupported && px.bgScore != null) {
      if (px.bgScore >= 0.85) passes.push('Plain white background.')
      else if (px.bgScore < 0.55) hardFails.push('Background is not plain white. Remove objects behind you and use a white wall.')
      else warnings.push('Background may not be fully white - a clean white wall with nothing behind you is best.')
    }
    if (px.skinFrac != null) {
      if (px.skinFrac > 0.5) warnings.push('Attire looks casual or too revealing for an ID photo - wear professional attire.')
      else passes.push('Professional attire detected.')
    }
  }

  return { ok: hardFails.length === 0, hardFails, warnings, passes, smartUsed: true, retryable }
}
