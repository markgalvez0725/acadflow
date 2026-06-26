// ── On-device Face ID engine (face-api.js / @vladmandic fork via CDN) ──────
// Powers face enrollment + the self-service password reset. Everything here
// runs in the browser — the camera frames never leave the device; only a
// 128-number descriptor (a math signature, not an image) is ever sent to the
// server. window.faceapi is loaded from the CDN <script> in index.html; the ML
// models are fetched lazily the first time a camera flow is opened.

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model'
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
  await Promise.all([
    f.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    f.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    f.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ])
  _modelsLoaded = true
  return f
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

// Map raw getUserMedia / model errors to friendly copy.
export function friendlyCameraError(e) {
  const name = e?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access and try again.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.'
  return e?.message || 'Could not start the camera.'
}
