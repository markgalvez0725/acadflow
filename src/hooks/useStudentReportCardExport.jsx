import React, { useState, useCallback } from 'react'
import { useData } from '@/context/DataContext'
import { buildStudentReportCard } from '@/export/reportCard'
import { analyzeStudentSemesters, subjectsForKey, labelForKey } from '@/utils/exportSemesters'
import SemesterExportModal from '@/components/admin/modals/SemesterExportModal'

/**
 * Report-card export with the on-device semester check baked in.
 * Returns [trigger(student), modalElement]. When the student's grades span a
 * single semester it exports straight to PDF; when they span 2+ it opens the
 * SemesterExportModal so the professor picks the term first.
 */
export function useStudentReportCardExport() {
  const { classes, students, semester, eqScale } = useData()
  const [pending, setPending] = useState(null) // { student, analysis }

  const doExport = useCallback((student, key, analysis) => {
    buildStudentReportCard(student, {
      classes, students, eqScale, semester,
      subjectFilter: subjectsForKey(analysis, key),
      semesterLabel: labelForKey(key),
    })
  }, [classes, students, eqScale, semester])

  const trigger = useCallback((student) => {
    const analysis = analyzeStudentSemesters(student, classes, semester)
    if (!analysis.hasMultiple) {
      const only = analysis.groups[0]
      doExport(student, only ? only.label : 'all', analysis)
    } else {
      setPending({ student, analysis })
    }
  }, [classes, semester, doExport])

  const modal = pending ? (
    <SemesterExportModal
      student={pending.student}
      analysis={pending.analysis}
      kind="report card"
      onConfirm={(key) => { doExport(pending.student, key, pending.analysis); setPending(null) }}
      onClose={() => setPending(null)}
    />
  ) : null

  return [trigger, modal]
}
