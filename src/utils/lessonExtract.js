// ── Lesson-file text extraction (free, in-browser, no API) ────────────────
// Pulls plain text out of PDF / Word (.docx) / PowerPoint (.pptx) / .txt files
// entirely on the device. Libraries are loaded on demand from a CDN (the same
// approach the app already uses for SheetJS and jsPDF), so nothing is bundled
// up-front and nothing is uploaded anywhere.

import { loadScriptOnce, lastGoodUrl } from '@/utils/cdnLoader'

// Mirror lists, preferred host first. mammoth is pinned to 1.8.0 - the SAME
// version submissionExtract.js loads - so the two modules never race different
// releases onto window.mammoth (cacheKeys are shared for the same reason).
const CDN = {
  pdfjs: [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  ],
  mammoth: [
    'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
    'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js',
  ],
  jszip: [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  ],
}
// pdf.js worker paired to whichever host served the library.
const PDF_WORKERS = {
  [CDN.pdfjs[0]]: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  [CDN.pdfjs[1]]: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
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
  const pdfjsLib = await loadScriptOnce(CDN.pdfjs, { globalKey: 'pdfjsLib', cacheKey: 'pdfjs' })
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKERS[lastGoodUrl('pdfjs')] || PDF_WORKERS[CDN.pdfjs[0]]
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
  const mammoth = await loadScriptOnce(CDN.mammoth, { globalKey: 'mammoth', cacheKey: 'mammoth' })
  const arrayBuffer = await readArrayBuffer(file)
  const res = await mammoth.extractRawText({ arrayBuffer })
  return res.value || ''
}

async function extractPptx(file) {
  const JSZip = await loadScriptOnce(CDN.jszip, { globalKey: 'JSZip' })
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
