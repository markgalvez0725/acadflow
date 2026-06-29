// ── On-device Face ID engine (face-api.js / @vladmandic fork via CDN) ──────
// Powers face enrollment + the self-service password reset. Everything here
// runs in the browser - the camera frames never leave the device; only a
// 128-number descriptor (a math signature, not an image) is ever sent to the
// server. window.faceapi is loaded from the CDN <script> in index.html; the ML
// models are fetched lazily the first time a camera flow is opened.

// Primary + fallback model hosts. If one CDN is down or rate-limited, the next
// is tried automatically so enrollment never dead-ends on a flaky network.
const MODEL_URLS = [
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model',
  'https://unpkg.com/@vladmandic/face-api@1.7.13/model',
]
let _modelsLoaded = false

// ── FACE_POLICY - the single source of truth for every verification number ──
// Enrollment AND reset both read from here (via createFaceScan / faceQuality /
// buildSignature / matches), so the two flows can never drift. The server keeps
// its own copy of MATCH.THRESHOLD (it must decide the match independently - see
// api/face-reset.js) but it is the SAME number, documented in both places.
// Invariant that keeps legit students from being falsely rejected ("gated"):
//   ENROLL.MAX_SPREAD (0.45)  <  MATCH.THRESHOLD (0.6)
// i.e. a clean enrolled signature sits comfortably inside the match window.
export const FACE_POLICY = {
  // Per-frame capture quality gate.
  QUALITY:  { MIN_SCORE: 0.6, MIN_SIZE: 0.30, MAX_SIZE: 0.95, MAX_YAW: 0.14, MIN_EAR: 0.18 },
  // Adaptive liveness (relative to the person's own baseline).
  LIVENESS: { MIN_FRAMES: 4, YAW_RANGE: 0.14, EAR_BASE_MIN: 0.10, BLINK_RATIO: 0.6 },
  // Signature build: gather TARGET quality frames, require MIN_INLIERS within
  // MAX_SPREAD; near HARD_CAP fall back to the densest cluster (RELAX_*).
  ENROLL:   { TARGET: 8, MIN_INLIERS: 5, MAX_SPREAD: 0.45, HARD_CAP: 20, RELAX_MIN_INLIERS: 3, RELAX_SPREAD: 0.6 },
  // Match authority. Mirrored by the server, which actually enforces it.
  MATCH:    { THRESHOLD: 0.6 },
  // Loop timeouts so the camera flow can never deadlock.
  TIMING:   { POSITION_HINT_MS: 8000, CHALLENGE_SWITCH_MS: 14000, OVERALL_MS: 38000 },
}

// Prompts shown during a scan - centralized so both modals read identically.
const LIVENESS_PROMPT = 'Slowly turn your head a little, or blink'
const CAPTURE_PROMPT  = 'Great - look straight ahead and hold still…'

export function faceApiPresent() {
  return typeof window !== 'undefined' && !!window.faceapi
}

// Wait for the deferred CDN script to define window.faceapi.
export function ensureFaceApi(timeoutMs = 9000) {
  if (faceApiPresent()) return Promise.resolve(window.faceapi)
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (faceApiPresent()) { clearInterval(t); resolve(window.faceapi) }
      else if (Date.now() - start > timeoutMs) {
        clearInterval(t)
        reject(new Error('The face library could not load. Check your connection and try again.'))
      }
    }, 150)
  })
}

export async function loadFaceModels() {
  const f = await ensureFaceApi()
  if (_modelsLoaded) return f
  let lastErr
  for (const url of MODEL_URLS) {
    try {
      // face-api caches each net once loaded, so a partial success on a failing
      // host is reused - the next host only fetches whatever didn't load.
      await Promise.all([
        f.nets.tinyFaceDetector.loadFromUri(url),
        f.nets.faceLandmark68Net.loadFromUri(url),
        f.nets.faceRecognitionNet.loadFromUri(url),
      ])
      _modelsLoaded = true
      return f
    } catch (e) { lastErr = e }
  }
  throw new Error('The face models could not load. Check your connection and try again.')
}

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This device has no camera available.')
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
    audio: false,
  })
  video.srcObject = stream
  try { await video.play() } catch { /* autoplay quirks - ignore */ }
  return stream
}

