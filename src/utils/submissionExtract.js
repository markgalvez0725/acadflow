// ── On-device submission text extraction ──────────────────────────────────
// Reads the TEXT out of a student's submission file in the browser at submit
// time, so the professor's on-device Smart grader can score it WITHOUT anyone
// pasting text. $0 and private: OCR/PDF/DOCX all run locally; nothing is sent to
// any third party. Libraries are lazy-loaded from a CDN only when a file is
// actually attached.
//
// EVERYTHING here is best-effort: any failure (library blocked by CSP, OCR
// error, unsupported type) returns null, and the caller simply submits without
// the extracted text. It must never block a submission.
//
// Output: { text, meta:{ method, chars, truncated } } or null.

// Stored on the SHARED activity doc (all students' submissions live in one doc,
// 1 MB Firestore limit), so keep it modest: ~6k chars x 100 students stays well
// under the cap, and is plenty of text to judge rubric coverage.
const MAX_CHARS = 6000

// Lazy <script> loader for UMD globals (one injection per src).
const _loaded = {}
function loadScript(src) {
  if (_loaded[src]) return _loaded[src]
  _loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => resolve()
    s.onerror = () => { _loaded[src] = null; reject(new Error('load failed: ' + src)) }
    document.head.appendChild(s)
  })
  return _loaded[src]
}

function clamp(text) {
  const t = String(text || '').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (t.length <= MAX_CHARS) return { text: t, truncated: false }
  return { text: t.slice(0, MAX_CHARS), truncated: true }
}

// ── Plain text / markdown / csv ────────────────────────────────────────────
function readText(file) {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => resolve('')
    r.readAsText(file)
  })
}

// ── Image OCR (Tesseract.js) ───────────────────────────────────────────────
const TESS_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
async function ocrImage(file, onProgress) {
  await loadScript(TESS_SRC)
  if (!window.Tesseract) throw new Error('Tesseract unavailable')
  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(Math.round((m.progress || 0) * 100)) },
  })
  try {
    const { data } = await worker.recognize(file)
    return data?.text || ''
  } finally {
    try { await worker.terminate() } catch { /* ignore */ }
  }
}

// ── PDF (pdf.js text layer, OCR fallback for scanned pages) ────────────────
const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
async function readPdf(file, onProgress) {
  await loadScript(PDFJS_SRC)
  const pdfjs = window.pdfjsLib
  if (!pdfjs) throw new Error('pdf.js unavailable')
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  let text = ''
  const pages = Math.min(pdf.numPages, 30)
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    text += tc.items.map(it => it.str).join(' ') + '\n'
    if (onProgress) onProgress(Math.round((i / pages) * 100))
    if (text.length > MAX_CHARS) break
  }
  // A scanned PDF has (almost) no text layer: OCR the first few pages instead.
  if (text.trim().length < 25) {
    let ocr = ''
    const ocrPages = Math.min(pdf.numPages, 3)
    for (let i = 1; i <= ocrPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1.6 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width; canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      ocr += await ocrImage(canvas, p => { if (onProgress) onProgress(Math.round(((i - 1 + p / 100) / ocrPages) * 100)) }) + '\n'
    }
    return ocr
  }
  return text
}

// ── DOCX (mammoth) ─────────────────────────────────────────────────────────
const MAMMOTH_SRC = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
async function readDocx(file) {
  await loadScript(MAMMOTH_SRC)
  if (!window.mammoth) throw new Error('mammoth unavailable')
  const buf = await file.arrayBuffer()
  const r = await window.mammoth.extractRawText({ arrayBuffer: buf })
  return r?.value || ''
}

// True for file types we can read on-device (drives whether the UI promises it).
export function canExtract(file) {
  if (!file) return false
  const t = (file.type || '').toLowerCase()
  const n = (file.name || '').toLowerCase()
  return /^image\//.test(t) || t === 'application/pdf' || n.endsWith('.pdf') ||
    /^text\//.test(t) || /\.(txt|md|markdown|csv|rtf)$/.test(n) ||
    t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || n.endsWith('.docx')
}

// Main entry. Returns { text, meta } or null (caller submits without text on null).
export async function extractSubmissionText(file, { onProgress } = {}) {
  if (!file) return null
  const type = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  try {
    let raw = '', method = ''
    if (/^image\//.test(type)) { raw = await ocrImage(file, onProgress); method = 'ocr' }
    else if (type === 'application/pdf' || name.endsWith('.pdf')) { raw = await readPdf(file, onProgress); method = 'pdf' }
    else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) { raw = await readDocx(file); method = 'docx' }
    else if (/^text\//.test(type) || /\.(txt|md|markdown|csv|rtf)$/.test(name)) { raw = await readText(file); method = 'text' }
    else return null
    const { text, truncated } = clamp(raw)
    if (!text || text.length < 2) return null
    return { text, meta: { method, chars: text.length, truncated } }
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[extract] failed:', e?.message)
    return null
  }
}
