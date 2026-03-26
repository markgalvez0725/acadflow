// ── Excel Export Layer ────────────────────────────────────────────────────
// Uses window.XLSX (SheetJS — loaded via CDN <script> tag in index.html).
// All functions accept explicit (students, classes) args — no globals.

import {
  gradeInfoForStudent,
  getGWA,
  getAttRate,
  getHeldDays,
  gradeInfo,
  equivInfo,
  combineEquiv,
  DEFAULT_EQ_SCALE,
} from '@/utils/grades.js'
import { sortByLastName } from '@/utils/format.js'

// ── Helpers ───────────────────────────────────────────────────────────────

function getClassStudents(classId, students) {
  return students.filter(s =>
    (s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])).includes(classId)
  )
}

/** Column index (1-based) → Excel letter(s). */
function CL(c) {
  let s = ''
  while (c > 0) {
    const r = (c - 1) % 26
    s = String.fromCharCode(65 + r) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}

/** Cross-sheet cell reference, e.g. xref("Activities", 3, 5) → "Activities!C5" */
function xref(sheet, col, row) {
  return `'${sheet}'!${CL(col)}${row}`
}

/**
 * Nested Excel IF formula: percent → equivalency string.
 * ref is an Excel cell address string, e.g. "C5".
 */
function equivIF(ref) {
  return (
    `IF(${ref}="","—",` +
    `IF(${ref}>99,"1.00",` +
    `IF(${ref}>95,"1.25",` +
    `IF(${ref}>92,"1.50",` +
    `IF(${ref}>89,"1.75",` +
    `IF(${ref}>86,"2.00",` +
    `IF(${ref}>83,"2.25",` +
    `IF(${ref}>80,"2.50",` +
    `IF(${ref}>77,"2.75",` +
    `IF(${ref}>74,"3.00",` +
    `IF(${ref}>=71,"4.00","5.00")))))))))))`
  )
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
function fgIF(mtRef, ftRef) {
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
  return `IF(${mtRef}="—","—",IF(${ftRef}="—","—",${expr}))`
}

/**
 * Nested Excel IF formula: final-grade equiv cell → Passed/Failed/Conditional/Pending.
 */
function remarkIF(fgRef) {
  return (
    `IF(${fgRef}="—","Pending",` +
    `IF(${fgRef}="5.00","Failed",` +
    `IF(${fgRef}="4.00","Conditional","Passed")))`
  )
}

// ── exportGradingSheet ────────────────────────────────────────────────────
/**
 * Exports a 5-tab XLSX grading workbook for one subject.
 * Tabs: Activities | Quizzes | Exams & Attendance | Grading Sheet | Instructions
 * The Grading Sheet tab is protected with password "acadflow".
 *
 * @param {{ classId: string, subject: string, students: object[], classes: object[], eqScale?: object[] }} opts
 */
export function exportGradingSheet({ classId, subject, students, classes, eqScale = DEFAULT_EQ_SCALE }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  const cls = classes.find(c => c.id === classId)
  if (!cls) return
  const roster = sortByLastName(getClassStudents(classId, students))
  const n = roster.length
  const DATA = 4 // first student data row (1-based); rows 1–3 are headers

  // ── Column layout constants ──────────────────────────────────────────────
  // Activities sheet
  const A_NAME = 1, A_SNUM = 2
  const actCount  = 5
  const A_MT = Array.from({ length: actCount }, (_, i) => 3 + i)           // cols 3..7 midterm acts
  const A_FT = Array.from({ length: actCount }, (_, i) => 3 + actCount + i) // cols 8..12 finals acts
  const A_MTAVG = 3 + actCount * 2 + 0  // col 13
  const A_FTAVG = 3 + actCount * 2 + 1  // col 14

  // Quizzes sheet
  const Q_NAME = 1, Q_SNUM = 2
  const qzCount  = 5
  const Q_QZ = Array.from({ length: qzCount }, (_, i) => 3 + i)  // cols 3..7 quizzes
  const Q_AVG = 3 + qzCount  // col 8

  // Exams & Attendance sheet
  const E_NAME = 1, E_SNUM = 2
  const E_MT_ATT = 3, E_MT_EX = 4, E_FT_ATT = 5, E_FT_EX = 6
  const E_MT_EXAM = 9   // MT Exam score column in Exams & Attendance sheet
  const E_FT_EXAM = 10  // FT Exam score column in Exams & Attendance sheet

  // Grading Sheet columns (1-based)
  const G_NAME = 1, G_SNUM = 2, G_COURSE = 3, G_YEAR = 4
  const G_ACT   = 5   // Class Standing component: Activities avg
  const G_QZ    = 6   // Class Standing component: Quizzes avg
  const G_ATT   = 7   // Attendance score
  const G_CS    = 8   // Class Standing avg
  const G_MT_EX = 9   // Midterm exam score
  const G_FT_EX = 10  // Finals exam score
  const G_MT    = 11  // Midterm term grade
  const G_FT    = 12  // Finals term grade
  const G_FIN   = 13  // Final grade %
  const G_MT_EQ = 14  // Midterm equiv (lookup)
  const G_FT_EQ = 15  // Finals equiv (lookup)
  const G_FG    = 16  // Final grade equiv (combine table)
  const G_LTR   = 17  // Letter grade
  const G_REM   = 18  // Remark
  const G_NOTE  = 19  // Notes

  // ── Sheet builder helpers ────────────────────────────────────────────────
  function mkWS(aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    return ws
  }

  function setColWidths(ws, widths) {
    ws['!cols'] = widths.map(w => ({ wch: w }))
  }

  function freeze(ws, xSplit, ySplit) {
    ws['!freeze'] = { xSplit, ySplit }
  }

  // ── Row builders ─────────────────────────────────────────────────────────
  function headerRow1(label, actLabels, ftLabels, extras) {
    return [label, 'Student No.', ...actLabels, ...ftLabels, ...extras]
  }

  // ── Activities Sheet ──────────────────────────────────────────────────────
  const actHdr1 = ['Student Name', 'Student No.',
    ...A_MT.map((_, i) => `Midterm Act ${i + 1}`),
    ...A_FT.map((_, i) => `Finals Act ${i + 1}`),
    'MT Avg', 'FT Avg',
  ]
  const actRows = [
    [`ACTIVITIES — ${subject}`, '', ...Array(actCount * 2 + 2).fill('')],
    [`Class: ${cls.name || cls.id}`, `Section: ${cls.section || ''}`, ...Array(actCount * 2 + 2).fill('')],
    actHdr1,
  ]
  roster.forEach((s, idx) => {
    const r = DATA + idx
    const comp = s.gradeComponents?.[subject] || {}
    const acts = comp.activities || []
    const row = [
      s.name, s.id,
      ...A_MT.map((_, i) => acts[i]?.midterm ?? ''),
      ...A_FT.map((_, i) => acts[i]?.finals  ?? ''),
      { f: `IFERROR(AVERAGE(${CL(A_MT[0])}${r}:${CL(A_MT[actCount - 1])}${r}),"")` },
      { f: `IFERROR(AVERAGE(${CL(A_FT[0])}${r}:${CL(A_FT[actCount - 1])}${r}),"")` },
    ]
    actRows.push(row)
  })
  const wsAct = mkWS(actRows)
  setColWidths(wsAct, [28, 14, ...Array(actCount * 2).fill(12), 10, 10])
  freeze(wsAct, 2, 3)

  // ── Quizzes Sheet ─────────────────────────────────────────────────────────
  const qzHdr1 = ['Student Name', 'Student No.', ...Q_QZ.map((_, i) => `Quiz ${i + 1}`), 'Average']
  const qzRows = [
    [`QUIZZES — ${subject}`],
    [`Class: ${cls.name || cls.id}`],
    qzHdr1,
  ]
  roster.forEach((s, idx) => {
    const r = DATA + idx
    const comp = s.gradeComponents?.[subject] || {}
    const qzScores = comp.quizzes || []
    const row = [
      s.name,
      s.id,
      ...Q_QZ.map((_, i) => qzScores[i] ?? ''),
      { f: `IFERROR(AVERAGE(${CL(Q_QZ[0])}${r}:${CL(Q_QZ[qzCount - 1])}${r}),"")` },
    ]
    qzRows.push(row)
  })
  const wsQz = mkWS(qzRows)
  setColWidths(wsQz, [28, 14, ...Array(qzCount).fill(10), 10])
  freeze(wsQz, 2, 3)

  // ── Exams & Attendance Sheet ──────────────────────────────────────────────
  const examHdr = ['Student Name', 'Student No.',
    'MT Attendance', 'MT Excused',
    'FT Attendance', 'FT Excused',
    'MT Att Score',  'FT Att Score',
    'MT Exam',       'FT Exam',
  ]
  const examRows = [
    [`EXAMS & ATTENDANCE — ${subject}`],
    [`Class: ${cls.name || cls.id}`],
    examHdr,
  ]
  roster.forEach((s, idx) => {
    const r = DATA + idx
    const comp   = s.gradeComponents?.[subject] || {}
    const attSet = s.attendance?.[subject] || new Set()
    const exSet  = s.excuse?.[subject]     || new Set()
    const held   = getHeldDays(classId, subject, students)
    const attPct = held > 0 ? Math.round(((attSet.size) / held) * 100) : ''
    const exPct  = held > 0 ? Math.round(((exSet.size)  / held) * 100) : ''
    examRows.push([
      s.name, s.id,
      attSet.size, exSet.size,
      attSet.size, exSet.size,
      attPct,      attPct,
      comp.midtermExam ?? '', comp.finalsExam ?? '',
    ])
  })
  const wsExam = mkWS(examRows)
  setColWidths(wsExam, [28, 14, 13, 12, 13, 12, 13, 13, 10, 10])
  freeze(wsExam, 2, 3)

  // ── Grading Sheet ─────────────────────────────────────────────────────────
  const gsHdr = [
    'Student Name', 'Student No.', 'Course', 'Year Level',
    'Activities', 'Quizzes', 'Attendance',
    'Class Standing',
    'Midterm Exam', 'Finals Exam',
    'Midterm Term', 'Finals Term',
    'Final Grade (%)',
    'Midterm Equiv', 'Finals Equiv', 'Final Equiv',
    'Letter', 'Remark', 'Notes',
  ]
  const gsTitle  = `GRADING SHEET — ${subject}`
  const gsMeta   = `Class: ${cls.name || cls.id}  |  Section: ${cls.section || ''}  |  S.Y. ${cls.sy || ''}`
  const gsRows   = [
    [gsTitle],
    [gsMeta],
    gsHdr,
  ]

  roster.forEach((s, idx) => {
    const r = DATA + idx
    // Cross-sheet references
    const actRef  = xref('Activities', A_MTAVG, r)
    const actFRef = xref('Activities', A_FTAVG, r)
    const qzRef   = xref('Quizzes',   Q_AVG,   r)
    const attRef  = `${CL(G_ATT)}${r}`
    const csRef   = `${CL(G_CS)}${r}`
    const mtExRef = `${CL(G_MT_EX)}${r}`
    const ftExRef = `${CL(G_FT_EX)}${r}`
    const mtRef   = `${CL(G_MT)}${r}`
    const ftRef   = `${CL(G_FT)}${r}`
    const finRef  = `${CL(G_FIN)}${r}`
    const mtEqRef = `${CL(G_MT_EQ)}${r}`
    const ftEqRef = `${CL(G_FT_EQ)}${r}`
    const fgRef   = `${CL(G_FG)}${r}`

    const comp   = s.gradeComponents?.[subject] || {}
    const attSet = s.attendance?.[subject] || new Set()
    const exSet  = s.excuse?.[subject]     || new Set()
    const held   = getHeldDays(classId, subject, students)
    const attScore = held > 0
      ? Math.min(100, parseFloat(((attSet.size / held) * 100).toFixed(2)))
      : ''

    gsRows.push([
      s.name,
      s.id,
      s.course || '',
      s.year   || '',
      { f: `IFERROR(${actRef},"")` },   // Activities (cross-sheet)
      { f: `IFERROR(${qzRef},"")` },    // Quizzes (cross-sheet)
      attScore,                          // Attendance score (static)
      // Class Standing: average of available components
      { f: `IFERROR(AVERAGE(IF(ISNUMBER(${CL(G_ACT)}${r}),${CL(G_ACT)}${r}),IF(ISNUMBER(${CL(G_QZ)}${r}),${CL(G_QZ)}${r}),IF(ISNUMBER(${attRef}),${attRef})),"")` },
      { f: `IFERROR(${xref('Exams & Attendance', E_MT_EXAM, r)},"")` },  // Midterm exam (from Exams sheet)
      { f: `IFERROR(${xref('Exams & Attendance', E_FT_EXAM, r)},"")` },  // Finals exam (from Exams sheet)
      // Midterm term: avg(CS, MT Exam)
      { f: `IFERROR(AVERAGE(${csRef},${mtExRef}),"")` },
      // Finals term: avg(CS, FT Exam)
      { f: `IFERROR(AVERAGE(${csRef},${ftExRef}),"")` },
      // Final grade %: avg(midterm, finals)
      { f: `IFERROR(AVERAGE(${mtRef},${ftRef}),"")` },
      // Midterm equiv
      { f: equivIF(mtRef) },
      // Finals equiv
      { f: equivIF(ftRef) },
      // Final equiv (combine table)
      { f: fgIF(mtEqRef, ftEqRef) },
      // Letter
      { f: `IF(${fgRef}="—","—",IF(${fgRef}="5.00","F",IF(${fgRef}="4.00","D",IF(${fgRef}<="1.25","A+",IF(${fgRef}<="1.50","A",IF(${fgRef}<="1.75","A-",IF(${fgRef}<="2.00","B+",IF(${fgRef}<="2.25","B+",IF(${fgRef}<="2.50","B",IF(${fgRef}<="2.75","B-","C"))))))))))` },
      // Remark
      { f: remarkIF(fgRef) },
      '',  // Notes
    ])
  })

  const wsGs = mkWS(gsRows)
  setColWidths(wsGs, [28, 14, 16, 10, 11, 10, 11, 12, 12, 11, 12, 12, 13, 13, 12, 12, 8, 12, 20])
  freeze(wsGs, 4, 3)

  // Protect the grading sheet
  wsGs['!protect'] = { password: 'acadflow', sheet: true, insertRows: false, deleteRows: false }

  // ── Instructions Sheet ────────────────────────────────────────────────────
  const wsInstr = mkWS([
    ['AcadFlow Grading Sheet — Instructions'],
    [''],
    ['This workbook was auto-generated by AcadFlow.'],
    [''],
    ['• Activities tab   — Enter scores for each activity (midterm & finals columns).'],
    ['• Quizzes tab      — Enter quiz scores.'],
    ['• Exams tab        — Enter Midterm Exam and Finals Exam scores in the MT Exam / FT Exam columns.'],
    ['                     Attendance data is pre-filled from the portal.'],
    ['• Grading Sheet    — Protected. All grades auto-compute from your inputs above.'],
    ['                     Class Standing = AVG(Activities, Quizzes)'],
    ['                     Midterm Grade  = AVG(Class Standing, Midterm Exam)'],
    ['                     Finals Grade   = AVG(Class Standing, Finals Exam)'],
    ['                     Final Grade    = AVG(Midterm Grade, Finals Grade)'],
    ['  Password: acadflow'],
    [''],
    ['Grade Scale:'],
    ['  >99 → 1.00 | >95 → 1.25 | >92 → 1.50 | >89 → 1.75 | >86 → 2.00'],
    ['  >83 → 2.25 | >80 → 2.50 | >77 → 2.75 | >74 → 3.00 | ≥71 → 4.00 | <71 → 5.00'],
  ])
  setColWidths(wsInstr, [80])

  // ── Assemble workbook ─────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsAct,   'Activities')
  XLSX.utils.book_append_sheet(wb, wsQz,    'Quizzes')
  XLSX.utils.book_append_sheet(wb, wsExam,  'Exams & Attendance')
  XLSX.utils.book_append_sheet(wb, wsGs,    'Grading Sheet')
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

  const safeSub  = subject.replace(/[/\\:*?[\]]/g, '_').slice(0, 28)
  const safeDate = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `GradingSheet_${safeSub}_${safeDate}.xlsx`)
}

// ── parseGradingSheetImport ───────────────────────────────────────────────
/**
 * Reads a grading-sheet XLSX workbook (produced by exportGradingSheet) and
 * extracts per-student score data for re-import into the system.
 *
 * Column layout (0-based indices, post-fix layout):
 *   Activities:         0=name, 1=studentId, 2–6=MT acts, 7–11=FT acts, 12=MT avg, 13=FT avg
 *   Quizzes:            0=name, 1=studentId, 2–6=quiz scores, 7=avg
 *   Exams & Attendance: 0=name, 1=studentId, 8=MT exam, 9=FT exam
 *
 * Data rows start at 0-based row index 3 (rows 0–2 are title/header rows).
 *
 * @param {object} workbook — SheetJS workbook object
 * @returns {{ studentId:string, actAvg:number|null, qzAvg:number|null, mtExam:number|null, ftExam:number|null }[]}
 */
export function parseGradingSheetImport(workbook) {
  const XLSX = window.XLSX
  if (!XLSX) throw new Error('SheetJS not loaded')

  const DATA_ROW = 3

  function toAoa(sheetName) {
    const ws = workbook.Sheets[sheetName]
    if (!ws) return []
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  }

  function toN(v) {
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  function avgNonNull(vals) {
    const nums = vals.map(toN).filter(x => x !== null)
    if (!nums.length) return null
    return parseFloat((nums.reduce((s, x) => s + x, 0) / nums.length).toFixed(2))
  }

  const actRows  = toAoa('Activities').slice(DATA_ROW)
  const qzRows   = toAoa('Quizzes').slice(DATA_ROW)
  const examRows = toAoa('Exams & Attendance').slice(DATA_ROW)

  if (!examRows.length) throw new Error('Missing required sheet "Exams & Attendance"')
  if (!actRows.length)  throw new Error('Missing required sheet "Activities"')

  // Build lookup maps keyed by studentId
  const actMap  = {}
  const qzMap   = {}
  const examMap = {}

  // Activities: cols 2–6 = MT acts, 7–11 = FT acts; fallback to formula cells at 12/13
  for (const row of actRows) {
    const id = String(row[1] ?? '').trim()
    if (!id) continue
    const allActs = row.slice(2, 12)       // MT acts (2–6) + FT acts (7–11)
    const computed = avgNonNull(allActs)
    actMap[id] = computed !== null ? computed : (toN(row[12]) ?? toN(row[13]) ?? null)
  }

  // Quizzes: cols 2–6 = quiz scores; fallback to formula cell at col 7
  for (const row of qzRows) {
    const id = String(row[1] ?? '').trim()
    if (!id) continue
    const computed = avgNonNull(row.slice(2, 7))
    qzMap[id] = computed !== null ? computed : (toN(row[7]) ?? null)
  }

  // Exams & Attendance: col 8 = MT exam, col 9 = FT exam (static values)
  for (const row of examRows) {
    const id = String(row[1] ?? '').trim()
    if (!id) continue
    examMap[id] = { mtExam: toN(row[8]), ftExam: toN(row[9]) }
  }

  const allIds = new Set([...Object.keys(actMap), ...Object.keys(qzMap), ...Object.keys(examMap)])

  return [...allIds].map(studentId => ({
    studentId,
    actAvg: actMap[studentId]  ?? null,
    qzAvg:  qzMap[studentId]   ?? null,
    mtExam: examMap[studentId]?.mtExam ?? null,
    ftExam: examMap[studentId]?.ftExam ?? null,
  }))
}

// ── exportCurrentGrades ───────────────────────────────────────────────────
/**
 * Exports the currently stored grade data for one class+subject as an XLSX.
 * Includes per-student: activity scores, quiz scores, attendance, exams, computed terms, final grade.
 *
 * @param {{ classId: string, subject: string, students: object[], classes: object[], activities: object[], eqScale?: object[] }} opts
 */
export function exportCurrentGrades({ classId, subject, students, classes, activities = [], eqScale = DEFAULT_EQ_SCALE }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  const cls = classes.find(c => c.id === classId)
  if (!cls) return
  const roster = sortByLastName(getClassStudents(classId, students))

  // Get panel activities for this class+subject
  const panelActs = (activities || []).filter(a => a.classId === classId && a.subject === subject)

  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const title = `GRADE SUMMARY — ${subject}`
  const meta  = `Class: ${cls.name || cls.id}  |  Section: ${cls.section || ''}  |  S.Y. ${cls.sy || ''}  |  Exported: ${exportDate}`

  // Build dynamic activity headers
  const actHeaders = panelActs.length > 0
    ? panelActs.map((a, i) => a.title || `Activity ${i + 1}`)
    : ['Activities Avg']

  const quizMax = roster.reduce((max, s) => {
    const qz = s.gradeComponents?.[subject]?.quizScores || {}
    // Count only positional keys (q1, q2, …) to avoid counting panel quiz id keys
    const positional = Object.keys(qz).filter(k => /^q\d+$/.test(k))
    return Math.max(max, positional.length)
  }, 0)
  const qzCount = Math.max(quizMax, 1)
  const qzHeaders = Array.from({ length: qzCount }, (_, i) => `Quiz ${i + 1}`)

  const headers = [
    'Student Name', 'Student No.', 'Course', 'Year Level',
    ...actHeaders, 'Act Avg',
    ...qzHeaders, 'Quiz Avg',
    'Attendance (%)', 'MT Exam', 'FT Exam',
    'CS Midterm', 'CS Finals',
    'Midterm Term', 'Finals Term',
    'Final Grade (%)', 'Midterm Equiv', 'Finals Equiv', 'Final Equiv', 'Remark',
    'Uploaded At',
  ]

  const dataRows = roster.map(s => {
    const comp   = s.gradeComponents?.[subject] || {}
    const attSet = s.attendance?.[subject] || new Set()
    const held   = getHeldDays(classId, subject, students)
    const attPct = held > 0 ? parseFloat(((attSet.size / held) * 100).toFixed(2)) : ''

    // Activity scores — from panel submissions or stored activityScores
    let actVals
    if (panelActs.length > 0) {
      actVals = panelActs.map((a, idx) => {
        const sc = (a.submissions || {})[s.id]?.score
        if (sc != null) return sc
        // Fallback to manually-entered scores saved by the grade modal
        const stored = comp.activityScores
        if (stored) {
          const byId  = stored[a.id]
          const byIdx = stored[`a${idx + 1}`]
          const val   = byId ?? byIdx
          if (val != null) return val
        }
        return ''
      })
    } else {
      actVals = [comp.activities != null ? comp.activities : '']
    }
    const actNums = actVals.filter(v => v !== '' && !isNaN(v))
    const actAvg  = actNums.length > 0
      ? parseFloat((actNums.reduce((a, b) => a + Number(b), 0) / actNums.length).toFixed(2))
      : (comp.activities != null ? comp.activities : '')

    // Quiz scores — from stored quizScores map
    const qzScoresMap = comp.quizScores || {}
    const qzVals = Array.from({ length: qzCount }, (_, i) => {
      const v = qzScoresMap[`q${i + 1}`]
      return v != null ? v : ''
    })
    const qzNums = qzVals.filter(v => v !== '')
    const qzAvg  = qzNums.length > 0
      ? parseFloat((qzNums.reduce((a, b) => a + Number(b), 0) / qzNums.length).toFixed(2))
      : (comp.quizzes != null ? comp.quizzes : '')

    const midG = comp.midterm   != null ? comp.midterm   : ''
    const finG = comp.finals    != null ? comp.finals    : ''
    const fg   = s.grades?.[subject]    != null ? s.grades[subject] : ''

    const { eq: midEq } = gradeInfo(typeof midG === 'number' ? midG : null, eqScale)
    const { eq: finEq } = gradeInfo(typeof finG === 'number' ? finG : null, eqScale)

    let finalEq = '—', rem = 'Pending'
    if (typeof midG === 'number' || typeof finG === 'number') {
      const combined = combineEquiv(midEq, finEq)
      finalEq = combined.eq
      rem     = combined.rem
    } else if (typeof fg === 'number') {
      const gi = gradeInfo(fg, eqScale)
      finalEq  = gi.eq
      rem      = gi.rem
    }

    const ts = s.gradeUploadedAt?.[subject]
    const tsLabel = ts ? new Date(ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : ''

    return [
      s.name, s.id, s.course || '', s.year || '',
      ...actVals, actAvg,
      ...qzVals, qzAvg,
      attPct,
      comp.midtermExam != null ? comp.midtermExam : '',
      comp.finalsExam  != null ? comp.finalsExam  : '',
      comp.midtermCS   != null ? comp.midtermCS   : '',
      comp.finalsCS    != null ? comp.finalsCS    : '',
      midG, finG,
      fg,
      typeof midG === 'number' ? midEq : '—',
      typeof finG === 'number' ? finEq : '—',
      finalEq, rem,
      tsLabel,
    ]
  })

  const aoa = [
    [title],
    [meta],
    [],
    headers,
    ...dataRows,
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const colCount = headers.length
  ws['!cols'] = [
    28, 14, 16, 10,
    ...Array(actHeaders.length).fill(13), 10,
    ...Array(qzCount).fill(10), 10,
    13, 10, 10,
    12, 12, 13, 12, 14, 13, 13, 12, 12,
    20,
  ].slice(0, colCount).map(w => ({ wch: w }))
  ws['!freeze'] = { xSplit: 2, ySplit: 4 }

  const safeSub  = subject.replace(/[/\\:*?[\]]/g, '_').slice(0, 28)
  const safeDate = new Date().toISOString().slice(0, 10)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Grades')
  XLSX.writeFile(wb, `Grades_${safeSub}_${safeDate}.xlsx`)
}

// ── exportStudentRosterExcel ──────────────────────────────────────────────
/**
 * Exports a 2-sheet student roster workbook:
 * Sheet 1: Students (10 title rows + header row + data rows)
 * Sheet 2: Password Guide
 *
 * @param {{ students: object[], classes: object[] }} opts
 */
export function exportStudentRosterExcel({ students, classes }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const sorted = sortByLastName(students)

  // 10 title rows
  const titleRows = [
    ['AcadFlow — Student Roster'],
    [`Exported: ${exportDate}`],
    [''],
    ['Total Students:', sorted.length],
    [''],
    [''],
    [''],
    [''],
    [''],
    [''],
  ]
  const headers = ['#', 'Student No.', 'Full Name', 'Course', 'Year Level', 'Date of Birth', 'Mobile', 'Class', 'Section']
  const dataRows = sorted.map((s, idx) => {
    const cls = classes.find(c =>
      (c.id === s.classId) ||
      (s.classIds?.includes(c.id))
    )
    return [
      idx + 1,
      s.id,
      s.name,
      s.course || '',
      s.year   || '',
      s.dob    || '',
      s.mobile || '',
      cls?.name    || '',
      cls?.section || '',
    ]
  })
  const blankRows = Array.from({ length: 5 }, () => Array(9).fill(''))

  const aoa = [...titleRows, headers, ...dataRows, ...blankRows]
  const ws  = XLSX.utils.aoa_to_sheet(aoa)

  XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 10 }) // row 11 (0-based row 10)

  ws['!cols'] = [4, 14, 28, 20, 12, 14, 14, 20, 12].map(w => ({ wch: w }))
  ws['!freeze'] = { xSplit: 0, ySplit: 11 }

  // Password Guide sheet
  const wsPw = XLSX.utils.aoa_to_sheet([
    ['AcadFlow — Password Guide'],
    [''],
    ['Default student password: Welcome@2026'],
    ['Students must change their password on first login.'],
    [''],
    ['Requirements:'],
    ['  • At least 8 characters'],
    ['  • At least one uppercase letter'],
    ['  • At least one number'],
  ])
  wsPw['!cols'] = [{ wch: 60 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws,   'Students')
  XLSX.utils.book_append_sheet(wb, wsPw, 'Password Guide')

  XLSX.writeFile(wb, `StudentRoster_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// ── exportClassTemplate ───────────────────────────────────────────────────
/**
 * Exports a 3-sheet class import template:
 * Sheet 1: Class Info (5 title rows)
 * Sheet 2: Students (6 title rows)
 * Sheet 3: Instructions
 *
 * @param {{ students: object[], classes: object[] }} opts
 */
export function exportClassTemplate({ students, classes }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  // Class Info sheet (5 title rows + header + ≥5 blank data rows)
  const ciTitle = [
    ['AcadFlow — Class Import Template'],
    [`Generated: ${new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })}`],
    ['Fill in each class below. Each row = one class.'],
    [''],
    [''],
  ]
  const ciHdr  = ['Class ID', 'Class Name', 'Section', 'School Year', 'Subjects (comma-separated)', 'Teacher']
  const ciBlank = Array.from({ length: Math.max(5, classes.length) }, (_, i) => {
    const c = classes[i]
    if (c) return [c.id, c.name || '', c.section || '', c.sy || '', (c.subjects || []).join(', '), c.teacher || '']
    return Array(6).fill('')
  })
  const wsCI = XLSX.utils.aoa_to_sheet([...ciTitle, ciHdr, ...ciBlank])
  wsCI['!cols'] = [14, 24, 14, 12, 40, 20].map(w => ({ wch: w }))
  wsCI['!freeze'] = { xSplit: 0, ySplit: 5 }

  // Students sheet (6 title rows + header + ≥5 blank data rows)
  const stTitle = [
    ['AcadFlow — Student Import Template'],
    [`Generated: ${new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })}`],
    ['Fill in each student below. Each row = one student.'],
    ['Student No. must be unique. Class ID must match an existing class.'],
    [''],
    [''],
  ]
  const stHdr  = ['Student No.', 'Full Name', 'Course', 'Year Level', 'Date of Birth', 'Mobile', 'Class ID']
  const stData  = sortByLastName(students).map(s => [
    s.id, s.name, s.course || '', s.year || '', s.dob || '', s.mobile || '', s.classId || (s.classIds?.[0] || ''),
  ])
  const stBlank = Array.from({ length: Math.max(5 - stData.length, 0) }, () => Array(7).fill(''))
  const wsSt = XLSX.utils.aoa_to_sheet([...stTitle, stHdr, ...stData, ...stBlank])
  wsSt['!cols'] = [14, 28, 20, 12, 14, 14, 14].map(w => ({ wch: w }))
  wsSt['!freeze'] = { xSplit: 0, ySplit: 6 }

  // Instructions sheet
  const wsInstr = XLSX.utils.aoa_to_sheet([
    ['AcadFlow Import Template — Instructions'],
    [''],
    ['CLASS INFO sheet:'],
    ['  • Class ID must be unique (e.g. CS101-A).'],
    ['  • Subjects: comma-separated list (e.g. Math, Science, English).'],
    [''],
    ['STUDENTS sheet:'],
    ['  • Student No. must be unique across all classes.'],
    ['  • Class ID must match a class in the Class Info sheet or an existing class.'],
    ['  • Year Level: 1st Year, 2nd Year, 3rd Year, or 4th Year.'],
    ['  • Date of Birth: YYYY-MM-DD format.'],
    [''],
    ['After filling in, import this file via Admin → Classes or Admin → Students.'],
  ])
  wsInstr['!cols'] = [{ wch: 72 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsCI,    'Class Info')
  XLSX.utils.book_append_sheet(wb, wsSt,    'Students')
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

  XLSX.writeFile(wb, `ClassTemplate_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// ── downloadAttImportTemplate ─────────────────────────────────────────────
/**
 * Exports an attendance import template with one sheet per subject.
 * Existing attendance dates are pre-filled with P/E/A values.
 * Five placeholder "ADD DATE →" columns are appended for new entries.
 *
 * @param {{ classId: string, classes: object[], students: object[] }} opts
 */
export function downloadAttImportTemplate({ classId, classes, students }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }

  const cls = classes.find(c => c.id === classId)
  if (!cls) return
  const subs   = cls.subjects || []
  const roster = sortByLastName(getClassStudents(classId, students))
  const wb     = XLSX.utils.book_new()

  subs.forEach(sub => {
    // Collect all existing dates for this subject across the roster
    const dateSet = new Set()
    roster.forEach(s => {
      const attSet = s.attendance?.[sub]
      const exSet  = s.excuse?.[sub]
      if (attSet instanceof Set) attSet.forEach(d => dateSet.add(d))
      else if (Array.isArray(attSet)) attSet.forEach(d => dateSet.add(d))
      if (exSet instanceof Set) exSet.forEach(d => dateSet.add(d))
      else if (Array.isArray(exSet)) exSet.forEach(d => dateSet.add(d))
    })
    const dates = [...dateSet].sort()
    const PLACEHOLDER_COUNT = 5
    const placeholders = Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => `ADD DATE ${i + 1} →`)

    // Headers
    const hdr1 = ['Student Name', 'Student No.', ...dates, ...placeholders]
    const hdr2 = ['', '', ...dates.map(() => ''), ...placeholders.map(() => 'YYYY-MM-DD')]

    const rows = [hdr1, hdr2]
    roster.forEach(s => {
      const attSet = s.attendance?.[sub]
      const exSet  = s.excuse?.[sub]
      const attArr = attSet instanceof Set ? [...attSet] : (Array.isArray(attSet) ? attSet : [])
      const exArr  = exSet  instanceof Set ? [...exSet]  : (Array.isArray(exSet)  ? exSet  : [])
      const row = [
        s.name, s.id,
        ...dates.map(d => {
          if (attArr.includes(d)) return 'P'
          if (exArr.includes(d))  return 'E'
          return 'A'
        }),
        ...Array(PLACEHOLDER_COUNT).fill(''),
      ]
      rows.push(row)
    })

    rows.push([])
    rows.push(['Legend: P = Present, E = Excused, A = Absent'])
    rows.push(['Dates must be in YYYY-MM-DD format.'])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 28 }, { wch: 14 }, ...Array(dates.length + PLACEHOLDER_COUNT).fill({ wch: 12 })]
    ws['!freeze'] = { xSplit: 2, ySplit: 2 }

    // Safe sheet name: strip invalid chars, max 31 chars
    const safeName = sub.replace(/[\[\]/*?:\\ ]/g, '_').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safeName || `Sheet${subs.indexOf(sub) + 1}`)
  })

  // Instructions sheet
  const wsInstr = XLSX.utils.aoa_to_sheet([
    ['Attendance Import Template — Instructions'],
    [''],
    ['• Each sheet corresponds to one subject.'],
    ['• Existing dates are pre-filled with: P (Present), E (Excused), A (Absent).'],
    ['• To add new attendance dates, replace the "ADD DATE →" column headers with YYYY-MM-DD dates.'],
    ['• Fill P, E, or A for each student in new date columns.'],
    ['• After filling in, import this file via Admin → Attendance → Import.'],
  ])
  wsInstr['!cols'] = [{ wch: 80 }]
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

  XLSX.writeFile(wb, `AttendanceTemplate_${cls.name || classId}_${new Date().toISOString().slice(0, 10)}.xlsx`)
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
    'Average (%)', 'GWA (1.0–5.0)', 'Status',
  ]

  const rows = roster.map(s => {
    const subGrades = subs.map(sub => {
      const info = gradeInfoForStudent(s, sub, eqScale)
      return info.eq === '—' ? '—' : info.eq
    })
    const numericEquivs = subGrades
      .map(eq => parseFloat(eq))
      .filter(n => !isNaN(n))
    const avgEq = numericEquivs.length
      ? numericEquivs.reduce((a, b) => a + b, 0) / numericEquivs.length
      : null

    const avgEqStr  = avgEq != null ? avgEq.toFixed(2) : '—'
    const avgInfo   = avgEq != null ? equivInfo(avgEqStr) : { ltr: '—', rem: 'No Grade' }

    return [
      s.name, s.id, s.course || '', s.year || '',
      ...subGrades,
      avgEqStr,
      avgEqStr,
      avgInfo.rem,
    ]
  })

  // Class average row
  const subAvgs = subs.map((sub, si) => {
    const vals = rows.map(r => parseFloat(r[4 + si])).filter(n => !isNaN(n))
    if (!vals.length) return '—'
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)
  })
  const avgEquivs = subAvgs.map(v => parseFloat(v)).filter(n => !isNaN(n))
  const overallAvg = avgEquivs.length
    ? (avgEquivs.reduce((a, b) => a + b, 0) / avgEquivs.length).toFixed(2)
    : '—'

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
      return held > 0 ? parseFloat(((presentCounts[si] / held) * 100).toFixed(1)) : '—'
    })
    const totalPresent = presentCounts.reduce((a, b) => a + b, 0)
    const overallRate  = getAttRate(s, students, classes)
    return [
      s.name, s.id, s.course || '', s.year || '',
      ...presentCounts,
      ...rates,
      totalPresent,
      overallRate != null ? overallRate : '—',
    ]
  })

  // Summary row
  const subAvgPresent = subs.map((_, si) => {
    const vals = rows.map(r => r[4 + si]).filter(v => typeof v === 'number')
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—'
  })
  const subAvgRate = subs.map((_, si) => {
    const vals = rows.map(r => r[4 + subs.length + si]).filter(v => typeof v === 'number')
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—'
  })
  const totalPresentAvg = rows.length
    ? (rows.map(r => r[4 + subs.length * 2]).reduce((a, b) => a + b, 0) / rows.length).toFixed(1)
    : '—'
  const overallRateAvg = (() => {
    const vals = rows.map(r => r[4 + subs.length * 2 + 1]).filter(v => typeof v === 'number')
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—'
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
 * @param {object} data — from buildGradesData()
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
    [`GRADE SUMMARY — ${cls.name || cls.id}`],
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
      const mtInfo = midG != null ? gradeInfo(midG, eqScale) : { eq: '—' }
      const ftInfo = finG != null ? gradeInfo(finG, eqScale) : { eq: '—' }
      return [
        s.name, s.id, s.course || '', s.year || '',
        midG ?? '—', finG ?? '—',
        (midG != null && finG != null) ? ((midG + finG) / 2).toFixed(2) : '—',
        info.eq, info.ltr, info.rem,
      ]
    })
    const subAoa = [
      [`${sub} — ${cls.name || cls.id}`],
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
 * @param {object} data — from buildAttendanceData()
 * @param {object[]} students
 * @param {object[]} classes
 * @returns {object} XLSX workbook
 */
export function buildAttendanceWorkbook(data, students, classes) {
  const XLSX = window.XLSX
  const { cls, headers, rows, summaryRow, subs } = data

  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const titleRows  = [
    [`ATTENDANCE SUMMARY — ${cls.name || cls.id}`],
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
      const rate = held > 0 ? parseFloat(((attArr.length / held) * 100).toFixed(1)) : '—'
      return [s.name, s.id, ...perDate, attArr.length, exArr.length, held, rate]
    })
    const subAoa = [
      [`${sub} — ${cls.name || cls.id}`],
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
 * @param {object} s — student record
 * @param {object[]} classes
 * @param {object[]} students — full roster (for held-days calc)
 * @param {object[]} [eqScale]
 * @returns {object} XLSX workbook
 */
export function buildStudentWorkbook(s, classes, students, eqScale = DEFAULT_EQ_SCALE) {
  const XLSX = window.XLSX
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allSubs = [...new Set(
    enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || [])
  )]
  const exportDate = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' })
  const gwa = getGWA(s, classes)

  // ── Grades sheet ──────────────────────────────────────────────────────
  const gradeRows = [
    [`STUDENT GRADE REPORT — ${s.name}`],
    [`Student No.: ${s.id}  |  Course: ${s.course || '—'}  |  Year: ${s.year || '—'}`],
    [`Exported: ${exportDate}  |  GWA: ${gwa != null ? gwa.toFixed(2) : '—'}`],
    [],
    ['Subject', 'Midterm (%)', 'Finals (%)', 'Midterm Equiv', 'Finals Equiv', 'Final Equiv', 'Letter', 'Remark', 'Uploaded'],
  ]

  allSubs.forEach(sub => {
    const comp    = s.gradeComponents?.[sub] || {}
    const midG    = comp.midterm ?? null
    const finG    = comp.finals  ?? null
    const info    = gradeInfoForStudent(s, sub, eqScale)
    const mtInfo  = midG != null ? gradeInfo(midG, eqScale) : { eq: '—' }
    const ftInfo  = finG != null ? gradeInfo(finG, eqScale) : { eq: '—' }
    const ts      = s.gradeUploadedAt?.[sub]
    const uploaded = ts ? new Date(ts).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—'

    const displayEq  = info.eq  !== '—' ? info.eq  : (midG != null ? mtInfo.eq : '—')
    const displayLtr = info.ltr !== '—' ? info.ltr : (midG != null ? mtInfo.ltr : '—')
    const displayRem = info.rem !== 'Pending' ? info.rem : (midG != null ? 'Midterm Only' : 'Pending')

    gradeRows.push([
      sub,
      midG ?? '—', finG ?? '—',
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
    [`ATTENDANCE RECORD — ${s.name}`],
    [`Student No.: ${s.id}  |  Overall Rate: ${attRate != null ? attRate + '%' : '—'}`],
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
    const rate     = held > 0 ? parseFloat(((present / held) * 100).toFixed(1)) : '—'
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

// ── Preview HTML builders ─────────────────────────────────────────────────

/**
 * Builds an HTML string for grades preview (color-coded by equiv value).
 * ≤2.00 (good) → green; ≤3.00 → amber; else red.
 * @param {object} data — from buildGradesData()
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
    <h3 style="font-size:13px;margin:0 0 8px;font-weight:700">${cls.name || cls.id} — Grade Summary</h3>
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
 * @param {object} data — from buildAttendanceData()
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
    <h3 style="font-size:13px;margin:0 0 8px;font-weight:700">${cls.name || cls.id} — Attendance Summary</h3>
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
 * @param {object} s — student record
 * @param {object[]} classes
 * @param {object[]} students — full roster
 * @param {object[]} [eqScale]
 * @returns {string} HTML
 */
export function buildStudentPreviewHTML(s, classes, students, eqScale = DEFAULT_EQ_SCALE) {
  const enrolledIds = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
  const allSubs = [...new Set(
    enrolledIds.flatMap(id => (classes.find(c => c.id === id)?.subjects) || [])
  )]
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

    const displayEq  = info.eq  !== '—' ? info.eq  : (midG != null ? gradeInfo(midG, eqScale).eq  : '—')
    const displayLtr = info.ltr !== '—' ? info.ltr : (midG != null ? gradeInfo(midG, eqScale).ltr : '—')
    const displayRem = info.rem !== 'Pending' ? info.rem : (midG != null ? 'Midterm Only' : 'Pending')
    const color = gradeColor(displayEq)

    return `<tr>
      <td style="${tdStyle}">${sub}</td>
      <td style="${tdStyle};text-align:center">${midG ?? '—'}</td>
      <td style="${tdStyle};text-align:center">${finG ?? '—'}</td>
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
    const rate    = held > 0 ? parseFloat(((present / held) * 100).toFixed(1)) : '—'
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
        <div style="font-size:11px;opacity:.8;margin-top:3px">${s.id} · ${s.course || '—'} · ${s.year || '—'}</div>
      </div>
      <div style="display:flex;gap:12px;padding:10px 18px;background:#eff6ff;border:1px solid #bfdbfe">
        <div style="flex:1;text-align:center">
          <div style="font-size:11px;color:#6b7280">GWA</div>
          <div style="font-size:18px;font-weight:700;color:#1e3a8a">${gwa != null ? gwa.toFixed(2) : '—'}</div>
        </div>
        <div style="flex:1;text-align:center">
          <div style="font-size:11px;color:#6b7280">Attendance</div>
          <div style="font-size:18px;font-weight:700;color:#14532d">${attRate != null ? attRate + '%' : '—'}</div>
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