export function stopStream(stream) {
  try { stream && stream.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
}

// One detection with landmarks (for liveness) + descriptor (for matching).
export async function detectOnce(video) {
  const f = window.faceapi
  if (!f || !video) return null
  const opts = new f.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })
  return await f.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor()
}

// Compute the 128-d descriptor of the single largest face in a STILL image
// (e.g. a chosen profile photo). Loads the models on demand. Returns the
// descriptor as a plain number[], or null when no clear face is found. A larger
// input size than the live loop is used since a still frame can afford accuracy.
export async function describeFaceInImage(imgEl) {
  const f = await loadFaceModels()
  if (!imgEl) return null
  const opts = new f.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })
  const det = await f.detectSingleFace(imgEl, opts).withFaceLandmarks().withFaceDescriptor()
  return det ? Array.from(det.descriptor) : null
}

// Read a STILL profile photo with the SAME engine that anchors Face ID, in ONE
// pass, so face count, framing, and identity can never disagree (the old flow
// ran a separate detector for count and face-api only for the match, which is
// how "no face on this browser" could sit next to "matches your Face ID"). The
// descriptor returned here is fed straight to the server identity check, so the
// photo is read exactly once. Returns:
//   { models:false }                                        engine couldn't load
//   { models:true, faces, faceFrac, faceCx, frontalScore, descriptor }
// `descriptor` is the 128-d signature of the single largest face (null if none).
export async function readPhotoFace(imgEl) {
  let f
  try { f = await loadFaceModels() }
  catch { return { models: false } }
  if (!imgEl) return { models: true, faces: 0, descriptor: null }

  const opts = new f.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })
  const dets = await f.detectAllFaces(imgEl, opts).withFaceLandmarks().withFaceDescriptors()
  const w = imgEl.naturalWidth || imgEl.width
  const h = imgEl.naturalHeight || imgEl.height

  if (!dets || dets.length === 0) return { models: true, faces: 0, descriptor: null }

  // The single largest face is the subject; smaller stray detections only feed
  // the count (so a second person still trips the "only you" rule).
  let best = dets[0]
  for (const det of dets) {
    if ((det.detection?.box?.area || 0) > (best.detection?.box?.area || 0)) best = det
  }
  const box = best.detection?.box
  const faceFrac = box && h ? box.height / h : null
  const faceCx   = box && w ? (box.x + box.width / 2) / w : null
  // headYaw ≈ 0 looking straight; map to a 0..1 frontal score (a turned head warns).
  let frontalScore = null
  try { frontalScore = Math.max(0, Math.min(1, 1 - Math.abs(headYaw(best.landmarks)) * 3)) }
  catch { frontalScore = null }

  return {
    models: true,
    faces: dets.length,
    faceFrac,
    faceCx,
    frontalScore,
    descriptor: best.descriptor ? Array.from(best.descriptor) : null,
  }
}

// ── Liveness signals from the 68-point landmarks ──────────────────────────
function d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function earOf(eye) {
  // Eye Aspect Ratio: drops sharply when the eye closes (a blink).
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * (d(eye[0], eye[3]) || 1))
}
export function eyeAspect(landmarks) {
  try { return (earOf(landmarks.getLeftEye()) + earOf(landmarks.getRightEye())) / 2 }
  catch { return 1 }
}
// Head-turn proxy: nose-tip horizontal offset from the eye midline, normalized
// by face width. ~0 looking straight; grows as the head yaws left/right.
export function headYaw(landmarks) {
  try {
    const nose = landmarks.getNose()
    const tip = nose[3] || nose[nose.length - 1]
    const le = landmarks.getLeftEye(), re = landmarks.getRightEye()
    const mid = (le[0].x + le[3].x + re[0].x + re[3].x) / 4
    const jaw = landmarks.getJawOutline()
    const w = Math.abs(jaw[0].x - jaw[jaw.length - 1].x) || 1
    return (tip.x - mid) / w
  } catch { return 0 }
}

