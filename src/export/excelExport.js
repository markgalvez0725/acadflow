// ── Excel Export Layer ────────────────────────────────────────────────────
// Uses window.XLSX (SheetJS - loaded via CDN <script> tag in index.html).
// All functions accept explicit (students, classes) args - no globals.

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
import { splitStudentName, buildStudentName } from '@/utils/studentName.js'
import { courseShort } from '@/utils/groupChat.js'
import { courseFromShort, COURSES } from '@/constants/courses.js'
import { isClassCurrent, activeSubjects } from '@/utils/active.js'
import { brandingTitleRows } from '@/export/reportTemplate.js'

// ── Helpers ───────────────────────────────────────────────────────────────

export function getClassStudents(classId, students) {
  return students.filter(s =>
    (s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])).includes(classId)
  )
}

/** Column index (1-based) → Excel letter(s). */
export function CL(c) {
  let s = ''
  while (c > 0) {
    const r = (c - 1) % 26
    s = String.fromCharCode(65 + r) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}

// EQUIV_COMBINE_TABLE: midterm equiv × finals equiv → final grade string
const EQUIV_COMBINE_TABLE = {
  '1.00':{'1.00':'1.00','1.25':'1.25','1.50':'1.25','1.75':'1.50','2.00':'1.75','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '1.25':{'1.00':'1.00','1.25':'1.25','1.50':'1.50','1.75':'1.50','2.00':'1.75','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '1.50':{'1.00':'1.25','1.25':'1.25','1.50':'1.50','1.75':'1.75','2.00':'1.75','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '1.75':{'1.00':'1.25','1.25':'1.50','1.50':'1.50','1.75':'1.50','2.00':'2.00','2.25':'2.00','2.50':'2.25','2.75':'2.50','3.00':'2.50','4.00':'3.00','5.00':'5.00'},
  '2.00':{'1.00':'1.25','1.25':'1.50','1.50':'1.75','1.75':'1.75','2.00':'2.00','2.25':'2.25','2.50':'2.25','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'4.00'},
  '2.25':{'1.00':'1.50','1.25':'1.50','1.50':'1.75','1.75':'2.00','2.00':'2.00','2.25':'2.25','2.50':'2.50','2.75':'2.50','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '2.50':{'1.00':'1.50','1.25':'1.75','1.50':'1.75','1.75':'2.00','2.00':'2.25','2.25':'2.25','2.50':'2.50','2.75':'2.75','3.00':'2.75','4.00':'3.00','5.00':'5.00'},
  '2.75':{'1.00':'1.50','1.25':'1.75','1.50':'2.00','1.75':'2.00','2.00':'2.25','2.25':'2.50','2.50':'2.50','2.75':'2.75','3.00':'3.00','4.00':'5.00','5.00':'5.00'},
  '3.00':{'1.00':'1.75','1.25':'1.75','1.50':'2.00','1.75':'2.25','2.00':'2.25','2.25':'2.50','2.50':'2.75','2.75':'2.75','3.00':'3.00','4.00':'5.00','5.00':'5.00'},
  '4.00':{'1.00':'2.00','1.25':'2.25','1.50':'2.25','1.75':'2.50','2.00':'2.75','2.25':'2.75','2.50':'3.00','2.75':'3.00','3.00':'3.00','4.00':'5.00','5.00':'5.00'},
  '5.00':{'1.00':'2.25','1.25':'2.50','1.50':'2.75','1.75':'2.75','2.00':'3.00','2.25':'3.00','2.50':'3.00','2.75':'5.00','3.00':'5.00','4.00':'5.00','5.00':'5.00'},
}

/**
 * Nested Excel IF formula: (midtermEquivCell, finalsEquivCell) → combined final grade.
 * Uses a fully-inlined version of EQUIV_COMBINE_TABLE.
 */
export function fgIF(mtRef, ftRef) {
  // Build one level of nesting per midterm row
  function ftLookup(row) {
    const keys = ['1.00','1.25','1.50','1.75','2.00','2.25','2.50','2.75','3.00','4.00','5.00']
    let expr = `"${row['5.00']}"`
    for (let i = keys.length - 2; i >= 0; i--) {
      const k = keys[i]
      expr = `IF(${ftRef}="${k}","${row[k]}",${expr})`
    }
    return expr
  }

  const mtKeys = ['1.00','1.25','1.50','1.75','2.00','2.25','2.50','2.75','3.00','4.00','5.00']
  let expr = ftLookup(EQUIV_COMBINE_TABLE['5.00'])
  for (let i = mtKeys.length - 2; i >= 0; i--) {
    const k = mtKeys[i]
    expr = `IF(${mtRef}="${k}",${ftLookup(EQUIV_COMBINE_TABLE[k])},${expr})`
  }
  return `IF(${mtRef}="-","-",IF(${ftRef}="-","-",${expr}))`
}

/**
 * Nested Excel IF formula: final-grade equiv cell → Passed/Failed/Conditional/Pending.
 */
export function remarkIF(fgRef) {
  return (
    `IF(${fgRef}="-","Pending",` +
    `IF(${fgRef}="5.00","Failed",` +
    `IF(${fgRef}="4.00","Conditional","Passed")))`
  )
}

// ── exportStudentRosterExcel ──────────────────────────────────────────────
/**
 * Exports a 2-sheet student roster workbook:
 * Sheet 1: Students (10 title rows + header row + data rows)
 * Sheet 2: Password Guide
 *
 * @param {{ students: object[], classes: object[] }} opts
 */
export async function exportStudentRosterExcel({ students, classes, semester }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  const ctx = rosterData(students, classes, semester)

  // ExcelJS gives real per-cell dropdowns (Course + Class Subject); SheetJS can't.
  // Try ExcelJS first and fall back to a plain SheetJS export on ANY failure, so
  // the export always works even if the library can't load.
  try {
    const ExcelJS = await ensureExcelJS()
    if (!ExcelJS) throw new Error('ExcelJS unavailable')
    await rosterExcelJS(ExcelJS, ctx)
  } catch (e) {
    rosterSheetJS(XLSX, ctx)
  }
}

// Shared roster data for both the ExcelJS and SheetJS writers.
function rosterData(students, classes, semester) {
  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const sorted = sortByLastName(students)
  const headers = ['#', 'Student No.', 'Surname', 'First Name', 'M.I.', 'Course', 'Year Level', 'Class Subject', 'Section']
  const dataRows = sorted.map((s, idx) => {
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const primary = classes.find(c => c.id === s.classId) || classes.find(c => enrolledIds.includes(c.id))
    // Only CURRENT-semester (non-archived) subjects - past/archived classes drop off.
    const subjects = activeSubjects(s, classes, semester).join(', ')
    const n = splitStudentName(s.name)
    return [idx + 1, s.id, n.last, n.first, n.middle, courseShort(s.course) || '', s.year || '', subjects, primary?.section || '']
  })
  // Dropdown sources - NOT the column data. Subjects = the distinct subjects across
  // the app's CURRENT-semester (non-archived) classes only. Courses = the canonical
  // short codes (BSEMC / BSIT / BSIS / BSCS) from the official course list.
  const currentClasses = (classes || []).filter(c => isClassCurrent(c, semester))
  const allSubjects = [...new Set(currentClasses.flatMap(c => c.subjects || []))].filter(Boolean).sort()
  const courseShorts = [...new Set(COURSES.map(c => courseShort(c)).filter(Boolean))]
  const yearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year']
  const widths = [4, 14, 18, 18, 6, 20, 12, 40, 12]
  const fileName = `StudentRoster_${new Date().toISOString().slice(0, 10)}.xlsx`
  const pwGuide = [
    ['AcadFlow - Password Guide'], [''],
    ['Default student password: Welcome@2026'],
    ['Students must change their password on first login.'], [''],
    ['Requirements:'], ['  • At least 8 characters'],
    ['  • At least one uppercase letter'], ['  • At least one number'],
  ]
  return { exportDate, total: sorted.length, headers, dataRows, allSubjects, courseShorts, yearLevels, widths, fileName, pwGuide }
}

// ExcelJS writer - real dropdowns on Course (col F), Year Level (col G) +
// Class Subject (col H), referencing a "Lists" sheet (no inline-list length limit).
async function rosterExcelJS(ExcelJS, ctx) {
  const { exportDate, total, headers, dataRows, allSubjects, courseShorts, yearLevels, widths, fileName, pwGuide } = ctx
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 11 }] })

  ws.addRow(['AcadFlow - Student Roster'])
  ws.addRow([`Exported: ${exportDate}`])
  ws.addRow([])
  ws.addRow(['Total Students:', total])
  for (let i = 0; i < 6; i++) ws.addRow([]) // rows 5-10
  ws.addRow(headers)                          // row 11
  dataRows.forEach(r => ws.addRow(r))         // rows 12+
  for (let i = 0; i < 5; i++) ws.addRow([])   // 5 trailing blanks
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  const lastDataRow = 11 + dataRows.length
  ws.autoFilter = { from: { row: 11, column: 1 }, to: { row: lastDataRow, column: headers.length } }

  // Dropdowns over the data rows + trailing blanks (so new entries get them too).
  // All reference the VISIBLE "Lists" sheet (a hidden source stops Excel showing
  // the dropdown): col A = the app's existing class subjects, col B = the four
  // course codes, col C = the four year levels.
  const dvLast = lastDataRow + 5
  const subjRef   = allSubjects.length  ? `Lists!$A$2:$A$${1 + allSubjects.length}`  : null
  const courseRef = courseShorts.length ? `Lists!$B$2:$B$${1 + courseShorts.length}` : null
  const yearRef   = yearLevels.length   ? `Lists!$C$2:$C$${1 + yearLevels.length}`   : null
  for (let r = 12; r <= dvLast; r++) {
    if (courseRef) ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [courseRef] }
    if (yearRef)   ws.getCell(r, 7).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [yearRef] }
    if (subjRef)   ws.getCell(r, 8).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [subjRef] }
  }

  const wsPw = wb.addWorksheet('Password Guide')
  pwGuide.forEach(r => wsPw.addRow(r))
  wsPw.getColumn(1).width = 60

  // Visible source sheet feeding the dropdowns (referenced above by name).
  const wsList = wb.addWorksheet('Lists')
  wsList.addRow(['Class Subjects', 'Courses', 'Year Levels'])
  const maxLen = Math.max(allSubjects.length, courseShorts.length, yearLevels.length)
  for (let i = 0; i < maxLen; i++) wsList.addRow([allSubjects[i] || '', courseShorts[i] || '', yearLevels[i] || ''])
  wsList.getColumn(1).width = 44
  wsList.getColumn(2).width = 12
  wsList.getColumn(3).width = 12

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName)
}

