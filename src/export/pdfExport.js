// ── PDF Export Layer ──────────────────────────────────────────────────────
// Uses window.jspdf (jsPDF + autoTable plugin — loaded via CDN <script> in index.html).
// All functions accept explicit (students, classes) args — no globals.

import {
  gradeInfoForStudent,
  getGWA,
  getAttRate,
  getHeldDays,
  gradeInfo,
  equivInfo,
  DEFAULT_EQ_SCALE,
} from '@/utils/grades.js'
import { sortByLastName } from '@/utils/format.js'

// ── Helpers ───────────────────────────────────────────────────────────────

function getClassStudents(classId, students) {
  return students.filter(s =>
    (s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])).includes(classId)
  )
}

function fmtDate() {
  return new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
}

function safeFileName(str) {
  return str.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 50)
}

// ── pdfHeader ─────────────────────────────────────────────────────────────
/**
 * Draws the standard AcadFlow PDF header (blue bar, title, subtitle).
 * Returns the y-coordinate after the header (y = 34).
 *
 * @param {object} doc — jsPDF instance
 * @param {string} title
 * @param {string} subtitle
 * @param {object} [cls] — class record (optional)
 * @returns {number} y = 34
 */
export function pdfHeader(doc, title, subtitle, cls) {
  // Blue header rectangle
  doc.setFillColor(29, 78, 216)  // #1d4ed8
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, 'F')

  // AcadFlow branding (top-left)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text('AcadFlow', 10, 9)

  // Title (center)
  doc.setFontSize(13)
  doc.text(title, doc.internal.pageSize.getWidth() / 2, 9, { align: 'center' })

  // Subtitle (center, below title)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(219, 234, 254)  // light blue
  doc.text(subtitle, doc.internal.pageSize.getWidth() / 2, 17, { align: 'center' })

  // Reset text color
  doc.setTextColor(30, 30, 30)

  return 34
}

// ── buildGradesPDFDoc ─────────────────────────────────────────────────────
/**
 * Builds and saves a landscape A4 PDF grades report for a class.
 * Includes a stats bar and a color-coded autoTable.
 *
 * @param {object} data — from buildGradesData()
 * @param {object[]} students
 * @param {object[]} classes
 */
export function buildGradesPDFDoc(data, students, classes) {
  if (!window.jspdf) { alert('jsPDF not loaded.'); return }
  const { jsPDF } = window.jspdf
  const { cls, headers, rows, summaryRow, subs } = data

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const subtitle = `${cls.name || cls.id}  ·  Section: ${cls.section || '—'}  ·  S.Y. ${cls.sy || '—'}  ·  Exported: ${fmtDate()}`
  let y = pdfHeader(doc, 'Grade Summary', subtitle, cls)

  // Stats bar
  const passCount = rows.filter(r => {
    const rem = r[r.length - 1]
    return rem === 'Passed'
  }).length
  const failCount = rows.filter(r => r[r.length - 1] === 'Failed').length
  const condCount = rows.filter(r => r[r.length - 1] === 'Conditional').length

  doc.setFillColor(239, 246, 255)  // #eff6ff
  doc.roundedRect(8, y - 4, pageW - 16, 14, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(30, 64, 175)
  doc.text(`Total: ${rows.length}`, 14, y + 4)
  doc.setTextColor(22, 101, 52)
  doc.text(`Passed: ${passCount}`, 48, y + 4)
  doc.setTextColor(153, 27, 27)
  doc.text(`Failed: ${failCount}`, 86, y + 4)
  doc.setTextColor(133, 77, 14)
  doc.text(`Conditional: ${condCount}`, 118, y + 4)
  doc.setTextColor(30, 30, 30)

  y += 16

  // Table
  const subColCount = subs.length
  doc.autoTable({
    startY: y,
    head: [headers],
    body: [...rows, summaryRow],
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 36 },    // Student Name
      1: { cellWidth: 16 },    // Student No.
      2: { cellWidth: 20 },    // Course
      3: { cellWidth: 12 },    // Year
    },
    didParseCell(hookData) {
      const { row, column, cell } = hookData
      if (row.section === 'head') return
      // Color-code equiv columns (indices 4..4+subColCount+1)
      const colIdx = column.index
      if (colIdx >= 4 && colIdx <= 4 + subColCount) {
        const val = parseFloat(cell.raw)
        if (!isNaN(val)) {
          if (val <= 2.00) { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52] }
          else if (val <= 3.00) { cell.styles.fillColor = [254, 249, 195]; cell.styles.textColor = [133, 77, 14] }
          else { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27] }
        }
      }
      // Bold summary row
      if (row.index === rows.length) {
        cell.styles.fontStyle = 'bold'
        cell.styles.fillColor = [224, 231, 255]
      }
    },
    margin: { left: 8, right: 8 },
  })

  // Footer
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(
      `Page ${i} of ${pageCount}  ·  Generated by AcadFlow`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 5,
      { align: 'center' }
    )
  }

  const safeSection = safeFileName(cls.section || cls.name || cls.id)
  const datePart = new Date().toISOString().slice(0, 10)
  doc.save(`Grades_${safeSection}_${datePart}.pdf`)
}