// Adaptive, forgiving liveness - fixes the brittle "blink exactly twice" check.
// It calibrates to THIS person/camera instead of using fixed thresholds, and
// passes on ANY clear sign of life: a small head turn (yaw range) OR a blink
// measured relative to the person's own open-eye baseline. A static photo can't
// produce either. Drive it by calling update(landmarks) each frame.
export function createLivenessTracker() {
  let yawMin = Infinity, yawMax = -Infinity
  let earBase = 0, earMin = Infinity
  let frames = 0
  return {
    reset() { yawMin = Infinity; yawMax = -Infinity; earBase = 0; earMin = Infinity; frames = 0 },
    update(landmarks) {
      frames++
      const yaw = headYaw(landmarks)
      const ear = eyeAspect(landmarks)
      if (yaw < yawMin) yawMin = yaw
      if (yaw > yawMax) yawMax = yaw
      if (ear > earBase) earBase = ear   // running open-eye baseline (per person)
      if (ear < earMin) earMin = ear
      const L = FACE_POLICY.LIVENESS
      const moved   = (yawMax - yawMin) > L.YAW_RANGE                       // any clear head turn
      const blinked = earBase > L.EAR_BASE_MIN && earMin < earBase * L.BLINK_RATIO // a blink vs. their own baseline
      return { passed: frames >= L.MIN_FRAMES && (moved || blinked), moved, blinked }
    },
  }
}

export function descriptorArray(det) {
  if (!det || !det.descriptor) return null
  return Array.from(det.descriptor)
}

// Element-wise average of several descriptors → a steadier signature.
export function averageDescriptors(list) {
  if (!list.length) return null
  const n = list[0].length
  const out = new Array(n).fill(0)
  for (const dsc of list) for (let i = 0; i < n; i++) out[i] += dsc[i]
  return out.map(v => v / list.length)
}

// Euclidean distance between two 128-d descriptors (same metric the server uses
// to decide a match). Lower = more similar; the reset threshold is 0.6.
export function descriptorDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity
  let s = 0
  for (let i = 0; i < a.length; i++) { const dd = a[i] - b[i]; s += dd * dd }
  return Math.sqrt(s)
}

// Per-frame capture quality gate. A descriptor is only as good as the frame it
// came from, so we keep ONLY frames that are confident, well-sized, frontal, and
// eyes-open - never a blink or a too-far face that would smear the signature.
export function faceQuality(det, video) {
  const score = det?.detection?.score ?? 0
  const box = det?.detection?.box
  const vw = (video && video.videoWidth) || 0
  const sizeRatio = box && vw ? box.width / vw : 0
  const yaw = Math.abs(headYaw(det?.landmarks))
  const ear = eyeAspect(det?.landmarks)
  const Q = FACE_POLICY.QUALITY
  const sizeOk = sizeRatio >= Q.MIN_SIZE && sizeRatio <= Q.MAX_SIZE
  const frontal = yaw < Q.MAX_YAW
  const eyesOpen = ear > Q.MIN_EAR
  const ok = score >= Q.MIN_SCORE && sizeOk && frontal && eyesOpen
  let hint = ''
  if (!box) hint = 'Center your face in the circle'
  else if (sizeRatio < Q.MIN_SIZE) hint = 'Move a little closer'
  else if (sizeRatio > Q.MAX_SIZE) hint = 'Move back a little'
  else if (!frontal) hint = 'Look straight at the camera'
  else if (!eyesOpen) hint = 'Keep your eyes open'
  else if (score < Q.MIN_SCORE) hint = 'Hold still - getting a clear view'
  return { ok, hint, score, sizeRatio, yaw, ear }
}

// Build a clean enrollment signature from many captured frames: average to a
// centroid, DROP outlier frames (movement blur, a glance away, someone passing
// behind) beyond `maxSpread`, then re-average the inliers. Returns null until at
// least `minInliers` mutually-consistent frames exist, so a noisy capture keeps
// collecting instead of saving a signature that won't match at reset time.
export function buildSignature(samples, opts = {}) {
  const minInliers = opts.minInliers ?? FACE_POLICY.ENROLL.MIN_INLIERS
  const maxSpread = opts.maxSpread ?? FACE_POLICY.ENROLL.MAX_SPREAD
  const clean = (samples || []).filter(Boolean)
  if (clean.length < minInliers) return null
  const centroid = averageDescriptors(clean)
  const inliers = clean.filter(s => descriptorDistance(s, centroid) <= maxSpread)
  if (inliers.length < minInliers) return null
  const refined = averageDescriptors(inliers)
  const spread = Math.max(...inliers.map(s => descriptorDistance(s, refined)))
  return { descriptor: refined, inliers: inliers.length, total: clean.length, spread }
}

