// ── Student Report Card (PDF) ─────────────────────────────────────────────
// Per-student printable report card / transcript. Uses window.jspdf (jsPDF +
// autoTable) loaded via CDN in index.html, and the shared pdfHeader.
import {
  gradeInfo, combineEquiv, computeFinalGradeFromTerms, getGWA, getAttRate, DEFAULT_EQ_SCALE,
} from '@/utils/grades.js'
import { pdfHeader } from '@/export/pdfExport.js'
import { courseShort } from '@/constants/courses'
import { drawSignatures, getReportBranding } from '@/export/reportTemplate.js'

function fmtDate() {
  return new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
}
function safeFileName(str = '') {
  return String(str).replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 50)
}

function enrolledIdsOf(s) {
  return s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
}

// Draw one complete report card onto the current page of `doc`. Creating the
// document and saving it are the caller's responsibility - this lets a single
// student card and a whole-class batch share the exact same layout.
function renderReportCard(doc, student, { classes = [], students = [], eqScale = DEFAULT_EQ_SCALE, semester } = {}) {
  const pageW = doc.internal.pageSize.getWidth()

  const semLabel = semester ? (semester.label || `${semester.term || ''} AY ${semester.year || ''}`.trim()) : '-'
  const ids = enrolledIdsOf(student)
  const primaryClass = classes.find(c => c.id === (student.classId || ids[0]))
  const subs = ids.length
    ? [...new Set(ids.flatMap(id => classes.find(c => c.id === id)?.subjects || []))]
    : Object.keys(student.grades || {})

  let y = pdfHeader(doc, 'Report Card', `${semLabel}  ·  Generated ${fmtDate()}`)

  // ── Student info block ──────────────────────────────────────────────────
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 30)
  doc.text(student.name || 'Student', 12, y)
  y += 6
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 100)
  const info = [
    `Student No: ${student.snum || student.id || '-'}`,
    `Course: ${courseShort(student.course) || '-'}`,
    primaryClass ? `Class: ${courseShort(primaryClass.name)}${primaryClass.section ? ' - ' + primaryClass.section : ''}` : null,
  ].filter(Boolean)
  doc.text(info.join('     '), 12, y)
  y += 8

  // ── Grade table ─────────────────────────────────────────────────────────
  const rows = subs.map(sub => {
    const comp = student.gradeComponents?.[sub] || {}
    const mid = comp.midterm ?? null
    const fin = comp.finals ?? null
    const finalPct = computeFinalGradeFromTerms(mid, fin) ?? student.grades?.[sub] ?? null
    let equiv = '-', remark = 'Pending'
    if (mid != null && fin != null) {
      const c = combineEquiv(gradeInfo(mid, eqScale).eq, gradeInfo(fin, eqScale).eq)
      equiv = c.eq; remark = c.rem
    }
    return [
      sub,
      mid != null ? mid.toFixed(1) : '-',
      fin != null ? fin.toFixed(1) : '-',
      finalPct != null ? finalPct.toFixed(1) + '%' : '-',
      equiv,
      remark,
    ]
  })

  doc.autoTable({
    startY: y,
    head: [['Subject', 'Midterm', 'Finals', 'Final %', 'Equiv', 'Remark']],
    body: rows.length ? rows : [['No subjects enrolled', '', '', '', '', '']],
    theme: 'striped',
    headStyles: { fillColor: [80, 70, 228], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9, textColor: [40, 40, 50] },
    columnStyles: {
      1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' },
      4: { halign: 'center', fontStyle: 'bold' }, 5: { halign: 'center' },
    },
    margin: { left: 12, right: 12 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const v = data.cell.raw
        if (v === 'Passed') data.cell.styles.textColor = [22, 122, 74]
        else if (v === 'Failed') data.cell.styles.textColor = [185, 50, 50]
        else if (v === 'Conditional') data.cell.styles.textColor = [217, 119, 6]
      }
    },
  })

  // ── Summary ─────────────────────────────────────────────────────────────
  const gwa = getGWA(student, classes)
  const att = getAttRate(student, students, classes)
  let standing = 'Pending'
  if (gwa != null) {
    if (gwa >= 90) standing = "Excellent / Dean's List candidate"
    else if (gwa >= 85) standing = 'Good Standing'
    else if (gwa >= 75) standing = 'Passing'
    else standing = 'At Risk'
  }

  let sy = doc.lastAutoTable.finalY + 10
  doc.setDrawColor(225, 225, 232)
  doc.setFillColor(248, 248, 252)
  doc.roundedRect(12, sy, pageW - 24, 26, 2, 2, 'FD')
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(90, 90, 100)
  const colW = (pageW - 24) / 3
  const cells = [
    ['GWA', gwa != null ? gwa.toFixed(2) : '-'],
    ['Attendance', att != null ? att.toFixed(1) + '%' : '-'],
    ['Standing', standing],
  ]
  cells.forEach(([label, val], i) => {
    const cx = 12 + colW * i + colW / 2
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 130)
    doc.text(label.toUpperCase(), cx, sy + 9, { align: 'center' })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(i === 2 ? 9 : 12); doc.setTextColor(30, 30, 40)
    doc.text(String(val), cx, sy + 18, { align: 'center', maxWidth: colW - 6 })
  })

  // ── Signature lines + footer (branded, per card) ──────────────────────────
  drawSignatures(doc, sy + 30, ['Prepared by', 'Verified by'])
  const school = getReportBranding()?.schoolName || 'AcadFlow'
  const fy = doc.internal.pageSize.getHeight() - 8
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(150, 150, 160)
  doc.text(`${school} · Generated via AcadFlow. This document reflects records at the time of export and is not an official transcript.`, pageW / 2, fy, { align: 'center', maxWidth: pageW - 24 })
  doc.setTextColor(30, 30, 30)
}

/**
 * Build and save a portrait A4 report card for a single student.
 * @param {object} student
 * @param {{classes:object[], students:object[], eqScale?:object[], semester?:object}} ctx
 */
export function buildStudentReportCard(student, ctx = {}) {
  if (!window.jspdf) { alert('PDF library not loaded yet. Please try again in a moment.'); return }
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  renderReportCard(doc, student, ctx)
  doc.save(`ReportCard_${safeFileName(student.name || student.id)}.pdf`)
}

/**
 * Build and save a single PDF containing one report card page per student in a
 * class - for printing or distributing a whole class's term reports at once.
 * @param {object} cls   the class document
 * @param {{classes:object[], students:object[], eqScale?:object[], semester?:object}} ctx
 */
export function buildClassReportCards(cls, ctx = {}) {
  if (!window.jspdf) { alert('PDF library not loaded yet. Please try again in a moment.'); return }
  if (!cls) return
  const { students = [] } = ctx
  const enrolled = students
    .filter(s => s.classId === cls.id || s.classIds?.includes(cls.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  if (!enrolled.length) { alert('No students are enrolled in this class.'); return }

  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  enrolled.forEach((s, i) => {
    if (i > 0) doc.addPage()
    renderReportCard(doc, s, ctx)
  })
  doc.save(`ClassReportCards_${safeFileName(`${cls.name}${cls.section ? '_' + cls.section : ''}`)}.pdf`)
}
