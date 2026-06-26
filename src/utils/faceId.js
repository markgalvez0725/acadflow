// ── On-device Face ID engine (face-api.js / @vladmandic fork via CDN) ──────
// Powers face enrollment + the self-service password reset. Everything here
// runs in the browser — the camera frames never leave the device; only a
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
      // host is reused — the next host only fetches whatever didn't load.
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
  try { await video.play() } catch { /* autoplay quirks — ignore */ }
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

// Adaptive, forgiving liveness — fixes the brittle "blink exactly twice" check.
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
      const moved   = (yawMax - yawMin) > 0.14              // any clear head turn
      const blinked = earBase > 0.10 && earMin < earBase * 0.6 // a blink vs. their own baseline
      return { passed: frames >= 4 && (moved || blinked), moved, blinked }
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
// eyes-open — never a blink or a too-far face that would smear the signature.
export function faceQuality(det, video) {
  const score = det?.detection?.score ?? 0
  const box = det?.detection?.box
  const vw = (video && video.videoWidth) || 0
  const sizeRatio = box && vw ? box.width / vw : 0
  const yaw = Math.abs(headYaw(det?.landmarks))
  const ear = eyeAspect(det?.landmarks)
  const sizeOk = sizeRatio >= 0.30 && sizeRatio <= 0.95
  const frontal = yaw < 0.14
  const eyesOpen = ear > 0.18
  const ok = score >= 0.6 && sizeOk && frontal && eyesOpen
  let hint = ''
  if (!box) hint = 'Center your face in the circle'
  else if (sizeRatio < 0.30) hint = 'Move a little closer'
  else if (sizeRatio > 0.95) hint = 'Move back a little'
  else if (!frontal) hint = 'Look straight at the camera'
  else if (!eyesOpen) hint = 'Keep your eyes open'
  else if (score < 0.6) hint = 'Hold still — getting a clear view'
  return { ok, hint, score, sizeRatio, yaw, ear }
}

// Build a clean enrollment signature from many captured frames: average to a
// centroid, DROP outlier frames (movement blur, a glance away, someone passing
// behind) beyond `maxSpread`, then re-average the inliers. Returns null until at
// least `minInliers` mutually-consistent frames exist, so a noisy capture keeps
// collecting instead of saving a signature that won't match at reset time.
export function buildSignature(samples, opts = {}) {
  const minInliers = opts.minInliers ?? 5
  const maxSpread = opts.maxSpread ?? 0.45
  const clean = (samples || []).filter(Boolean)
  if (clean.length < minInliers) return null
  const centroid = averageDescriptors(clean)
  const inliers = clean.filter(s => descriptorDistance(s, centroid) <= maxSpread)
  if (inliers.length < minInliers) return null
  const refined = averageDescriptors(inliers)
  const spread = Math.max(...inliers.map(s => descriptorDistance(s, refined)))
  return { descriptor: refined, inliers: inliers.length, total: clean.length, spread }
}

// True once the <video> is actually producing frames (guards detect() against a
// not-yet-playing stream — e.g. iOS Safari when autoplay was deferred).
export function videoReady(v) {
  return !!v && v.readyState >= 2 && v.videoWidth > 0
}

// ── Shared liveness + capture tuning (imported by BOTH face modals so the enroll
// and reset flows can never drift apart) ─────────────────────────────────────
export const LIVENESS = { EAR_OPEN: 0.26, EAR_CLOSED: 0.18, YAW_TURN: 0.16, YAW_BACK: 0.07 }
export const SAMPLES = 4
// Enrollment capture targets: gather TARGET quality frames, require MIN_INLIERS
// mutually-consistent ones within MAX_SPREAD, and never collect past HARD_CAP
// before falling back to the densest cluster. Tighter than reset's 0.6 match
// threshold on purpose, so the stored signature is comfortably inside it.
export const ENROLL = { TARGET: 8, MIN_INLIERS: 5, MAX_SPREAD: 0.45, HARD_CAP: 20 }
export const CHALLENGES = [
  { key: 'blink', prompt: 'Blink slowly, twice' },
  { key: 'turn',  prompt: 'Turn your head to one side, then back' },
]
// Loop timeouts so the camera flow can never deadlock (poor light, no blink, a
// stalled iOS stream): hint → auto-switch to the other challenge → give up.
export const TIMING = { POSITION_HINT_MS: 8000, CHALLENGE_SWITCH_MS: 14000, OVERALL_MS: 38000 }

// Map raw getUserMedia / model errors to friendly copy.
export function friendlyCameraError(e) {
  const name = e?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access and try again.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.'
  return e?.message || 'Could not start the camera.'
}