// True if two descriptors are the same face by the canonical match threshold.
// The SERVER is the real authority for reset, but the client uses this for
// consistency/pre-checks so both sides judge by the identical number.
export function matches(a, b) {
  return descriptorDistance(a, b) <= FACE_POLICY.MATCH.THRESHOLD
}

// ── createFaceScan - the ONE centralized face-scan state machine ───────────
// Both the enroll and reset modals drive this instead of hand-rolling their own
// per-frame loop, so the capture pipeline (liveness → quality gate → outlier-
// rejected signature) is byte-identical for enrollment and verification. That
// is what guarantees a face that enrolls cleanly also verifies cleanly - no
// drift, so a legitimately-enrolled student is never falsely rejected.
//
// Usage per camera frame:
//   const out = scan.feed(detection, videoEl, elapsedMs)
//   if (out.phase changed) reflect it in the UI
//   if (out.msg) show it
//   if (out.signature) // capture complete → enroll or verify with it
export function createFaceScan() {
  const live = createLivenessTracker()
  const samples = []
  const T = FACE_POLICY.ENROLL.TARGET
  let phase = 'position' // position → challenge → capturing → done
  return {
    get phase() { return phase },
    reset() { live.reset(); samples.length = 0; phase = 'position' },
    feed(det, video, elapsedMs = 0) {
      // No face detected this frame - only the positioning step nudges the user.
      if (!det) {
        const msg = phase === 'position'
          ? (elapsedMs > FACE_POLICY.TIMING.POSITION_HINT_MS
              ? 'Make sure your face is centered and well-lit'
              : 'Center your face in the circle')
          : null
        return { phase, msg, signature: null }
      }
      if (phase === 'position') {
        live.reset(); phase = 'challenge'
        return { phase, msg: LIVENESS_PROMPT, signature: null }
      }
      if (phase === 'challenge') {
        const r = live.update(det.landmarks)
        if (r.passed) { samples.length = 0; phase = 'capturing'; return { phase, msg: CAPTURE_PROMPT, signature: null } }
        return { phase, msg: LIVENESS_PROMPT, signature: null }
      }
      // capturing - keep only clean frames, then build a consistent signature.
      const q = faceQuality(det, video)
      if (q.ok) { const arr = descriptorArray(det); if (arr) samples.push(arr) }
      let signature = null
      if (samples.length >= T) {
        const sig = buildSignature(samples)
        if (sig) { signature = sig.descriptor; phase = 'done' }
        else if (samples.length >= FACE_POLICY.ENROLL.HARD_CAP) {
          const relaxed = buildSignature(samples, {
            minInliers: FACE_POLICY.ENROLL.RELAX_MIN_INLIERS,
            maxSpread: FACE_POLICY.ENROLL.RELAX_SPREAD,
          })
          if (relaxed) { signature = relaxed.descriptor; phase = 'done' }
          else samples.splice(0, samples.length - T) // drop oldest, keep collecting
        }
      }
      const msg = q.ok
        ? `Hold still - captured ${Math.min(samples.length, T)} of ${T}`
        : (q.hint || CAPTURE_PROMPT)
      return { phase, msg, signature }
    },
  }
}

// True once the <video> is actually producing frames (guards detect() against a
// not-yet-playing stream - e.g. iOS Safari when autoplay was deferred).
export function videoReady(v) {
  return !!v && v.readyState >= 2 && v.videoWidth > 0
}

// ── Back-compat aliases - the numbers now live in FACE_POLICY (one source of
// truth); these stay exported so any older importer keeps working. ───────────
export const SAMPLES = FACE_POLICY.ENROLL.TARGET
export const ENROLL = FACE_POLICY.ENROLL
export const TIMING = FACE_POLICY.TIMING
export const LIVENESS = { EAR_OPEN: 0.26, EAR_CLOSED: 0.18, YAW_TURN: 0.16, YAW_BACK: 0.07 }
export const CHALLENGES = [
  { key: 'blink', prompt: 'Blink slowly, twice' },
  { key: 'turn',  prompt: 'Turn your head to one side, then back' },
]

// Map raw getUserMedia / model errors to friendly copy.
export function friendlyCameraError(e) {
  const name = e?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access and try again.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.'
  return e?.message || 'Could not start the camera.'
}