// ── buildAttendancePDFDoc ─────────────────────────────────────────────────
/**
 * Builds and saves a landscape A4 PDF attendance report for a class.
 * Includes a stats bar and a color-coded autoTable.
 *
 * @param {object} data — from buildAttendanceData()
 * @param {object[]} students
 * @param {object[]} classes
 */
export function buildAttendancePDFDoc(data, students, classes) {
  if (!window.jspdf) { alert('jsPDF not loaded.'); return }
  const { jsPDF } = window.jspdf
  const { cls, headers, rows, summaryRow, subs } = data

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()

  const subtitle = `${cls.name || cls.id}  ·  Section: ${cls.section || '—'}  ·  S.Y. ${cls.sy || '—'}  ·  Exported: ${fmtDate()}`
  let y = pdfHeader(doc, 'Attendance Summary', subtitle, cls)

  // Stats bar (green theme)
  const goodCount = rows.filter(r => {
    const rate = parseFloat(r[r.length - 1])
    return !isNaN(rate) && rate >= 90
  }).length
  const warnCount = rows.filter(r => {
    const rate = parseFloat(r[r.length - 1])
    return !isNaN(rate) && rate >= 80 && rate < 90
  }).length
  const poorCount = rows.filter(r => {
    const rate = parseFloat(r[r.length - 1])
    return !isNaN(rate) && rate < 80
  }).length

  doc.setFillColor(240, 253, 244)  // #f0fdf4
  doc.roundedRect(8, y - 4, pageW - 16, 14, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(30, 30, 30)
  doc.text(`Total: ${rows.length}`, 14, y + 4)
  doc.setTextColor(22, 101, 52)
  doc.text(`≥90% (Good): ${goodCount}`, 48, y + 4)
  doc.setTextColor(133, 77, 14)
  doc.text(`80–89% (Warning): ${warnCount}`, 92, y + 4)
  doc.setTextColor(153, 27, 27)
  doc.text(`<80% (At Risk): ${poorCount}`, 148, y + 4)
  doc.setTextColor(30, 30, 30)

  y += 16

  // Rate column indices: after 4 base cols + subs.length present-count cols
  const rateStartIdx = 4 + subs.length

  doc.autoTable({
    startY: y,
    head: [headers],
    body: [...rows, summaryRow],
    styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [20, 83, 45], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 16 },
      2: { cellWidth: 20 },
      3: { cellWidth: 12 },
    },
    didParseCell(hookData) {
      const { row, column, cell } = hookData
      if (row.section === 'head') return
      const colIdx = column.index
      // Color rate columns
      if (colIdx >= rateStartIdx) {
        const val = parseFloat(cell.raw)
        if (!isNaN(val)) {
          if (val >= 90) { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52] }
          else if (val >= 80) { cell.styles.fillColor = [254, 249, 195]; cell.styles.textColor = [133, 77, 14] }
          else { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27] }
        }
      }
      // Bold summary row
      if (row.index === rows.length) {
        cell.styles.fontStyle = 'bold'
        cell.styles.fillColor = [209, 250, 229]
      }
    },
    margin: { left: 8, right: 8 },
  })

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(
      `Page ${i} of ${pageCount}  ·  Generated by AcadFlow`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 5,
      { align: 'center' }
    )
  }

  const safeSection = safeFileName(cls.section || cls.name || cls.id)
  const datePart = new Date().toISOString().slice(0, 10)
  doc.save(`Attendance_${safeSection}_${datePart}.pdf`)
}

