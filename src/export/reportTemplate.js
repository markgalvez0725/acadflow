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

// ── Branding cache (set once, read everywhere) ─────────────────────────────
let _branding = null
export function setReportBranding(b) { _branding = (b && typeof b === 'object') ? b : null }
export function getReportBranding() { return _branding }

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
 * Draw the shared report header: accent band, optional logo (left), school
 * name / department / address (left), and report title + subtitle (right).
 * Returns the y-coordinate after the header (34, matching the legacy header so
 * existing layouts are unchanged).
 *
 * @param {object} doc      jsPDF instance
 * @param {object} opts     { title, subtitle?, accent? = REPORT_ACCENTS.grades }
 * @param {object} [branding] overrides the cached branding
 * @returns {number} y after header
 */
export function drawReportHeader(doc, { title = '', subtitle = '', accent = REPORT_ACCENTS.grades } = {}, branding) {
  const b = branding || getReportBranding() || {}
  const pageW = doc.internal.pageSize.getWidth()
  const bandH = 26

  doc.setFillColor(accent[0], accent[1], accent[2])
  doc.rect(0, 0, pageW, bandH, 'F')

  // Logo (left), sized from stored aspect ratio so this stays synchronous.
  let textX = 10
  if (b.logo) {
    try {
      const ratio = (b.logoW && b.logoH) ? (b.logoW / b.logoH) : 1
      const maxH = 16
      let drawH = maxH, drawW = maxH * ratio
      if (drawW > 30) { drawW = 30; drawH = 30 / ratio }
      doc.addImage(b.logo, pdfImageFormat(b.logo), 10, (bandH - drawH) / 2, drawW, drawH)
      textX = 10 + drawW + 5
    } catch (e) { /* unreadable image - fall back to text-only */ }
  }

  // School block (left)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(String(b.schoolName || 'AcadFlow'), textX, 10)
  let ly = 15
  if (b.department) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
    doc.setTextColor(235, 238, 250)
    doc.text(String(b.department), textX, ly); ly += 4
  }
  if (b.address) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.setTextColor(225, 230, 248)
    doc.text(String(b.address), textX, ly)
  }

  // Title + subtitle (right-aligned)
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(String(title), pageW - 10, 10, { align: 'right' })
  if (subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    doc.setTextColor(228, 234, 250)
    const lines = doc.splitTextToSize(String(subtitle), pageW / 2 - 6)
    doc.text(lines, pageW - 10, 16, { align: 'right' })
  }

  doc.setTextColor(30, 30, 30)
  return 34
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
  doc.setTextColor(90)
  roles.forEach((role, i) => {
    const x = 8 + i * (colW + gap)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(String(role), x, by)
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
