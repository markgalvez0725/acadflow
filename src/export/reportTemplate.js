// ── Centralized report template engine ────────────────────────────────────
// ONE branded header/footer/signature path shared by every export (grades,
// attendance, quiz, activities, student profile) for both PDF (jsPDF) and Excel.
//
// Branding (school name, department, address, logo) is set ONCE from
// DataContext via setReportBranding() and read here, so no call site has to
// thread it through. The logo is a base64 PNG/JPG data URL captured in admin
// Settings; logoW/logoH are stored alongside it so PDF sizing stays synchronous.
//
// Reuse drawReportHeader / drawReportFooter / drawSignatures for any new report
// instead of hand-drawing a header. pdfHeader() in pdfExport.js is now a thin
// shim over drawReportHeader().

import { registerPdfFonts } from '@/export/pdfFonts'

// ── Branding cache (set once, read everywhere) ─────────────────────────────
let _branding = null
export function setReportBranding(b) { _branding = (b && typeof b === 'object') ? b : null }
export function getReportBranding() { return _branding }

// ── Professor cache (the admin's display NAME only, set from DataContext) ───
// Printed in the report header and on the "Prepared by" signature line. By
// design this stores only the name - the professor PHOTO is never exported.
let _professor = null
export function setReportProfessor(p) {
  const name = p && typeof p.name === 'string' ? p.name.trim() : ''
  _professor = name ? { name } : null
}
export function getReportProfessor() { return _professor }

// "Mark Arnold Galvez" -> "Prof. Mark Arnold Galvez", but leave an existing
// honorific (Prof./Dr./Engr./Atty./Mr./Ms./Mrs./Sir/Rev.) untouched.
export function professorWithTitle(name) {
  const n = String(name || '').trim()
  if (!n) return n
  if (/^(prof|dr|engr|atty|sir|ms|mr|mrs|sr|rev)\b\.?/i.test(n)) return n
  return `Prof. ${n}`
}

// Accent colors per report type (RGB). Drives the header band + table head.
export const REPORT_ACCENTS = {
  grades:     [29, 78, 216],   // blue
  attendance: [20, 83, 45],    // green
  quiz:       [80, 70, 228],   // purple
  activities: [180, 83, 9],    // amber
  student:    [29, 78, 216],   // blue
}

function fmtToday() {
  return new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
}

// jsPDF wants 'PNG' or 'JPEG'; derive it from the data-URL mime.
function pdfImageFormat(dataUrl) {
  return /image\/png/i.test(dataUrl || '') ? 'PNG' : 'JPEG'
}

// ── PDF: branded header ────────────────────────────────────────────────────
/**
 * Draw the shared report header as a LETTERHEAD (no solid color band): logo +
 * school name / department / address on the left in dark ink, the report title
 * in the accent color on the right with its meta, then a thin accent rule above
 * the body. The accent still color-codes the report type, just subtly.
 * Returns the y-coordinate after the header (34, so existing layouts are kept).
 *
 * @param {object} doc      jsPDF instance
 * @param {object} opts     { title, subtitle?, accent? = REPORT_ACCENTS.grades }
 * @param {object} [branding] overrides the cached branding
 * @returns {number} y after header
 */
const INK = [33, 37, 41]
const MUTED = [110, 116, 126]

export function drawReportHeader(doc, { title = '', subtitle = '', accent = REPORT_ACCENTS.grades } = {}, branding) {
  const b = branding || getReportBranding() || {}
  const pageW = doc.internal.pageSize.getWidth()

  // Embed Plus Jakarta Sans + Lexend on this doc (overrides Helvetica -> Lexend
  // for the whole report); HEAD is the headings face, falling back to Helvetica.
  const fams = registerPdfFonts(doc)
  const HEAD = fams ? fams.head : 'helvetica'
  const prof = getReportProfessor()
  const topY = 9

  // Logo (left), sized from stored aspect ratio so this stays synchronous.
  let textX = 10
  if (b.logo) {
    try {
      const ratio = (b.logoW && b.logoH) ? (b.logoW / b.logoH) : 1
      const maxH = 16
      let drawH = maxH, drawW = maxH * ratio
      if (drawW > 30) { drawW = 30; drawH = 30 / ratio }
      doc.addImage(b.logo, pdfImageFormat(b.logo), 10, topY, drawW, drawH)
      textX = 10 + drawW + 5
    } catch (e) { /* unreadable image - fall back to text-only */ }
  }

  // School block (left, dark ink)
  doc.setTextColor(INK[0], INK[1], INK[2])
  doc.setFont(HEAD, 'bold'); doc.setFontSize(14)
  doc.text(String(b.schoolName || 'AcadFlow'), textX, topY + 5)
  let ly = topY + 10
  doc.setFont('helvetica', 'normal'); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
  if (b.department) { doc.setFontSize(9); doc.text(String(b.department), textX, ly); ly += 4.5 }
  if (b.address) { doc.setFontSize(8); doc.text(String(b.address), textX, ly) }

  // Right: title (accent) + meta (muted)
  doc.setFont(HEAD, 'bold'); doc.setFontSize(15)
  doc.setTextColor(accent[0], accent[1], accent[2])
  doc.text(String(title), pageW - 10, topY + 5, { align: 'right' })
  let ry = topY + 11
  doc.setFont('helvetica', 'normal'); doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
  if (subtitle) {
    doc.setFontSize(8)
    const lines = doc.splitTextToSize(String(subtitle), pageW / 2 - 6).slice(0, prof ? 1 : 2)
    doc.text(lines, pageW - 10, ry, { align: 'right' })
    ry += 4 * lines.length
  }
  if (prof) {
    doc.setFontSize(8)
    doc.text(`Professor: ${prof.name}`, pageW - 10, ry, { align: 'right' })
  }

  // Thin accent rule + hairline separating the header from the body.
  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.rect(10, 28, pageW - 20, 0.9, 'F')
  doc.setFillColor(224, 228, 234)
  doc.rect(10, 29.2, pageW - 20, 0.3, 'F')

  doc.setTextColor(30, 30, 30)
  return 34
}

