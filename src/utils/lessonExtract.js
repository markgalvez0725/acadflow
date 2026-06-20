// ── Lesson-file text extraction (free, in-browser, no API) ────────────────
// Pulls plain text out of PDF / Word (.docx) / PowerPoint (.pptx) / .txt files
// entirely on the device. Libraries are loaded on demand from a CDN (the same
// approach the app already uses for SheetJS and jsPDF), so nothing is bundled
// up-front and nothing is uploaded anywhere.

const CDN = {
  pdfjs:   'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  jszip:   'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
}

function loadScript(src, globalKey) {
  return new Promise((resolve, reject) => {
    if (globalKey && window[globalKey]) return resolve(window[globalKey])
    const existing = document.querySelector(`script[data-src="${src}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window[globalKey]))
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.dataset.src = src
    s.onload = () => resolve(globalKey ? window[globalKey] : undefined)
    s.onerror = () => reject(new Error('Failed to load ' + src))
    document.head.appendChild(s)
  })
}

function readArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsArrayBuffer(file)
  })
}

async function extractPdf(file) {
  const pdfjsLib = await loadScript(CDN.pdfjs, 'pdfjsLib')
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker
  const data = await readArrayBuffer(file)
  const pdf = await pdfjsLib.getDocument({ data }).promise
  let out = ''
  const max = Math.min(pdf.numPages, 80)
  for (let i = 1; i <= max; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    out += content.items.map(it => it.str).join(' ') + '\n'
  }
  return out
}

async function extractDocx(file) {
  const mammoth = await loadScript(CDN.mammoth, 'mammoth')
  const arrayBuffer = await readArrayBuffer(file)
  const res = await mammoth.extractRawText({ arrayBuffer })
  return res.value || ''
}

async function extractPptx(file) {
  const JSZip = await loadScript(CDN.jszip, 'JSZip')
  const zip = await JSZip.loadAsync(await readArrayBuffer(file))
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)[1], 10)
      const nb = parseInt(b.match(/slide(\d+)/)[1], 10)
      return na - nb
    })
  let out = ''
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string')
    // PowerPoint text runs live in <a:t>…</a:t>
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1])
    if (texts.length) out += texts.join(' ') + '\n'
  }
  return out
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/**
 * Extract plain text from a lesson file.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function extractTextFromFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.pdf')) return cleanup(await extractPdf(file))
  if (name.endsWith('.docx')) return cleanup(await extractDocx(file))
  if (name.endsWith('.pptx')) return cleanup(await extractPptx(file))
  if (name.endsWith('.txt') || name.endsWith('.md')) return cleanup(await file.text())
  if (name.endsWith('.doc')) throw new Error('Old .doc format is not supported. Please save as .docx and try again.')
  if (name.endsWith('.ppt')) throw new Error('Old .ppt format is not supported. Please save as .pptx and try again.')
  throw new Error('Unsupported file. Use PDF, Word (.docx), PowerPoint (.pptx), or .txt.')
}

function cleanup(text = '') {
  return String(text)
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
