// ── Public Google Doc/Slides/Sheets -> plain text (server-side) ────────────
// Phase-B fallback for the professor's Smart grading: when a submission is a
// PASTED Google link (not an uploaded file we already read on-device), the
// browser can't fetch the doc text (CORS). This proxy fetches the public export
// server-side and returns the text. $0 (Node built-in fetch), no key.
//
// SSRF-safe: we only ever build the export URL from a parsed Google file id on
// docs.google.com / drive.google.com - never fetch an arbitrary caller URL.

import { guard } from './_guard.js'

const MAX = 16000
// Drive binary cap. Base64 inflates ~33% and a Vercel function response is
// capped near 4.5 MB, so keep the raw payload modest. Larger files are sent
// back with a "ask the student to upload it" message (the on-device upload path
// has no such limit because it reads the file on the student's own machine).
const DRIVE_MAX = 3 * 1024 * 1024

function extFromMime(mime) {
  const m = (mime || '').toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('bmp')) return 'bmp'
  return 'bin'
}

// Fetch a public Drive image/PDF and return it base64 for on-device OCR/parse.
// Returns { binary, mime, name } on success, or { error, message }.
async function fetchDriveBinary(id) {
  const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'AcadFlow/1.0' } })
  const ct = (r.headers.get('content-type') || '').toLowerCase()
  // A non-public file redirects to an HTML sign-in / permission page.
  if (ct.includes('text/html')) {
    return { error: 403, message: 'That file is not shared. Set it to "anyone with the link", or paste the text.' }
  }
  const isImage = ct.startsWith('image/')
  const isPdf = ct.includes('application/pdf')
  if (!isImage && !isPdf) {
    return { error: 422, message: 'That Drive file type cannot be auto-read. Ask the student to upload it as a submission, or paste the text.' }
  }
  const declared = Number(r.headers.get('content-length') || 0)
  if (declared && declared > DRIVE_MAX) {
    return { error: 413, message: 'That file is large. Ask the student to upload it as a submission so it is read on their device, or paste the text.' }
  }
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > DRIVE_MAX) {
    return { error: 413, message: 'That file is large. Ask the student to upload it as a submission so it is read on their device, or paste the text.' }
  }
  const mime = isPdf ? 'application/pdf' : ct
  return { binary: buf.toString('base64'), mime, name: `submission.${extFromMime(mime)}` }
}

function parseGoogle(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase()
  if (host !== 'docs.google.com' && host !== 'drive.google.com') return null
  const path = u.pathname
  const fromPath = re => { const m = path.match(re); return m ? m[1] : null }
  let id = fromPath(/\/document\/d\/([^/]+)/);      if (id) return { id, type: 'doc' }
  id = fromPath(/\/presentation\/d\/([^/]+)/);      if (id) return { id, type: 'slides' }
  id = fromPath(/\/spreadsheets\/d\/([^/]+)/);      if (id) return { id, type: 'sheet' }
  id = fromPath(/\/file\/d\/([^/]+)/);              if (id) return { id, type: 'drive' }
  id = u.searchParams.get('id');                    if (id) return { id, type: 'drive' }
  return null
}

function exportUrl({ id, type }) {
  if (type === 'doc')    return `https://docs.google.com/document/d/${encodeURIComponent(id)}/export?format=txt`
  if (type === 'slides') return `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/export/txt`
  if (type === 'sheet')  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=csv`
  return null // a Drive binary (image/PDF) - can't extract text at $0 server-side
}

export default async function handler(req, res) {
  if (guard(req, res, { max: 30 })) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed.' }); return }

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
  const url = body && body.url
  if (!url || typeof url !== 'string') { res.status(400).json({ error: 'Missing link.' }); return }

  const parsed = parseGoogle(url)
  if (!parsed) { res.status(422).json({ error: 'Only Google Docs/Slides/Sheets or Drive file links can be read this way.' }); return }

  // A Drive image/PDF: hand the bytes back so the browser OCRs/parses them with
  // the same on-device pipeline the student-upload path uses.
  if (parsed.type === 'drive') {
    try {
      const out = await fetchDriveBinary(parsed.id)
      if (out.error) { res.status(out.error).json({ error: out.message }); return }
      res.status(200).json(out)
    } catch (e) {
      res.status(502).json({ error: 'Could not fetch that Drive file.' })
    }
    return
  }

  const target = exportUrl(parsed)
  if (!target) { res.status(422).json({ error: 'That is a Drive file. Ask the student to upload it as a submission so it is auto-read, or paste the text.' }); return }

  try {
    const r = await fetch(target, { redirect: 'follow', headers: { 'User-Agent': 'AcadFlow/1.0' } })
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    const text = await r.text()
    // A non-public doc redirects to a Google sign-in HTML page rather than text.
    if (ct.includes('text/html') || /<html|accounts\.google\.com|sign in to continue/i.test(text.slice(0, 600))) {
      res.status(403).json({ error: 'That document is not shared. Set it to "anyone with the link", or paste the text.' })
      return
    }
    const clean = text.replace(/\r/g, '').slice(0, MAX)
    if (!clean.trim()) { res.status(422).json({ error: 'No readable text found at that link.' }); return }
    res.status(200).json({ text: clean, chars: clean.length })
  } catch (e) {
    res.status(502).json({ error: 'Could not fetch that link.' })
  }
}