// ── buildStudentPDFDoc ────────────────────────────────────────────────────
/**
 * Builds and saves a portrait A4 PDF report for one student.
 * Includes: student info card, 3 summary boxes (GWA / Attendance / Status),
 * grades table, and attendance table.
 *
 * @param {object} s — student record
 * @param {object[]} classes
 * @param {object[]} students — full roster
 * @param {object[]} [eqScale]
 */
export function buildStudentPDFDoc(s, classes, students, eqScale = DEFAULT_EQ_SCALE) {
  if (!window.jspdf) { alert('jsPDF not loaded.'); return }
  const { jsPDF } = window.jspdf

  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allSubs = [...new Set(
    enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || [])
  )]

  const doc     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW   = doc.internal.pageSize.getWidth()
  const pageH   = doc.internal.pageSize.getHeight()

  const gwa     = getGWA(s, classes)
  const attRate = getAttRate(s, students, classes)
  const gwaInfo = gwa != null ? equivInfo(gwa.toFixed(2)) : { rem: 'No Grade' }

  const subtitle = `${s.id}  ·  ${s.course || '—'}  ·  ${s.year || '—'}  ·  Exported: ${fmtDate()}`
  let y = pdfHeader(doc, 'Student Report', subtitle)

  // ── Student info card ─────────────────────────────────────────────────
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(8, y - 2, pageW - 16, 18, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text(s.name, 14, y + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100)
  doc.text(`Course: ${s.course || '—'}  |  Year: ${s.year || '—'}  |  Student No.: ${s.id}`, 14, y + 12)
  if (s.dob) doc.text(`Date of Birth: ${s.dob}  |  Mobile: ${s.mobile || '—'}`, 14, y + 17)

  y += 24

  // ── 3 summary boxes: GWA / Attendance / Status ────────────────────────
  const boxW = (pageW - 20) / 3
  const boxes = [
    {
      label: 'GWA',
      value: gwa != null ? gwa.toFixed(2) : '—',
      sub:   gwaInfo.rem,
      fill:  [239, 246, 255],
      text:  [30, 64, 175],
    },
    {
      label: 'Attendance',
      value: attRate != null ? `${attRate}%` : '—',
      sub:   attRate != null ? (attRate >= 90 ? 'Good Standing' : attRate >= 80 ? 'Warning' : 'At Risk') : 'No Data',
      fill:  [240, 253, 244],
      text:  [20, 83, 45],
    },
    {
      label: 'Status',
      value: gwaInfo.rem,
      sub:   gwa != null ? `Equiv: ${gwa.toFixed(2)}` : 'No grades yet',
      fill:  gwaInfo.rem === 'Failed' ? [254, 226, 226] : gwaInfo.rem === 'Conditional' ? [254, 249, 195] : [240, 253, 244],
      text:  gwaInfo.rem === 'Failed' ? [153, 27, 27]  : gwaInfo.rem === 'Conditional' ? [133, 77, 14]  : [20, 83, 45],
    },
  ]

  boxes.forEach((box, i) => {
    const bx = 8 + i * (boxW + 2)
    doc.setFillColor(...box.fill)
    doc.roundedRect(bx, y, boxW, 18, 2, 2, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(120)
    doc.text(box.label, bx + boxW / 2, y + 5, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...box.text)
    doc.text(box.value, bx + boxW / 2, y + 12, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(120)
    doc.text(box.sub, bx + boxW / 2, y + 17, { align: 'center' })
  })

  doc.setTextColor(30, 30, 30)
  y += 24

  // ── Grades table ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Academic Grades', 8, y + 5)
  y += 8

  const gradeHead = [['Subject', 'Midterm (%)', 'Finals (%)', 'Equiv', 'Letter', 'Remark', 'Uploaded']]
  const gradeBody = allSubs.map(sub => {
    const comp   = s.gradeComponents?.[sub] || {}
    const midG   = comp.midterm ?? null
    const finG   = comp.finals  ?? null
    const info   = gradeInfoForStudent(s, sub, eqScale)
    const ts     = s.gradeUploadedAt?.[sub]
    const uploaded = ts ? new Date(ts).toLocaleDateString('en-PH', { dateStyle: 'short' }) : '—'

    const displayEq  = info.eq  !== '—' ? info.eq  : (midG != null ? gradeInfo(midG, eqScale).eq  : '—')
    const displayLtr = info.ltr !== '—' ? info.ltr : (midG != null ? gradeInfo(midG, eqScale).ltr : '—')
    const displayRem = info.rem !== 'Pending' ? info.rem : (midG != null ? 'Midterm Only' : 'Pending')

    return [sub, midG ?? '—', finG ?? '—', displayEq, displayLtr, displayRem, uploaded]
  })

  doc.autoTable({
    startY: y,
    head: gradeHead,
    body: gradeBody,
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 40 },
      3: { halign: 'center' },
      4: { halign: 'center' },
    },
    didParseCell(hookData) {
      const { column, cell, row } = hookData
      if (row.section === 'head') return
      if (column.index === 3) {
        const val = parseFloat(cell.raw)
        if (!isNaN(val)) {
          if (val <= 2.00) { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52] }
          else if (val <= 3.00) { cell.styles.fillColor = [254, 249, 195]; cell.styles.textColor = [133, 77, 14] }
          else if (val <= 4.00) { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27] }
        }
      }
    },
    margin: { left: 8, right: 8 },
  })

  y = doc.lastAutoTable.finalY + 8

  // ── Attendance table ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Attendance Record', 8, y + 5)
  y += 8

  const attHead = [['Subject', 'Sessions', 'Present', 'Excused', 'Absent', 'Rate (%)']]
  const attBody = allSubs.map(sub => {
    const classId = enrolledIds.find(id => classes.find(c => c.id === id)?.subjects?.includes(sub))
    const held    = classId ? getHeldDays(classId, sub, students) : 0
    const attSet  = s.attendance?.[sub]
    const exSet   = s.excuse?.[sub]
    const present = attSet instanceof Set ? attSet.size : (Array.isArray(attSet) ? attSet.length : 0)
    const excused = exSet  instanceof Set ? exSet.size  : (Array.isArray(exSet)  ? exSet.length  : 0)
    const absent  = Math.max(0, held - present - excused)
    const rate    = held > 0 ? parseFloat(((present / held) * 100).toFixed(1)) : '—'
    return [sub, held, present, excused, absent, typeof rate === 'number' ? `${rate}%` : '—']
  })

  doc.autoTable({
    startY: y,
    head: attHead,
    body: attBody,
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [20, 83, 45], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'center' },
    },
    didParseCell(hookData) {
      const { column, cell, row } = hookData
      if (row.section === 'head') return
      if (column.index === 5) {
        const val = parseFloat(cell.raw)
        if (!isNaN(val)) {
          if (val >= 90) { cell.styles.fillColor = [220, 252, 231]; cell.styles.textColor = [22, 101, 52] }
          else if (val >= 80) { cell.styles.fillColor = [254, 249, 195]; cell.styles.textColor = [133, 77, 14] }
          else { cell.styles.fillColor = [254, 226, 226]; cell.styles.textColor = [153, 27, 27] }
        }
      }
    },
    margin: { left: 8, right: 8 },
  })

  // ── Footer on every page ──────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    doc.setTextColor(150)
    doc.text(
      `This document was generated by AcadFlow on ${fmtDate()}. For official purposes, please request a signed copy from the registrar.`,
      pageW / 2,
      pageH - 5,
      { align: 'center' }
    )
  }

  const safeName = safeFileName(s.name || s.id)
  const datePart = new Date().toISOString().slice(0, 10)
  doc.save(`Report_${safeName}_${datePart}.pdf`)
}
