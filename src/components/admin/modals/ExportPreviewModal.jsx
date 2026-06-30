import React, { useMemo, useState } from 'react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { FileText, BarChart2 } from 'lucide-react'
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
  buildQuizData,
  buildActivitiesData,
  buildQuizPreviewHTML,
  buildActivitiesPreviewHTML,
  buildQuizWorkbook,
  buildActivitiesWorkbook,
} from '@/export/excelExport'
import { courseShort } from '@/constants/courses'
import { analyzeStudentSemesters, subjectsForKey, labelForKey } from '@/utils/exportSemesters'
import {
  buildGradesPDFDoc,
  buildAttendancePDFDoc,
  buildStudentPDFDoc,
  buildQuizPDFDoc,
  buildActivitiesPDFDoc,
} from '@/export/pdfExport'

/**
 * Export preview modal - shows an HTML preview before download.
 *
 * Props:
 *  - type       {'grades' | 'attendance' | 'student' | 'quiz' | 'activities'}
 *  - classId    {string}   - required for grades / attendance / quiz / activities
 *  - subject    {string}   - required for grades / attendance
 *  - student    {object}   - required for student report
 *  - onClose    {function}
 */
export default function ExportPreviewModal({ type, classId, subject, student: studentProp, onClose }) {
  const { students, classes, eqScale, quizzes, activities, semester } = useData()
  const { toast } = useUI()
  const [downloading, setDownloading] = useState(false)

  // On-device semester check (student report only): group the student's classes
  // by term so the professor can scope the export to one semester.
  const studentSem = useMemo(
    () => (type === 'student' && studentProp) ? analyzeStudentSemesters(studentProp, classes, semester) : null,
    [type, studentProp, classes, semester]
  )
  const [semKey, setSemKey] = useState(null)
  const effKey = semKey || studentSem?.recommended || 'all'
  const studentOpts = studentSem
    ? { subjectFilter: subjectsForKey(studentSem, effKey), semesterLabel: labelForKey(effKey) }
    : {}

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
        return buildStudentPreviewHTML(studentProp, classes, students, eqScale, studentOpts)
      }
      if (type === 'quiz') {
        return buildQuizPreviewHTML(buildQuizData(classId, students, classes, quizzes))
      }
      if (type === 'activities') {
        return buildActivitiesPreviewHTML(buildActivitiesData(classId, students, classes, activities))
      }
    } catch (e) {
      return `<p style="color:red;padding:16px">Error building preview: ${e.message}</p>`
    }
    return ''
  }, [type, classId, subject, studentProp, students, classes, eqScale, quizzes, activities, effKey, studentSem])

  // ── Derive title / subtitle ─────────────────────────────────────────
  const cls = classId ? classes.find(c => c.id === classId) : null
  const clsLabel = cls ? `${courseShort(cls.name)} ${cls.section || ''}`.trim() : ''
  const title = type === 'student'
    ? `Student Report - ${studentProp?.name || ''}`
    : type === 'grades'
      ? `Grades - ${clsLabel} · ${subject || ''}`
      : type === 'attendance'
        ? `Attendance - ${clsLabel} · ${subject || ''}`
        : type === 'quiz'
          ? `Quiz Report - ${clsLabel}`
          : `Activities Report - ${clsLabel}`

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
        wb = buildStudentWorkbook(studentProp, classes, students, eqScale, studentOpts)
      } else if (type === 'quiz') {
        wb = buildQuizWorkbook(buildQuizData(classId, students, classes, quizzes))
      } else if (type === 'activities') {
        wb = buildActivitiesWorkbook(buildActivitiesData(classId, students, classes, activities))
      }
      if (wb) {
        const today = new Date().toISOString().slice(0, 10)
        const sec = cls?.section || 'class'
        const base = type === 'student'
          ? `Report_${(studentProp?.name || 'student').replace(/\s+/g, '_')}`
          : type === 'grades'
            ? `Grades_${sec}_${subject || 'all'}`
            : type === 'attendance'
              ? `Attendance_${sec}_${subject || 'all'}`
              : type === 'quiz'
                ? `QuizReport_${sec}`
                : `ActivitiesReport_${sec}`
        window.XLSX.writeFile(wb, `${base}_${today}.xlsx`)
      }
    } catch (e) {
      toast('Export failed: ' + e.message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  async function handlePDF() {
    if (!window.jspdf) { toast('jsPDF not loaded.', 'error'); return }
    setDownloading(true)
    try {
      if (type === 'grades') {
        const data = buildGradesData(classId, students, classes, eqScale)
        await buildGradesPDFDoc(data, students, classes)
      } else if (type === 'attendance') {
        const data = buildAttendanceData(classId, students, classes)
        await buildAttendancePDFDoc(data, students, classes)
      } else if (type === 'student') {
        await buildStudentPDFDoc(studentProp, classes, students, eqScale, studentOpts)
      } else if (type === 'quiz') {
        await buildQuizPDFDoc(buildQuizData(classId, students, classes, quizzes))
      } else if (type === 'activities') {
        await buildActivitiesPDFDoc(buildActivitiesData(classId, students, classes, activities))
      }
    } catch (e) {
      toast('PDF failed: ' + e.message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal onClose={onClose} wide sheetOnMobile padded={false}
      header={<ModalHeader flush icon={<FileText size={18} />} title="Export Preview" subtitle={title} />}
      footer={<>
        <button className="btn btn-ghost btn-sm" onClick={handlePDF} disabled={downloading} title="Download PDF">
          <FileText size={13} className="inline-block mr-1" />PDF
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleExcel} disabled={downloading} title="Download Excel">
          {downloading ? 'Exporting…' : <><BarChart2 size={13} className="inline-block mr-1" />Excel</>}
        </button>
      </>}
    >
      {type === 'student' && studentSem && studentSem.groups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--accent-l)', borderRadius: 10, padding: '10px 12px', margin: '12px 14px 10px' }}>
          <span style={{ fontSize: 11.5, color: 'var(--accent)', lineHeight: 1.5, flex: 1, minWidth: 180 }}>
            <strong>On-device check:</strong> {studentSem.narration}
          </span>
          <select
            value={effKey}
            onChange={e => setSemKey(e.target.value)}
            style={{ fontSize: 12.5, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          >
            {!studentSem.groups.some(g => g.isCurrent || g.label === studentSem.currentLabel) && studentSem.currentLabel && (
              <option value={studentSem.currentLabel} disabled>
                {'Current · ' + studentSem.currentLabel + ' (0)'}
              </option>
            )}
            {studentSem.groups.map(g => (
              <option key={g.label} value={g.label} disabled={!g.subjects.length}>
                {(g.isCurrent ? 'Current' : 'Past') + ' · ' + g.label + ' (' + g.subjects.length + ')'}
              </option>
            ))}
            <option value="all">All semesters ({[...new Set(studentSem.groups.flatMap(g => g.subjects))].length})</option>
          </select>
        </div>
      )}

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