// Shared table-header styling for the lighter letterhead look: dark text on
// white (no solid fill). Pair with headUnderline() for the accent underline.
export function tableHeadStyles() {
  return { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold' }
}

// autoTable didDrawCell hook: draw an accent underline beneath each header cell.
export function headUnderline(doc, accent = REPORT_ACCENTS.grades) {
  return (d) => {
    if (!d || d.section !== 'head') return
    doc.setDrawColor(accent[0], accent[1], accent[2])
    doc.setLineWidth(0.5)
    doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height)
  }
}

// ── PDF: branded footer (every page) ───────────────────────────────────────
/**
 * @param {object} doc
 * @param {object} [opts] { note? } - when `note` is set it replaces the default
 *   page line with an italic disclaimer (used by the student report card).
 */
export function drawReportFooter(doc, { note } = {}) {
  const b = getReportBranding() || {}
  const school = b.schoolName || 'AcadFlow'
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setTextColor(150)
    if (note) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5)
      doc.text(String(note), pageW / 2, pageH - 5, { align: 'center' })
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text(`Page ${i} of ${pageCount}  ·  ${school} · Generated via AcadFlow on ${fmtToday()}`,
        pageW / 2, pageH - 5, { align: 'center' })
    }
  }
  doc.setTextColor(30, 30, 30)
}

// ── PDF: signature lines ───────────────────────────────────────────────────
/**
 * Draw a row of signature lines (Prepared by / Verified by, etc.) at y.
 * @param {object} doc
 * @param {number} y
 * @param {string[]} [roles]
 * @returns {number} y after the block
 */
export function drawSignatures(doc, y, roles = ['Prepared by', 'Verified by']) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  // Keep the block on the current page; if too low, push to the bottom margin.
  let by = Math.min(y + 6, pageH - 22)
  const n = roles.length
  const gap = 10
  const colW = (pageW - 16 - gap * (n - 1)) / n
  const prof = getReportProfessor()
  doc.setTextColor(90)
  roles.forEach((role, i) => {
    const x = 8 + i * (colW + gap)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(String(role), x, by)
    // Print the professor's name on the preparer's signature line.
    if (/prepared/i.test(role) && prof?.name) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(40)
      doc.text(professorWithTitle(prof.name), x + colW / 2, by + 10, { align: 'center', maxWidth: colW - 4 })
      doc.setFont('helvetica', 'normal'); doc.setTextColor(90)
    }
    doc.setDrawColor(120)
    doc.line(x, by + 12, x + colW, by + 12)
  })
  doc.setTextColor(30, 30, 30)
  return by + 16
}

// ── Excel: branded title rows + logo ───────────────────────────────────────
/**
 * Title rows (array-of-arrays) to prepend to a report sheet:
 * [school name], [department], [address], [report title - subtitle].
 * Empty branding falls back to "AcadFlow".
 */
export function brandingTitleRows(title = '', subtitle = '') {
  const b = getReportBranding() || {}
  const rows = [[String(b.schoolName || 'AcadFlow')]]
  if (b.department) rows.push([String(b.department)])
  if (b.address) rows.push([String(b.address)])
  rows.push([[title, subtitle].filter(Boolean).join('  -  ')])
  return rows
}

/**
 * Logo payload for ExcelJS workbook.addImage(): { base64, extension } or null.
 * (SheetJS fallback can't embed images - callers just skip it.)
 */
export function excelLogo() {
  const b = getReportBranding() || {}
  if (!b.logo || typeof b.logo !== 'string') return null
  const m = b.logo.match(/^data:image\/(png|jpe?g);base64,(.+)$/i)
  if (!m) return null
  const ext = /png/i.test(m[1]) ? 'png' : 'jpeg'
  return { base64: m[2], extension: ext, w: b.logoW || 0, h: b.logoH || 0 }
}