// SheetJS writer (fallback) - same layout + AutoFilter, no per-cell dropdowns.
function rosterSheetJS(XLSX, ctx) {
  const { exportDate, total, headers, dataRows, widths, fileName, pwGuide } = ctx
  const titleRows = [
    ['AcadFlow - Student Roster'], [`Exported: ${exportDate}`], [''],
    ['Total Students:', total], [''], [''], [''], [''], [''], [''],
  ]
  const blankRows = Array.from({ length: 5 }, () => Array(headers.length).fill(''))
  const ws = XLSX.utils.aoa_to_sheet([...titleRows, headers, ...dataRows, ...blankRows])
  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 10 })
  ws['!cols'] = widths.map(w => ({ wch: w }))
  ws['!freeze'] = { xSplit: 0, ySplit: 11 }
  ws['!autofilter'] = { ref: `A11:I${11 + dataRows.length}` }

  const wsPw = XLSX.utils.aoa_to_sheet(pwGuide)
  wsPw['!cols'] = [{ wch: 60 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws,   'Students')
  XLSX.utils.book_append_sheet(wb, wsPw, 'Password Guide')
  XLSX.writeFile(wb, fileName)
}

// Download a Blob as a file.
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

// Load ExcelJS on demand from the CDN (only when exporting a roster). Resolves to
// the global, or null if it can't load - the caller falls back to SheetJS.
let _exceljsLoading = null
export function ensureExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS)
  if (_exceljsLoading) return _exceljsLoading
  _exceljsLoading = new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
    s.onload = () => resolve(window.ExcelJS || null)
    s.onerror = () => resolve(null)
    document.head.appendChild(s)
  })
  return _exceljsLoading
}

// ── Student import template / parser (simple, fill-in Excel) ───────────────
// Column order shared by the blank template and the parser so a professor can
// export the template, fill rows in, and re-import the same file.
export const STUDENT_IMPORT_COLUMNS = ['Student No.', 'Surname', 'First Name', 'M.I.', 'Course', 'Year Level', 'Section']

// Normalized header → field. Mirrors the CSV importer's aliases so either path
// resolves the same columns. `name` (Full Name) is kept for backward-compat with
// older files; separate Surname/First Name/M.I. columns take precedence.
const STUDENT_COL_ALIASES = {
  id:        ['studentno', 'sno', 'id', 'studentnumber', 'stuno'],
  surname:   ['surname', 'lastname', 'familyname'],
  firstname: ['firstname', 'givenname', 'fname'],
  mi:        ['mi', 'middleinitial', 'middlename', 'middle'],
  name:      ['fullname', 'name', 'studentname'],
  course:    ['course', 'courseprogram', 'program', 'coursename'],
  year:      ['yearlevel', 'year', 'yearlvl'],
  section:   ['section', 'sec'],
  dob:    ['dateofbirth', 'dob', 'birthdate', 'birthday'],
  mobile: ['mobile', 'mobilenumber', 'phone', 'contact'],
}

/**
 * Downloads a clean, single-purpose .xlsx the professor fills row by row.
 * Mirrors the roster export: separated name columns + per-cell Course and Year
 * Level dropdowns (via ExcelJS, like the roster export; SheetJS fallback has no
 * dropdowns). Sheet 1 "Students": header on row 1, an example row, blank rows.
 * Sheet 2 "Classes": reference list of class names + sections (no required input).
 */
export async function exportStudentImportTemplate({ classes = [] } = {}) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  // Course shown as a short code (mirrors the export); the parser expands it back.
  const example = ['2024-10001', 'Dela Cruz', 'Juan', 'S', 'BSCS', '1st Year', '2A']
  const widths  = [14, 18, 18, 6, 14, 12, 10]
  const courseShorts = [...new Set(COURSES.map(c => courseShort(c)).filter(Boolean))]
  const yearLevels   = ['1st Year', '2nd Year', '3rd Year', '4th Year']

  const active = (classes || []).filter(c => !c.archived)
  const refRows = active.length
    ? active.map(c => [c.name || '', c.section || '', (c.subjects || []).join(', ')])
    : [['(no active classes yet)', '', '']]
  const notes = [
    'Notes:',
    '• Required: "Student No." and "Surname" + "First Name" (M.I. optional). Course is recommended.',
    '• Course & Year Level have dropdowns - pick from the list. Course + Year + Section decide which classes a student can be enrolled in.',
    '• Default password for imported students: Welcome@2026 (changed on first login).',
    '• Keep or delete the example row - rows with errors are skipped on import.',
  ]
  const ctx = { columns: STUDENT_IMPORT_COLUMNS, example, widths, courseShorts, yearLevels, refRows, notes }

  // ExcelJS gives real Course + Year Level dropdowns; fall back to SheetJS on ANY failure.
  try {
    const ExcelJS = await ensureExcelJS()
    if (!ExcelJS) throw new Error('ExcelJS unavailable')
    await importTemplateExcelJS(ExcelJS, ctx)
  } catch (e) {
    importTemplateSheetJS(XLSX, ctx)
  }
}

