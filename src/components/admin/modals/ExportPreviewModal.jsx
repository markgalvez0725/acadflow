import React, { useMemo, useState } from 'react'
import Modal from '@/components/primitives/Modal'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import {
  buildGradesData,
  buildAttendanceData,
  buildGradesPreviewHTML,
  buildAttendancePreviewHTML,
  buildStudentPreviewHTML,
  buildGradesWorkbook,
  buildAttendanceWorkbook,
  buildStudentWorkbook,
} from '@/export/excelExport'
import {
  buildGradesPDFDoc,
  buildAttendancePDFDoc,
  buildStudentPDFDoc,
} from '@/export/pdfExport'

/**
 * Export preview modal — shows an HTML preview before download.
 *
 * Props:
 *  - type       {'grades' | 'attendance' | 'student'}
 *  - classId    {string}   — required for grades / attendance
 *  - subject    {string}   — required for grades / attendance
 *  - student    {object}   — required for student report
 *  - onClose    {function}
 */
export default function ExportPreviewModal({ type, classId, subject, student: studentProp, onClose }) {
  const { students, classes, eqScale } = useData()
  const { toast } = useUI()
  const [downloading, setDownloading] = useState(false)

  // ── Build preview HTML ──────────────────────────────────────────────
  const previewHtml = useMemo(() => {
    try {
      if (type === 'grades') {
        const data = buildGradesData(classId, students, classes, eqScale)
        return buildGradesPreviewHTML(data)
      }
      if (type === 'attendance') {
        const data = buildAttendanceData(classId, students, classes)
        return buildAttendancePreviewHTML(data)
      }
      if (type === 'student') {
        return buildStudentPreviewHTML(studentProp, classes, students, eqScale)
      }
    } catch (e) {
      return `<p style="color:red;padding:16px">Error building preview: ${e.message}</p>`
    }
    return ''
  }, [type, classId, subject, studentProp, students, classes, eqScale])

  // ── Derive title / subtitle ─────────────────────────────────────────
  const cls = classId ? classes.find(c => c.id === classId) : null
  const title = type === 'student'
    ? `Student Report — ${studentProp?.name || ''}`
    : type === 'grades'
      ? `Grades — ${cls ? cls.name + ' ' + cls.section : ''} · ${subject || ''}`
      : `Attendance — ${cls ? cls.name + ' ' + cls.section : ''} · ${subject || ''}`

  // ── Download handlers ───────────────────────────────────────────────
  async function handleExcel() {
    if (!window.XLSX) { toast('SheetJS (XLSX) not loaded.', 'error'); return }
    setDownloading(true)
    try {
      let wb
      if (type === 'grades') {
        const data = buildGradesData(classId, students, classes, eqScale)
        wb = buildGradesWorkbook(data, students, classes, eqScale)
      } else if (type === 'attendance') {
        const data = buildAttendanceData(classId, students, classes)
        wb = buildAttendanceWorkbook(data, students, classes)
      } else if (type === 'student') {
        wb = buildStudentWorkbook(studentProp, classes, students, eqScale)
      }
      if (wb) {
        const today = new Date().toISOString().slice(0, 10)
        const base = type === 'student'
          ? `Report_${(studentProp?.name || 'student').replace(/\s+/g, '_')}`
          : type === 'grades'
            ? `Grades_${(cls?.section || 'class')}_${subject || 'all'}`
            : `Attendance_${(cls?.section || 'class')}_${subject || 'all'}`
        window.XLSX.writeFile(wb, `${base}_${today}.xlsx`)
      }
    } catch (e) {
      toast('Export failed: ' + e.message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  function handlePDF() {
    if (!window.jspdf) { toast('jsPDF not loaded.', 'error'); return }
    try {
      if (type === 'grades') {
        const data = buildGradesData(classId, students, classes, eqScale)
        buildGradesPDFDoc(data, students, classes)
      } else if (type === 'attendance') {
        const data = buildAttendanceData(classId, students, classes)
        buildAttendancePDFDoc(data, students, classes)
      } else if (type === 'student') {
        buildStudentPDFDoc(studentProp, classes, students, eqScale)
      }
    } catch (e) {
      toast('PDF failed: ' + e.message, 'error')
    }
  }

  return (
    <Modal onClose={onClose} maxWidth={900}>
      <div className="modal-header">
        <div>
          <h2 className="modal-title">Export Preview</h2>
          <p className="text-xs text-ink3 mt-0.5">{title}</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={handlePDF}
            disabled={downloading}
            title="Download PDF"
          >
            📄 PDF
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleExcel}
            disabled={downloading}
            title="Download Excel"
          >
            {downloading ? 'Exporting…' : '📊 Excel'}
          </button>
        </div>
      </div>

      <div className="modal-body" style={{ padding: 0 }}>
        {previewHtml ? (
          <iframe
            srcDoc={previewHtml}
            title="Export Preview"
            style={{
              width: '100%',
              minHeight: 520,
              border: 'none',
              borderRadius: '0 0 12px 12px',
              background: '#fff',
            }}
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="p-6 text-ink2 text-sm text-center">No data to preview.</div>
        )}
      </div>
    </Modal>
  )
}
