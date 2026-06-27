// ── Profile-photo validation ──────────────────────────────────────────────
// Layered check that a student profile photo is a professional headshot in
// business attire on a plain white background.
//
//   1. On-device AI (primary): a custom in-browser pipeline - BlazeFace +
//      MediaPipe Selfie Segmentation - judges face/count/pose, the TRUE
//      background, and an attire proxy. The photo never leaves the device.
//      (src/utils/photoVerifyAI.js). Replaces the former Gemini vision call.
//   2. Legacy heuristics (fallback only): when the models can't load on this
//      device, fall back to the pixel white-background score + the browser's
//      native FaceDetector where present.
//
// Enforcement model (decided with the product owner):
//   • HARD FAIL (block save): non-white background, no clear face, more than
//     one person, image too small.
//   • WARNING (allow "use anyway"): borderline attire, loose framing, slightly
//     off-white background, can't verify face on this browser.
//
// Returns a single verdict object the UI can render directly.

import { runOnDeviceAI } from '@/utils/photoVerifyAI'

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
 * Fraction of backdrop pixels that are near-white and uniform (LEGACY fallback).
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

/** Detect faces with the browser FaceDetector API when available (LEGACY). */
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

/** Legacy on-device checks (no ML models) - used only when AI is unavailable. */
async function legacyChecks(imgEl, w, h, hardFails, warnings, passes) {
  const bg = whiteBackgroundScore(imgEl)
  if (bg.supported && bg.score != null) {
    if (bg.score >= 0.82) passes.push('Background looks plain white.')
    else if (bg.score >= 0.5) warnings.push('Background may not be fully white - a clean white wall is best.')
    else warnings.push('Background doesn’t look plain white on-device - make sure you’re against a white wall.')
  }
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
      if (faceFrac && faceFrac < 0.18) warnings.push('Face is small - move closer for a head-and-shoulders shot.')
      if (cx < 0.25 || cx > 0.75) warnings.push('Face is off-center - center yourself in the frame.')
    }
  } else {
    warnings.push("This browser can't verify a face on-device - make sure your face is clear and front-facing.")
  }
}

/**
 * Run the full layered validation.
 * @param {HTMLImageElement} imgEl  a fully-loaded image element
 * @param {string} [dataUrl]        unused (kept for call-site compatibility)
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
  if (minDim < 160) hardFails.push('Image is too small - use at least 240×240px.')
  else if (minDim < 240) warnings.push('Low resolution - a sharper photo is recommended.')
  else passes.push('Resolution is sufficient.')

  // ── On-device AI (primary) ──────────────────────────────────────────────
  let aiUsed = false
  let aiError = null
  let ai = null
  if (useAI) {
    try { ai = await runOnDeviceAI(imgEl) } catch { ai = null }
  }

  if (ai) {
    aiUsed = true

    // Stage A - face & pose
    if (ai.faces == null) {
      // Model couldn't read faces - fall back to the native detector for count.
      const fdRes = await detectFaces(imgEl)
      if (fdRes.supported) {
        const n = fdRes.faces.length
        if (n === 0) hardFails.push('No face detected. Use a clear, front-facing headshot.')
        else if (n > 1) hardFails.push('More than one person detected. Photo must show only you.')
        else passes.push('One face detected.')
      } else {
        warnings.push("Couldn't verify your face automatically - make sure it's clear and front-facing.")
      }
    } else if (ai.faces === 0) {
      hardFails.push('No face detected. Use a clear, front-facing headshot.')
    } else if (ai.faces > 1) {
      hardFails.push('More than one person detected. Photo must show only you.')
    } else {
      passes.push('One face detected.')
      if (ai.faceFrac != null && ai.faceFrac < 0.18) warnings.push('Face is small - move closer for a head-and-shoulders shot.')
      if (ai.faceCx != null && (ai.faceCx < 0.25 || ai.faceCx > 0.75)) warnings.push('Face is off-center - center yourself in the frame.')
      if (ai.frontalScore != null && ai.frontalScore < 0.5) warnings.push('Face looks turned - look straight at the camera.')
    }

    // Stage B - true background (can hard-fail; the mask makes this reliable)
    if (ai.bgSupported && ai.bgWhiteFrac != null) {
      if (ai.bgWhiteFrac >= 0.85) passes.push('Background is plain white.')
      else if (ai.bgWhiteFrac < 0.5) hardFails.push('Background is not plain white. Use a clean white wall behind you.')
      else warnings.push('Background may not be fully white - a clean white wall is best.')
    } else {
      // Segmentation unavailable - fall back to the pixel heuristic (warn-only).
      const bg = whiteBackgroundScore(imgEl)
      if (bg.supported && bg.score != null) {
        if (bg.score >= 0.82) passes.push('Background looks plain white.')
        else if (bg.score >= 0.5) warnings.push('Background may not be fully white - a clean white wall is best.')
        else warnings.push('Background doesn’t look plain white on-device - make sure you’re against a white wall.')
      }
    }

    // Stage C - attire proxy (warnings only)
    if (ai.skinFrac != null) {
      if (ai.skinFrac > 0.45) warnings.push('Attire looks casual or too revealing for an ID photo - wear professional attire.')
      else passes.push('Professional attire detected.')
    }
    if (ai.busyness != null && ai.busyness > 0.6) {
      warnings.push('Outfit has busy patterns - plain professional attire is best.')
    }
  } else {
    // ── Legacy fallback (no ML models available on this device) ─────────────
    await legacyChecks(imgEl, w, h, hardFails, warnings, passes)
    if (useAI) aiError = 'on-device-unavailable'
  }

  return { ok: hardFails.length === 0, hardFails, warnings, passes, aiUsed, aiError }
}