// ExcelJS template writer - Course (col E) + Year Level (col F) dropdowns sourced
// from a visible "Lists" sheet (same approach as the roster export).
async function importTemplateExcelJS(ExcelJS, ctx) {
  const { columns, example, widths, courseShorts, yearLevels, refRows, notes } = ctx
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.addRow(columns)                          // row 1
  ws.addRow(example)                          // row 2
  for (let i = 0; i < 30; i++) ws.addRow([])  // rows 3-32 (ready to type)
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  // Dropdowns over the example + blank rows. Course = col 5, Year Level = col 6.
  const courseRef = courseShorts.length ? `Lists!$A$2:$A$${1 + courseShorts.length}` : null
  const yearRef   = yearLevels.length   ? `Lists!$B$2:$B$${1 + yearLevels.length}`   : null
  for (let r = 2; r <= 32; r++) {
    if (courseRef) ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [courseRef] }
    if (yearRef)   ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [yearRef] }
  }

  // Reference sheet (active classes + notes).
  const wsRef = wb.addWorksheet('Classes')
  wsRef.addRow(['Reference - your active classes (informational only)'])
  wsRef.addRow([])
  wsRef.addRow(['Class Name', 'Section', 'Subjects'])
  refRows.forEach(r => wsRef.addRow(r))
  wsRef.addRow([])
  notes.forEach(n => wsRef.addRow([n]))
  wsRef.getColumn(1).width = 24
  wsRef.getColumn(2).width = 12
  wsRef.getColumn(3).width = 50

  // Visible source sheet feeding the dropdowns.
  const wsList = wb.addWorksheet('Lists')
  wsList.addRow(['Courses', 'Year Levels'])
  const maxLen = Math.max(courseShorts.length, yearLevels.length)
  for (let i = 0; i < maxLen; i++) wsList.addRow([courseShorts[i] || '', yearLevels[i] || ''])
  wsList.getColumn(1).width = 12
  wsList.getColumn(2).width = 12

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `StudentImportTemplate_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// SheetJS template writer (fallback) - same layout + columns, no per-cell dropdowns.
function importTemplateSheetJS(XLSX, ctx) {
  const { columns, example, widths, refRows, notes } = ctx
  const blanks = Array.from({ length: 30 }, () => Array(columns.length).fill(''))
  const ws = XLSX.utils.aoa_to_sheet([columns, example, ...blanks])
  ws['!cols'] = widths.map(w => ({ wch: w }))
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Students')

  const wsRef = XLSX.utils.aoa_to_sheet([
    ['Reference - your active classes (informational only)'],
    [''],
    ['Class Name', 'Section', 'Subjects'],
    ...refRows,
    [''],
    ...notes.map(n => [n]),
  ])
  wsRef['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 50 }]
  XLSX.utils.book_append_sheet(wb, wsRef, 'Classes')

  XLSX.writeFile(wb, `StudentImportTemplate_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/**
 * Parses a student-import workbook into row objects { id, name, course, year,
 * section, dob, mobile }. Locates the header row dynamically, so both the blank
 * template (header on row 1) and an exported roster (header lower down) work.
 * Returns [] when no recognizable header/data is found.
 */
export function parseStudentImportExcel(workbook) {
  const XLSX = window.XLSX
  if (!XLSX) throw new Error('SheetJS not loaded')

  const sheetName = workbook.SheetNames.includes('Students') ? 'Students' : workbook.SheetNames[0]
  const ws = workbook.Sheets[sheetName]
  if (!ws) return []
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (!aoa.length) return []

  const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

  // Find the header row: the first row containing a recognizable student-no header.
  let headerIdx = -1
  for (let i = 0; i < aoa.length; i++) {
    const cells = aoa[i].map(norm)
    if (cells.some(c => STUDENT_COL_ALIASES.id.includes(c))) { headerIdx = i; break }
  }
  if (headerIdx === -1) return []

  const headers = aoa[headerIdx].map(norm)
  const colOf = key => STUDENT_COL_ALIASES[key].reduce((found, alias) => found >= 0 ? found : headers.indexOf(alias), -1)
  const idxs = Object.fromEntries(Object.keys(STUDENT_COL_ALIASES).map(k => [k, colOf(k)]))

  return aoa.slice(headerIdx + 1).map(row => {
    const get = k => idxs[k] >= 0 ? String(row[idxs[k]] ?? '').trim() : ''
    // Separate Surname / First Name / M.I. columns win; fall back to Full Name.
    const composed = buildStudentName(get('surname'), get('firstname'), get('mi'))
    return {
      id:     get('id'),
      name:   composed || get('name'),
      course: courseFromShort(get('course')), // expand short codes (BSEMC → full)
      year:   get('year'),
      section:get('section'),
      dob:    get('dob'),
      mobile: get('mobile'),
    }
  }).filter(r => Object.values(r).some(v => v))
}

// ── buildGradesData ───────────────────────────────────────────────────────
/**
 * Builds grades summary data object for preview and export.
 * @param {string} classId
 * @param {object[]} students
 * @param {object[]} classes
 * @param {object[]} [eqScale]
 * @returns {{ cls, headers, rows, summaryRow, subs }}
 */
export function buildGradesData(classId, students, classes, eqScale = DEFAULT_EQ_SCALE) {
  const cls    = classes.find(c => c.id === classId)
  if (!cls) return null
  const subs   = cls.subjects || []
  const roster = sortByLastName(getClassStudents(classId, students))

  const headers = ['Student Name', 'Student No.', 'Course', 'Year',
    ...subs,
    'Average (%)', 'GWA (1.0-5.0)', 'Status',
  ]

  const rows = roster.map(s => {
    const subGrades = subs.map(sub => {
      const info = gradeInfoForStudent(s, sub, eqScale)
      return info.eq === '-' ? '-' : info.eq
    })
    const numericEquivs = subGrades
      .map(eq => parseFloat(eq))
      .filter(n => !isNaN(n))
    const avgEq = numericEquivs.length
      ? numericEquivs.reduce((a, b) => a + b, 0) / numericEquivs.length
      : null

    const avgEqStr  = avgEq != null ? avgEq.toFixed(2) : '-'
    const avgInfo   = avgEq != null ? equivInfo(avgEqStr) : { ltr: '-', rem: 'No Grade' }

    return [
      s.name, s.id, courseShort(s.course) || '', s.year || '',
      ...subGrades,
      avgEqStr,
      avgEqStr,
      avgInfo.rem,
    ]
  })

  // Class average row
  const subAvgs = subs.map((sub, si) => {
    const vals = rows.map(r => parseFloat(r[4 + si])).filter(n => !isNaN(n))
    if (!vals.length) return '-'
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)
  })
  const avgEquivs = subAvgs.map(v => parseFloat(v)).filter(n => !isNaN(n))
  const overallAvg = avgEquivs.length
    ? (avgEquivs.reduce((a, b) => a + b, 0) / avgEquivs.length).toFixed(2)
    : '-'

  const summaryRow = ['CLASS AVERAGE', '', '', '', ...subAvgs, overallAvg, overallAvg, '']

  return { cls, headers, rows, summaryRow, subs }
}

// ── buildAttendanceData ───────────────────────────────────────────────────
/**
 * Builds attendance summary data object for preview and export.
 * @param {string} classId
 * @param {object[]} students
 * @param {object[]} classes
 * @returns {{ cls, headers, rows, summaryRow, subs, allDates }}
 */
export function buildAttendanceData(classId, students, classes) {
  const cls    = classes.find(c => c.id === classId)
  if (!cls) return null
  const subs   = cls.subjects || []
  const roster = sortByLastName(getClassStudents(classId, students))

  // Collect all dates
  const dateSet = new Set()
  roster.forEach(s => {
    subs.forEach(sub => {
      const attSet = s.attendance?.[sub]
      const exSet  = s.excuse?.[sub]
      if (attSet instanceof Set) attSet.forEach(d => dateSet.add(d))
      else if (Array.isArray(attSet)) attSet.forEach(d => dateSet.add(d))
      if (exSet  instanceof Set) exSet.forEach(d => dateSet.add(d))
      else if (Array.isArray(exSet))  exSet.forEach(d => dateSet.add(d))
    })
  })
  const allDates = [...dateSet].sort()

  const headers = [
    'Student Name', 'Student No.', 'Course', 'Year',
    ...subs.map(sub => `${sub} (Present)`),
    ...subs.map(sub => `${sub} (%)`),
    'Total Present', 'Overall Rate (%)',
  ]

  const rows = roster.map(s => {
    const presentCounts = subs.map(sub => {
      const attSet = s.attendance?.[sub]
      return attSet instanceof Set ? attSet.size : (Array.isArray(attSet) ? attSet.length : 0)
    })
    const rates = subs.map((sub, si) => {
      const held = getHeldDays(classId, sub, students)
      return held > 0 ? parseFloat(((presentCounts[si] / held) * 100).toFixed(1)) : '-'
    })
    const totalPresent = presentCounts.reduce((a, b) => a + b, 0)
    const overallRate  = getAttRate(s, students, classes)
    return [
      s.name, s.id, courseShort(s.course) || '', s.year || '',
      ...presentCounts,
      ...rates,
      totalPresent,
      overallRate != null ? overallRate : '-',
    ]
  })

  // Summary row
  const subAvgPresent = subs.map((_, si) => {
    const vals = rows.map(r => r[4 + si]).filter(v => typeof v === 'number')
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '-'
  })
  const subAvgRate = subs.map((_, si) => {
    const vals = rows.map(r => r[4 + subs.length + si]).filter(v => typeof v === 'number')
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '-'
  })
  const totalPresentAvg = rows.length
    ? (rows.map(r => r[4 + subs.length * 2]).reduce((a, b) => a + b, 0) / rows.length).toFixed(1)
    : '-'
  const overallRateAvg = (() => {
    const vals = rows.map(r => r[4 + subs.length * 2 + 1]).filter(v => typeof v === 'number')
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '-'
  })()

  const summaryRow = [
    'CLASS AVERAGE', '', '', '',
    ...subAvgPresent,
    ...subAvgRate,
    totalPresentAvg,
    overallRateAvg,
  ]

  return { cls, headers, rows, summaryRow, subs, allDates }
}

// ── buildGradesWorkbook ───────────────────────────────────────────────────
/**
 * Builds grades XLSX workbook from buildGradesData() output.
 * Sheet 1: Grades Summary; per-subject sheets follow.
 * @param {object} data - from buildGradesData()
 * @param {object[]} students
 * @param {object[]} classes
 * @param {object[]} [eqScale]
 * @returns {object} XLSX workbook
 */
export function buildGradesWorkbook(data, students, classes, eqScale = DEFAULT_EQ_SCALE) {
  const XLSX = window.XLSX
  const { cls, headers, rows, summaryRow, subs } = data

  // Title rows (4 rows + blank)
  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const titleRows  = [
    [`GRADE SUMMARY - ${cls.name || cls.id}`],
    [`Section: ${cls.section || ''}  |  S.Y. ${cls.sy || ''}  |  Exported: ${exportDate}`],
    [`Total Students: ${rows.length}`],
    [''],
  ]
  const blankRow = [Array(headers.length).fill('')]
  const aoa = [...titleRows, headers, ...rows, ...blankRow, summaryRow]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 10 },
    ...subs.map(() => ({ wch: 14 })),
    { wch: 12 }, { wch: 14 }, { wch: 12 },
  ]
  ws['!freeze'] = { xSplit: 2, ySplit: 5 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Grades Summary')

  // Per-subject sheets
  subs.forEach(sub => {
    const classStudents = getClassStudents(cls.id, students)
    const roster = sortByLastName(classStudents)
    const subHdr = ['Student Name', 'Student No.', 'Course', 'Year',
      'Midterm (%)', 'Finals (%)', 'Final Grade (%)', 'Equiv', 'Letter', 'Remark',
    ]
    const subRows = roster.map(s => {
      const comp = s.gradeComponents?.[sub] || {}
      const midG = comp.midterm ?? null
      const finG = comp.finals  ?? null
      const info = gradeInfoForStudent(s, sub, eqScale)
      const mtInfo = midG != null ? gradeInfo(midG, eqScale) : { eq: '-' }
      const ftInfo = finG != null ? gradeInfo(finG, eqScale) : { eq: '-' }
      return [
        s.name, s.id, courseShort(s.course) || '', s.year || '',
        midG ?? '-', finG ?? '-',
        (midG != null && finG != null) ? ((midG + finG) / 2).toFixed(2) : '-',
        info.eq, info.ltr, info.rem,
      ]
    })
    const subAoa = [
      [`${sub} - ${cls.name || cls.id}`],
      [],
      subHdr,
      ...subRows,
    ]
    const wsSub = XLSX.utils.aoa_to_sheet(subAoa)
    wsSub['!cols'] = [28, 14, 18, 10, 12, 12, 14, 10, 8, 14].map(w => ({ wch: w }))
    wsSub['!freeze'] = { xSplit: 2, ySplit: 3 }
    const safeName = sub.replace(/[\[\]/*?:\\ ]/g, '_').slice(0, 30)
    XLSX.utils.book_append_sheet(wb, wsSub, safeName || `Sub${subs.indexOf(sub) + 1}`)
  })

  return wb
}

// ── buildAttendanceWorkbook ───────────────────────────────────────────────
/**
 * Builds attendance XLSX workbook from buildAttendanceData() output.
 * @param {object} data - from buildAttendanceData()
 * @param {object[]} students
 * @param {object[]} classes
 * @returns {object} XLSX workbook
 */
export function buildAttendanceWorkbook(data, students, classes) {
  const XLSX = window.XLSX
  const { cls, headers, rows, summaryRow, subs } = data

  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const titleRows  = [
    [`ATTENDANCE SUMMARY - ${cls.name || cls.id}`],
    [`Section: ${cls.section || ''}  |  S.Y. ${cls.sy || ''}  |  Exported: ${exportDate}`],
    [`Total Students: ${rows.length}`],
    [''],
  ]
  const blankRow = [Array(headers.length).fill('')]
  const aoa = [...titleRows, headers, ...rows, ...blankRow, summaryRow]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 10 },
    ...subs.map(() => ({ wch: 14 })),
    ...subs.map(() => ({ wch: 10 })),
    { wch: 13 }, { wch: 14 },
  ]
  ws['!freeze'] = { xSplit: 2, ySplit: 5 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance Summary')

  // Per-subject sheets
  subs.forEach(sub => {
    const roster   = sortByLastName(getClassStudents(cls.id, students))
    const held     = getHeldDays(cls.id, sub, students)

    // Collect all unique dates for this subject
    const dateSet = new Set()
    roster.forEach(s => {
      const attSet = s.attendance?.[sub]
      const exSet  = s.excuse?.[sub]
      if (attSet instanceof Set) attSet.forEach(d => dateSet.add(d))
      else if (Array.isArray(attSet)) attSet.forEach(d => dateSet.add(d))
      if (exSet  instanceof Set) exSet.forEach(d => dateSet.add(d))
      else if (Array.isArray(exSet))  exSet.forEach(d => dateSet.add(d))
    })
    const dates = [...dateSet].sort()

    const subHdr = ['Student Name', 'Student No.', ...dates, 'Total Present', 'Excused', 'Total Sessions', 'Rate (%)']
    const subRows = roster.map(s => {
      const attSet = s.attendance?.[sub]
      const exSet  = s.excuse?.[sub]
      const attArr = attSet instanceof Set ? [...attSet] : (Array.isArray(attSet) ? attSet : [])
      const exArr  = exSet  instanceof Set ? [...exSet]  : (Array.isArray(exSet)  ? exSet  : [])
      const perDate = dates.map(d => {
        if (attArr.includes(d)) return 'P'
        if (exArr.includes(d))  return 'E'
        return 'A'
      })
      const rate = held > 0 ? parseFloat(((attArr.length / held) * 100).toFixed(1)) : '-'
      return [s.name, s.id, ...perDate, attArr.length, exArr.length, held, rate]
    })
    const subAoa = [
      [`${sub} - ${cls.name || cls.id}`],
      [`Sessions held: ${held}`],
      subHdr,
      ...subRows,
    ]
    const wsSub = XLSX.utils.aoa_to_sheet(subAoa)
    wsSub['!cols'] = [{ wch: 28 }, { wch: 14 }, ...dates.map(() => ({ wch: 12 })), { wch: 13 }, { wch: 9 }, { wch: 15 }, { wch: 10 }]
    wsSub['!freeze'] = { xSplit: 2, ySplit: 3 }
    const safeName = sub.replace(/[\[\]/*?:\\ ]/g, '_').slice(0, 30)
    XLSX.utils.book_append_sheet(wb, wsSub, safeName || `Sub${subs.indexOf(sub) + 1}`)
  })

  return wb
}

// ── buildStudentWorkbook ──────────────────────────────────────────────────
/**
 * Builds a per-student XLSX workbook with Grades and Attendance sheets.
 * @param {object} s - student record
 * @param {object[]} classes
 * @param {object[]} students - full roster (for held-days calc)
 * @param {object[]} [eqScale]
 * @returns {object} XLSX workbook
 */
export function buildStudentWorkbook(s, classes, students, eqScale = DEFAULT_EQ_SCALE, opts = {}) {
  const XLSX = window.XLSX
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allSubs = (opts.subjectFilter && opts.subjectFilter.length)
    ? opts.subjectFilter
    : [...new Set(enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || []))]
  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const gwa = getGWA(s, classes)

  // ── Grades sheet ──────────────────────────────────────────────────────
  const gradeRows = [
    [`STUDENT GRADE REPORT - ${s.name}`],
    [`Student No.: ${s.id}  |  Course: ${courseShort(s.course) || '-'}  |  Year: ${s.year || '-'}`],
    [`${opts.semesterLabel ? 'Term: ' + opts.semesterLabel + '  |  ' : ''}Exported: ${exportDate}  |  GWA: ${gwa != null ? gwa.toFixed(2) : '-'}`],
    [],
    ['Subject', 'Midterm (%)', 'Finals (%)', 'Midterm Equiv', 'Finals Equiv', 'Final Equiv', 'Letter', 'Remark', 'Uploaded'],
  ]

  allSubs.forEach(sub => {
    const comp    = s.gradeComponents?.[sub] || {}
    const midG    = comp.midterm ?? null
    const finG    = comp.finals  ?? null
    const info    = gradeInfoForStudent(s, sub, eqScale)
    const mtInfo  = midG != null ? gradeInfo(midG, eqScale) : { eq: '-' }
    const ftInfo  = finG != null ? gradeInfo(finG, eqScale) : { eq: '-' }
    const ts      = s.gradeUploadedAt?.[sub]
    const uploaded = ts ? new Date(ts).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '-'

    const displayEq  = info.eq  !== '-' ? info.eq  : (midG != null ? mtInfo.eq : '-')
    const displayLtr = info.ltr !== '-' ? info.ltr : (midG != null ? mtInfo.ltr : '-')
    const displayRem = info.rem !== 'Pending' ? info.rem : (midG != null ? 'Midterm Only' : 'Pending')

    gradeRows.push([
      sub,
      midG ?? '-', finG ?? '-',
      mtInfo.eq, ftInfo.eq,
      displayEq, displayLtr, displayRem, uploaded,
    ])
  })

  const wsGrades = XLSX.utils.aoa_to_sheet(gradeRows)
  wsGrades['!cols'] = [20, 12, 12, 14, 13, 12, 8, 14, 14].map(w => ({ wch: w }))
  wsGrades['!freeze'] = { xSplit: 1, ySplit: 5 }

  // ── Attendance sheet ──────────────────────────────────────────────────
  const attRate = getAttRate(s, students, classes)
  const attRows = [
    [`ATTENDANCE RECORD - ${s.name}`],
    [`Student No.: ${s.id}  |  Overall Rate: ${attRate != null ? attRate + '%' : '-'}`],
    [`Exported: ${exportDate}`],
    [],
    ['Subject', 'Total Sessions', 'Present', 'Excused', 'Absent', 'Rate (%)'],
  ]

  allSubs.forEach(sub => {
    const classId  = enrolledIds.find(id => classes.find(c => c.id === id)?.subjects?.includes(sub))
    const held     = classId ? getHeldDays(classId, sub, students) : 0
    const attSet   = s.attendance?.[sub]
    const exSet    = s.excuse?.[sub]
    const present  = attSet instanceof Set ? attSet.size : (Array.isArray(attSet) ? attSet.length : 0)
    const excused  = exSet  instanceof Set ? exSet.size  : (Array.isArray(exSet)  ? exSet.length  : 0)
    const absent   = Math.max(0, held - present - excused)
    const rate     = held > 0 ? parseFloat(((present / held) * 100).toFixed(1)) : '-'
    attRows.push([sub, held, present, excused, absent, rate])
  })

  const wsAtt = XLSX.utils.aoa_to_sheet(attRows)
  wsAtt['!cols'] = [20, 15, 10, 10, 10, 10].map(w => ({ wch: w }))
  wsAtt['!freeze'] = { xSplit: 1, ySplit: 5 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsGrades, 'Grades')
  XLSX.utils.book_append_sheet(wb, wsAtt,    'Attendance')
  return wb
}

// ── exportMasterGradingReport ─────────────────────────────────────────────
/**
 * Exports a comprehensive master grading workbook covering all active classes.
 * Structure:
 *   Sheet 1        - Summary: every student with GWA, attendance, overall status
 *   Per class      - One overview sheet per class (all subjects, equiv only)
 *   Per class+sub  - One detail sheet per class × subject with full computation:
 *                    Acts Avg | Qz Avg | Att % | Class Standing |
 *                    Midterm Exam | Midterm Term (%) | Finals Exam | Finals Term (%) |
 *                    Final Grade (%) | Equiv | Letter | Remark
 *   Last           - Grade Scale reference
 *
 * @param {{ students: object[], classes: object[], eqScale?: object[] }} opts
 */
export function exportMasterGradingReport({ students, classes, eqScale = DEFAULT_EQ_SCALE }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  const exportDate    = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const activeClasses = classes.filter(c => !c.archived)
  const wb            = XLSX.utils.book_new()

  // ── Sheet 1: Summary (all students across all active classes) ──────────
  const sortedStudents = sortByLastName(students)

  const sumTitleRows = [
    ['AcadFlow - Master Grading Report'],
    [`Exported: ${exportDate}`],
    [`Active Classes: ${activeClasses.length}  |  Total Students: ${students.length}`],
    [''],
    [''],
  ]
  const sumHeaders = [
    '#', 'Student No.', 'Full Name', 'Course', 'Year Level',
    'Class', 'Section', 'No. of Subjects',
    'Passed', 'Failed', 'Conditional', 'Pending',
    'GWA (Equiv)', 'Avg Attendance %', 'Overall Status',
  ]
  const sumRows = sortedStudents.map((s, idx) => {
    const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
    const allSubs     = [...new Set(
      enrolledIds.flatMap(cid => classes.find(c => c.id === cid)?.subjects || [])
    )]
    let passed = 0, failed = 0, conditional = 0, pending = 0
    allSubs.forEach(sub => {
      const rem = gradeInfoForStudent(s, sub, eqScale).rem
      if (rem === 'Passed')           passed++
      else if (rem === 'Failed')      failed++
      else if (rem === 'Conditional') conditional++
      else                            pending++
    })
    const gwaVal     = getGWA(s, classes)
    const gwaEquiv   = gwaVal != null ? gradeInfo(gwaVal, eqScale).eq : '-'
    const attRate    = getAttRate(s, students, classes)
    const attRateStr = attRate != null ? parseFloat(attRate.toFixed(1)) : '-'
    const overallStatus =
      allSubs.length === 0 ? '-'
      : pending > 0        ? 'Incomplete'
      : failed > 0         ? 'Failed'
      : conditional > 0    ? 'Conditional'
                           : 'Passed'
    const primaryCls = classes.find(c => enrolledIds.includes(c.id))
    return [
      idx + 1, s.id, s.name, courseShort(s.course) || '', s.year || '',
      primaryCls?.name || '', primaryCls?.section || '',
      allSubs.length, passed, failed, conditional, pending,
      gwaEquiv, attRateStr, overallStatus,
    ]
  })
  const totalPassed      = sumRows.filter(r => r[14] === 'Passed').length
  const totalFailed      = sumRows.filter(r => r[14] === 'Failed').length
  const totalConditional = sumRows.filter(r => r[14] === 'Conditional').length
  const totalIncomplete  = sumRows.filter(r => r[14] === 'Incomplete').length

  const wsSum = XLSX.utils.aoa_to_sheet([
    ...sumTitleRows, sumHeaders, ...sumRows,
    Array(sumHeaders.length).fill(''),
    ['', 'TOTALS', '', '', '', '', '', '',
      totalPassed, totalFailed, totalConditional, totalIncomplete, '', '', ''],
  ])
  wsSum['!cols']   = [4,14,28,16,12,24,14,14,9,9,12,9,13,16,14].map(w => ({ wch: w }))
  wsSum['!freeze'] = { xSplit: 0, ySplit: 6 }
  XLSX.utils.book_append_sheet(wb, wsSum, 'Summary')

  // ── Per-class overview + per-class-subject detail sheets ───────────────
  // Track used sheet names to avoid duplicates
  const usedNames = new Set(['Summary'])

  function safeSheetName(raw, fallback) {
    let name = raw.replace(/[*?:/\\[\]]/g, '').slice(0, 31).trim() || fallback.slice(0, 31)
    if (usedNames.has(name)) {
      // Append a suffix to deduplicate
      let n = 2
      while (usedNames.has(`${name.slice(0, 28)}(${n})`)) n++
      name = `${name.slice(0, 28)}(${n})`
    }
    usedNames.add(name)
    return name
  }

  activeClasses.forEach(cls => {
    const subs   = cls.subjects || []
    if (!subs.length) return

    const roster = sortByLastName(
      students.filter(s =>
        (s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])).includes(cls.id)
      )
    )
    if (!roster.length) return

    const clsLabel = `${cls.name}${cls.section ? ` ${cls.section}` : ''}`

    // ── Per-class overview sheet (all subjects, equiv summary) ────────────
    const ovTitleRows = [
      ['AcadFlow - Class Grade Overview'],
      [`Class: ${cls.name}  |  Section: ${cls.section || '-'}  |  S.Y. ${cls.sy || '-'}`],
      [`Subjects: ${subs.join(', ')}`],
      [`Students: ${roster.length}  |  Exported: ${exportDate}`],
      [''],
    ]
    const ovHeaders = [
      '#', 'Student No.', 'Full Name', 'Course', 'Year Level',
      ...subs.flatMap(sub => [`${sub} (Equiv)`, `${sub} Remark`]),
      'GWA (Equiv)', 'Avg Att %', 'Overall Status',
    ]
    const ovRows = roster.map((s, idx) => {
      const row = [idx + 1, s.id, s.name, courseShort(s.course) || '', s.year || '']
      subs.forEach(sub => {
        const { eq, rem } = gradeInfoForStudent(s, sub, eqScale)
        row.push(eq, rem)
      })
      const gwaVal   = getGWA(s, classes)
      const gwaEquiv = gwaVal != null ? gradeInfo(gwaVal, eqScale).eq : '-'
      const attRate  = getAttRate(s, students, classes)
      const attStr   = attRate != null ? parseFloat(attRate.toFixed(1)) : '-'
      let passed = 0, failed = 0, conditional = 0, pending = 0
      subs.forEach(sub => {
        const rem = gradeInfoForStudent(s, sub, eqScale).rem
        if (rem === 'Passed')           passed++
        else if (rem === 'Failed')      failed++
        else if (rem === 'Conditional') conditional++
        else                            pending++
      })
      const overallStatus =
        pending > 0       ? 'Incomplete'
        : failed > 0      ? 'Failed'
        : conditional > 0 ? 'Conditional'
                          : passed > 0 ? 'Passed' : '-'
      row.push(gwaEquiv, attStr, overallStatus)
      return row
    })
    const wsOv = XLSX.utils.aoa_to_sheet([...ovTitleRows, ovHeaders, ...ovRows])
    wsOv['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 10 },
      ...subs.flatMap(() => [{ wch: 14 }, { wch: 14 }]),
      { wch: 12 }, { wch: 12 }, { wch: 14 },
    ]
    wsOv['!freeze'] = { xSplit: 3, ySplit: 6 }
    XLSX.utils.book_append_sheet(wb, wsOv, safeSheetName(clsLabel, cls.id))

    // ── Per-subject detail sheets (one per class × subject) ───────────────
    subs.forEach(sub => {
      const subTitleRows = [
        ['AcadFlow - Grading Computation Detail'],
        [`Class: ${cls.name}  |  Section: ${cls.section || '-'}  |  S.Y. ${cls.sy || '-'}`],
        [`Subject: ${sub}`],
        [`Students: ${roster.length}  |  Exported: ${exportDate}`],
        [''],
      ]
      const subHeaders = [
        '#', 'Student No.', 'Full Name', 'Course', 'Year Level',
        'Acts Avg', 'Qz Avg', 'Attendance %', 'Class Standing',
        'Midterm Exam', 'Midterm Term (%)',
        'Finals Exam',  'Finals Term (%)',
        'Final Grade (%)', 'Equiv', 'Letter', 'Remark',
      ]

      const subRows = roster.map((s, idx) => {
        const comp    = s.gradeComponents?.[sub] || {}
        const attSet  = s.attendance?.[sub]
        const held    = getHeldDays(cls.id, sub, students)
        const present = attSet instanceof Set ? attSet.size : (Array.isArray(attSet) ? attSet.length : 0)
        const attRate = held > 0 ? parseFloat(((present / held) * 100).toFixed(1)) : null
        const cs      = comp.midtermCS != null ? comp.midtermCS : comp.finalsCS ?? null
        const { eq, ltr, rem } = gradeInfoForStudent(s, sub, eqScale)
        return [
          idx + 1, s.id, s.name, courseShort(s.course) || '', s.year || '',
          comp.activities  != null ? comp.activities  : '-',
          comp.quizzes     != null ? comp.quizzes     : '-',
          attRate          != null ? attRate           : '-',
          cs               != null ? cs               : '-',
          comp.midtermExam != null ? comp.midtermExam : '-',
          comp.midterm     != null ? comp.midterm     : '-',
          comp.finalsExam  != null ? comp.finalsExam  : '-',
          comp.finals      != null ? comp.finals      : '-',
          s.grades?.[sub]  != null ? s.grades[sub]   : '-',
          eq, ltr, rem,
        ]
      })

      // Class average row for numeric columns
      const numColOffsets = [5, 6, 7, 8, 9, 10, 11, 12, 13]
      const avgRow = ['', 'CLASS AVERAGE', '', '', '']
      subHeaders.slice(5).forEach((_, i) => {
        const offset = 5 + i
        if (numColOffsets.includes(offset)) {
          const vals = subRows.map(r => {
            const v = r[offset]
            return typeof v === 'number' ? v : parseFloat(v)
          }).filter(n => !isNaN(n))
          avgRow.push(
            vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : '-'
          )
        } else {
          avgRow.push('-')
        }
      })

      const subAoA = [...subTitleRows, subHeaders, ...subRows, Array(subHeaders.length).fill(''), avgRow]
      const wsSub  = XLSX.utils.aoa_to_sheet(subAoA)
      wsSub['!cols'] = [
        { wch: 4 }, { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 10 },
        { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 14 },
        { wch: 13 }, { wch: 16 },
        { wch: 13 }, { wch: 14 },
        { wch: 15 }, { wch: 10 }, { wch: 8 }, { wch: 13 },
      ]
      wsSub['!freeze'] = { xSplit: 3, ySplit: 6 }

      // Sheet name: "ClassName - Subject" truncated to 31 chars
      const rawSubName = `${clsLabel} - ${sub}`
      XLSX.utils.book_append_sheet(wb, wsSub, safeSheetName(rawSubName, `${cls.id}_${sub}`))
    })
  })

  // ── Grade Scale reference sheet ────────────────────────────────────────
  const wsScale = XLSX.utils.aoa_to_sheet([
    ['AcadFlow - Grade Equivalency Scale'],
    [`Reference for: ${exportDate}`],
    [''],
    ['Min Score', 'Max Score', 'Equivalent', 'Letter', 'Remark'],
    ...eqScale.map(t => [t.minScore, t.maxScore, t.eq, t.ltr, t.rem]),
    [''],
    ['Below lowest tier', '', '5.00', 'F', 'Failed'],
    [''],
    ['Computation Formula:'],
    ['  Class Standing   = Average(Activities, Quizzes, Attendance, Attitude)'],
    ['  Midterm Term (%) = Average(Class Standing, Midterm Exam)'],
    ['  Finals Term (%)  = Average(Class Standing, Finals Exam)'],
    ['  Final Grade (%)  = Average(Midterm Term, Finals Term)'],
    ['  Final Grade → Equiv via school combination lookup table'],
  ])
  wsScale['!cols'] = [22, 16, 14, 10, 14].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, wsScale, 'Grade Scale')

  const datePart = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `MasterGradingReport_${datePart}.xlsx`)
}

// ── Preview HTML builders ─────────────────────────────────────────────────

/**
 * Builds an HTML string for grades preview (color-coded by equiv value).
 * ≤2.00 (good) → green; ≤3.00 → amber; else red.
 * @param {object} data - from buildGradesData()
 * @returns {string} HTML
 */
export function buildGradesPreviewHTML(data) {
  const { cls, headers, rows, summaryRow } = data

  function cellColor(val) {
    const n = parseFloat(val)
    if (isNaN(n)) return ''
    if (n <= 2.00) return 'background:#dcfce7;color:#166534'
    if (n <= 3.00) return 'background:#fef9c3;color:#854d0e'
    return 'background:#fee2e2;color:#991b1b'
  }

  const thStyle = 'padding:6px 10px;background:#1e3a8a;color:#fff;font-size:11px;white-space:nowrap;border:1px solid #1e40af'
  const tdStyle = 'padding:5px 8px;font-size:11px;border:1px solid #e5e7eb;white-space:nowrap'

  const ths = headers.map(h => `<th style="${thStyle}">${h}</th>`).join('')
  const trs = rows.map(row => {
    const tds = row.map((cell, i) => {
      const color = i >= 4 ? cellColor(cell) : ''
      return `<td style="${tdStyle}${color ? ';' + color : ''}">${cell ?? ''}</td>`
    }).join('')
    return `<tr>${tds}</tr>`
  }).join('')

  // Summary row
  const sumTds = summaryRow.map((cell, i) => {
    const color = i >= 4 ? cellColor(cell) : ''
    return `<td style="${tdStyle};font-weight:700${color ? ';' + color : ''}">${cell ?? ''}</td>`
  }).join('')

  return `
    <h3 style="font-size:13px;margin:0 0 8px;font-weight:700">${cls.name || cls.id} - Grade Summary</h3>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;min-width:600px;font-family:sans-serif">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}<tr>${sumTds}</tr></tbody>
      </table>
    </div>
  `
}

/**
 * Builds an HTML string for attendance preview (color-coded by rate).
 * ≥90% → green; ≥80% → amber; else red.
 * @param {object} data - from buildAttendanceData()
 * @returns {string} HTML
 */
export function buildAttendancePreviewHTML(data) {
  const { cls, headers, rows, summaryRow, subs } = data

  function rateColor(val) {
    const n = parseFloat(val)
    if (isNaN(n)) return ''
    if (n >= 90) return 'background:#dcfce7;color:#166534'
    if (n >= 80) return 'background:#fef9c3;color:#854d0e'
    return 'background:#fee2e2;color:#991b1b'
  }

  const rateStartCol = 4 + subs.length // rate columns start after present-count columns
  const thStyle = 'padding:6px 10px;background:#14532d;color:#fff;font-size:11px;white-space:nowrap;border:1px solid #166534'
  const tdStyle = 'padding:5px 8px;font-size:11px;border:1px solid #e5e7eb;white-space:nowrap'

  const ths = headers.map(h => `<th style="${thStyle}">${h}</th>`).join('')
  const trs = rows.map(row => {
    const tds = row.map((cell, i) => {
      const color = i >= rateStartCol ? rateColor(cell) : ''
      return `<td style="${tdStyle}${color ? ';' + color : ''}">${cell ?? ''}</td>`
    }).join('')
    return `<tr>${tds}</tr>`
  }).join('')

  const sumTds = summaryRow.map((cell, i) => {
    const color = i >= rateStartCol ? rateColor(cell) : ''
    return `<td style="${tdStyle};font-weight:700${color ? ';' + color : ''}">${cell ?? ''}</td>`
  }).join('')

  return `
    <h3 style="font-size:13px;margin:0 0 8px;font-weight:700">${cls.name || cls.id} - Attendance Summary</h3>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;min-width:600px;font-family:sans-serif">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}<tr>${sumTds}</tr></tbody>
      </table>
    </div>
  `
}

/**
 * Builds an HTML string for student report preview.
 * Includes student info card, grades table, and attendance table.
 * @param {object} s - student record
 * @param {object[]} classes
 * @param {object[]} students - full roster
 * @param {object[]} [eqScale]
 * @returns {string} HTML
 */
export function buildStudentPreviewHTML(s, classes, students, eqScale = DEFAULT_EQ_SCALE, opts = {}) {
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allSubs = (opts.subjectFilter && opts.subjectFilter.length)
    ? opts.subjectFilter
    : [...new Set(enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || []))]
  const gwa     = getGWA(s, classes)
  const attRate = getAttRate(s, students, classes)

  function gradeColor(eq) {
    const n = parseFloat(eq)
    if (isNaN(n)) return ''
    if (n <= 2.00) return 'background:#dcfce7;color:#166534'
    if (n <= 3.00) return 'background:#fef9c3;color:#854d0e'
    return 'background:#fee2e2;color:#991b1b'
  }
  function rateColor(rate) {
    const n = parseFloat(rate)
    if (isNaN(n)) return ''
    if (n >= 90) return 'background:#dcfce7;color:#166534'
    if (n >= 80) return 'background:#fef9c3;color:#854d0e'
    return 'background:#fee2e2;color:#991b1b'
  }

  const thStyle = 'padding:6px 10px;background:#1e3a8a;color:#fff;font-size:11px;border:1px solid #1e40af'
  const tdStyle = 'padding:5px 8px;font-size:11px;border:1px solid #e5e7eb'

  // Grades table
  const gradeHdrs = ['Subject', 'Midterm (%)', 'Finals (%)', 'Equiv', 'Letter', 'Remark']
  const gradeRows = allSubs.map(sub => {
    const comp   = s.gradeComponents?.[sub] || {}
    const midG   = comp.midterm ?? null
    const finG   = comp.finals  ?? null
    const info   = gradeInfoForStudent(s, sub, eqScale)
    const ts     = s.gradeUploadedAt?.[sub]

    const displayEq  = info.eq  !== '-' ? info.eq  : (midG != null ? gradeInfo(midG, eqScale).eq  : '-')
    const displayLtr = info.ltr !== '-' ? info.ltr : (midG != null ? gradeInfo(midG, eqScale).ltr : '-')
    const displayRem = info.rem !== 'Pending' ? info.rem : (midG != null ? 'Midterm Only' : 'Pending')
    const color = gradeColor(displayEq)

    return `<tr>
      <td style="${tdStyle}">${sub}</td>
      <td style="${tdStyle};text-align:center">${midG ?? '-'}</td>
      <td style="${tdStyle};text-align:center">${finG ?? '-'}</td>
      <td style="${tdStyle};text-align:center${color ? ';' + color : ''}">${displayEq}</td>
      <td style="${tdStyle};text-align:center">${displayLtr}</td>
      <td style="${tdStyle}">${displayRem}</td>
    </tr>`
  }).join('')

  // Attendance table
  const attHdrs = ['Subject', 'Sessions', 'Present', 'Excused', 'Absent', 'Rate (%)']
  const attRows = allSubs.map(sub => {
    const classId = enrolledIds.find(id => classes.find(c => c.id === id)?.subjects?.includes(sub))
    const held    = classId ? getHeldDays(classId, sub, students) : 0
    const attSet  = s.attendance?.[sub]
    const exSet   = s.excuse?.[sub]
    const present = attSet instanceof Set ? attSet.size : (Array.isArray(attSet) ? attSet.length : 0)
    const excused = exSet  instanceof Set ? exSet.size  : (Array.isArray(exSet)  ? exSet.length  : 0)
    const absent  = Math.max(0, held - present - excused)
    const rate    = held > 0 ? parseFloat(((present / held) * 100).toFixed(1)) : '-'
    const color   = rateColor(rate)
    return `<tr>
      <td style="${tdStyle}">${sub}</td>
      <td style="${tdStyle};text-align:center">${held}</td>
      <td style="${tdStyle};text-align:center">${present}</td>
      <td style="${tdStyle};text-align:center">${excused}</td>
      <td style="${tdStyle};text-align:center">${absent}</td>
      <td style="${tdStyle};text-align:center${color ? ';' + color : ''}">${rate}${typeof rate === 'number' ? '%' : ''}</td>
    </tr>`
  }).join('')

  return `
    <div style="font-family:sans-serif;max-width:700px">
      <div style="background:#1e3a8a;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0">
        <div style="font-size:16px;font-weight:700">${s.name}</div>
        <div style="font-size:11px;opacity:.8;margin-top:3px">${s.id} · ${courseShort(s.course) || '-'} · ${s.year || '-'}</div>
      </div>
      <div style="display:flex;gap:12px;padding:10px 18px;background:#eff6ff;border:1px solid #bfdbfe">
        <div style="flex:1;text-align:center">
          <div style="font-size:11px;color:#6b7280">GWA</div>
          <div style="font-size:18px;font-weight:700;color:#1e3a8a">${gwa != null ? gwa.toFixed(2) : '-'}</div>
        </div>
        <div style="flex:1;text-align:center">
          <div style="font-size:11px;color:#6b7280">Attendance</div>
          <div style="font-size:18px;font-weight:700;color:#14532d">${attRate != null ? attRate + '%' : '-'}</div>
        </div>
      </div>

      <h4 style="font-size:12px;margin:14px 0 6px;font-weight:700">Grades</h4>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;width:100%">
          <thead><tr>${gradeHdrs.map(h => `<th style="${thStyle}">${h}</th>`).join('')}</tr></thead>
          <tbody>${gradeRows}</tbody>
        </table>
      </div>

      <h4 style="font-size:12px;margin:14px 0 6px;font-weight:700">Attendance</h4>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;width:100%">
          <thead><tr>${attHdrs.map(h => `<th style="${thStyle.replace('#1e3a8a','#14532d').replace('#1e40af','#166534')}">${h}</th>`).join('')}</tr></thead>
          <tbody>${attRows}</tbody>
        </table>
      </div>
    </div>
  `
}

// ── Quiz & Activities reports (per class) ──────────────────────────────────
// A score matrix: one row per student, one column per quiz / activity in the
// class, plus an Average (%). Shares the same { cls, headers, rows, summaryRow }
// shape as grades/attendance so the PDF engine and preview can reuse it.

function scoreMatrixData(cls, roster, items, scoreOf, maxOf, labelOf) {
  const headers = ['Student Name', 'Student No.', 'Course', 'Year',
    ...items.map(labelOf), 'Average (%)']

  const rows = roster.map(s => {
    const cells = items.map(it => {
      const sc = scoreOf(it, s)
      return (typeof sc === 'number') ? sc : '-'
    })
    const pcts = items.map((it, i) => {
      const sc = cells[i], max = maxOf(it)
      return (typeof sc === 'number' && max > 0) ? (sc / max) * 100 : null
    }).filter(n => n != null)
    const avg = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null
    return [s.name, s.id, courseShort(s.course) || '', s.year || '', ...cells, avg != null ? avg.toFixed(1) : '-']
  })

  const itemAvgs = items.map((it, qi) => {
    const vals = rows.map(r => parseFloat(r[4 + qi])).filter(n => !isNaN(n))
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '-'
  })
  const overallPcts = rows.map(r => parseFloat(r[r.length - 1])).filter(n => !isNaN(n))
  const overall = overallPcts.length ? (overallPcts.reduce((a, b) => a + b, 0) / overallPcts.length).toFixed(1) : '-'
  const summaryRow = ['CLASS AVERAGE', '', '', '', ...itemAvgs, overall]

  return { cls, headers, rows, summaryRow, items }
}

const quizTotal = q => (typeof q.totalPoints === 'number' && q.totalPoints > 0) ? q.totalPoints : (q.questions?.length || 0)
const actMax    = a => (typeof a.maxScore === 'number' && a.maxScore > 0) ? a.maxScore : 100

export function buildQuizData(classId, students, classes, quizzes = []) {
  const cls = classes.find(c => c.id === classId)
  if (!cls) return null
  const roster = sortByLastName(getClassStudents(classId, students))
  const items = (quizzes || [])
    .filter(q => (q.classIds || []).includes(classId))
    .sort((a, b) => (a.openAt || 0) - (b.openAt || 0) || String(a.title || '').localeCompare(String(b.title || '')))
  return scoreMatrixData(
    cls, roster, items,
    (q, s) => (q.submissions || {})[s.id]?.score,
    quizTotal,
    q => `${q.title || 'Quiz'} (/${quizTotal(q)})`,
  )
}

export function buildActivitiesData(classId, students, classes, activities = []) {
  const cls = classes.find(c => c.id === classId)
  if (!cls) return null
  const roster = sortByLastName(getClassStudents(classId, students))
  const items = (activities || [])
    .filter(a => a.classId === classId)
    .sort((a, b) => (a.deadline || 0) - (b.deadline || 0) || String(a.title || '').localeCompare(String(b.title || '')))
  return scoreMatrixData(
    cls, roster, items,
    (a, s) => (a.submissions || {})[s.id]?.score,
    actMax,
    a => `${a.title || 'Activity'}${a.subject ? ' [' + a.subject + ']' : ''} (/${actMax(a)})`,
  )
}

// Shared preview HTML for a score matrix (Average (%) column is color-coded).
function scoreMatrixPreviewHTML(data, { title, headBg, headBorder }) {
  const { cls, headers, rows, summaryRow } = data
  if (!rows.length) return `<p style="padding:16px;font-family:sans-serif">No students enrolled in this class.</p>`
  if (headers.length <= 5) return `<p style="padding:16px;font-family:sans-serif">No ${title.toLowerCase()} found for ${cls.name || cls.id} yet.</p>`

  const pctColor = val => {
    const n = parseFloat(val)
    if (isNaN(n)) return ''
    if (n >= 75) return ';background:#dcfce7;color:#166534'
    if (n >= 50) return ';background:#fef9c3;color:#854d0e'
    return ';background:#fee2e2;color:#991b1b'
  }
  const thStyle = `padding:6px 10px;background:${headBg};color:#fff;font-size:11px;white-space:nowrap;border:1px solid ${headBorder}`
  const tdStyle = 'padding:5px 8px;font-size:11px;border:1px solid #e5e7eb;white-space:nowrap'
  const lastIdx = headers.length - 1

  const ths = headers.map(h => `<th style="${thStyle}">${h}</th>`).join('')
  const trs = rows.map(row => {
    const tds = row.map((cell, i) => `<td style="${tdStyle}${i === lastIdx ? pctColor(cell) : ''}">${cell ?? ''}</td>`).join('')
    return `<tr>${tds}</tr>`
  }).join('')
  const sumTds = summaryRow.map((cell, i) => `<td style="${tdStyle};font-weight:700${i === lastIdx ? pctColor(cell) : ''}">${cell ?? ''}</td>`).join('')

  return `
    <h3 style="font-size:13px;margin:0 0 8px;font-weight:700;font-family:sans-serif">${cls.name || cls.id} - ${title}</h3>
    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;min-width:600px;font-family:sans-serif">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}<tr>${sumTds}</tr></tbody>
      </table>
    </div>
  `
}

export function buildQuizPreviewHTML(data) {
  return scoreMatrixPreviewHTML(data, { title: 'Quiz Report', headBg: '#5046e4', headBorder: '#4338ca' })
}
export function buildActivitiesPreviewHTML(data) {
  return scoreMatrixPreviewHTML(data, { title: 'Activities Report', headBg: '#b45309', headBorder: '#92400e' })
}

// Workbooks (SheetJS) with branded title rows prepended.
function scoreMatrixWorkbook(data, sheetName, reportTitle) {
  const XLSX = window.XLSX
  if (!XLSX || !data) return null
  const { cls, headers, rows, summaryRow } = data
  const subtitle = `${cls.name || cls.id}${cls.section ? ' - ' + cls.section : ''}`
  const aoa = [
    ...brandingTitleRows(reportTitle, subtitle),
    [],
    headers,
    ...rows,
    summaryRow,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = headers.map((h, i) => ({ wch: i === 0 ? 26 : Math.max(10, String(h).length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

export function buildQuizWorkbook(data) {
  return scoreMatrixWorkbook(data, 'Quiz Report', 'Quiz Report')
}
export function buildActivitiesWorkbook(data) {
  return scoreMatrixWorkbook(data, 'Activities Report', 'Activities Report')
}
