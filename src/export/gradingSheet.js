// ── Grading sheet export / import (v2) ─────────────────────────────────────
// One color-coded sheet per subject (no fragile cross-sheet formulas):
//   • Grey  — locked, prefilled from the app (student, app activities/quizzes,
//             attendance). Teachers don't touch these.
//   • Green — the only cells you fill in (extra activity/quiz columns, Attitude,
//             Midterm Exam, Finals Exam). 0–100, with in-cell validation.
//   • Blue  — auto-computed by live formulas that mirror the app EXACTLY:
//             Class Standing = avg(Activities, Quizzes, Attendance, Attitude)
//             Midterm Term   = avg(Class Standing, Midterm Exam)
//             Finals Term    = avg(Class Standing, Finals Exam)
//             Final Grade %  = avg(Midterm Term, Finals Term)
//
// Extra (green "+") activity/quiz columns import as ADDITIONAL columns alongside
// the app's own activities/quizzes — they never overwrite them.
//
// ExcelJS gives per-cell locking + 0–100 validation; we fall back to a plain
// SheetJS writer (same layout, no locking) on ANY failure. A hidden "Meta" sheet
// records the column map so the importer reads the file back reliably.

import {
  CL, getClassStudents, fgIF, remarkIF, ensureExcelJS, downloadBlob,
} from '@/export/excelExport.js'
import { getHeldDays, round2, DEFAULT_EQ_SCALE } from '@/utils/grades.js'
import { sortByLastName } from '@/utils/format.js'

const EXTRA_COLS = 3                  // blank "+ Activity/Quiz" columns
const DATA_ROW = 5                    // 1-based first student row (rows 1–4 = headers)
const SHEET_PW = 'acadflow'

// Fills (ARGB) — light tints matching the in-app preview legend.
const FILL_GREY  = 'FFF1EFE8'
const FILL_GREEN = 'FFEAF3DE'
const FILL_BLUE  = 'FFE6F1FB'
const FILL_HEAD  = 'FFE8E6DF'

// ── Percent → equivalency, driven by the actual eqScale (not hardcoded) ──────
function equivIFScale(ref, eqScale) {
  const sorted = [...eqScale].sort((a, b) => b.minScore - a.minScore)
  let expr = '"5.00"'
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i]
    expr = `IF(${ref}>=${t.minScore},"${t.eq}",${expr})`
  }
  return `IF(${ref}="","—",${expr})`
}

// ── Build everything both writers need (column map + prefilled rows) ─────────
function buildGradingCtx({ classId, subject, students, classes, activities, quizzes, eqScale, prefilled }) {
  const cls = classes.find(c => c.id === classId)
  if (!cls) return null

  const roster   = sortByLastName(getClassStudents(classId, students))
  const panelActs = (activities || []).filter(a => a.classId === classId && a.subject === subject)
  const panelQz   = (quizzes || []).filter(q => q.classIds?.includes(classId) && q.subject === subject)
  const nApp = panelActs.length
  const nAppQz = panelQz.length

  // Column plan (1-based). App columns first, then the EXTRA blank columns.
  const C_SNUM = 1, C_NAME = 2
  const actStart = 3
  const actEnd   = actStart + nApp + EXTRA_COLS - 1
  const qzStart  = actEnd + 1
  const qzEnd    = qzStart + nAppQz + EXTRA_COLS - 1
  const C_ATT    = qzEnd + 1     // Attitude (green)
  const C_ATTEND = C_ATT + 1     // Attendance % (grey)
  const C_MTEX   = C_ATTEND + 1  // Midterm Exam (green)
  const C_FTEX   = C_MTEX + 1    // Finals Exam (green)
  const C_ACTAVG = C_FTEX + 1
  const C_QZAVG  = C_ACTAVG + 1
  const C_CS     = C_QZAVG + 1
  const C_MT     = C_CS + 1
  const C_FT     = C_MT + 1
  const C_FINAL  = C_FT + 1
  const C_MTEQ   = C_FINAL + 1
  const C_FTEQ   = C_MTEQ + 1
  const C_FINEQ  = C_FTEQ + 1
  const C_REM    = C_FINEQ + 1
  const LAST     = C_REM
  const cols = {
    C_SNUM, C_NAME, actStart, actEnd, qzStart, qzEnd, C_ATT, C_ATTEND, C_MTEX, C_FTEX,
    C_ACTAVG, C_QZAVG, C_CS, C_MT, C_FT, C_FINAL, C_MTEQ, C_FTEQ, C_FINEQ, C_REM, LAST,
  }

  const headers = new Array(LAST).fill('')
  headers[C_SNUM - 1] = 'Student No.'
  headers[C_NAME - 1] = 'Student Name'
  panelActs.forEach((a, i) => { headers[actStart - 1 + i] = a.title || `Activity ${i + 1}` })
  for (let i = 0; i < EXTRA_COLS; i++) headers[actStart - 1 + nApp + i] = `+ Activity ${i + 1}`
  panelQz.forEach((q, i) => { headers[qzStart - 1 + i] = q.title || `Quiz ${i + 1}` })
  for (let i = 0; i < EXTRA_COLS; i++) headers[qzStart - 1 + nAppQz + i] = `+ Quiz ${i + 1}`
  headers[C_ATT - 1]    = 'Attitude'
  headers[C_ATTEND - 1] = 'Attendance %'
  headers[C_MTEX - 1]   = 'Midterm Exam'
  headers[C_FTEX - 1]   = 'Finals Exam'
  headers[C_ACTAVG - 1] = 'Activities Avg'
  headers[C_QZAVG - 1]  = 'Quizzes Avg'
  headers[C_CS - 1]     = 'Class Standing'
  headers[C_MT - 1]     = 'Midterm Term'
  headers[C_FT - 1]     = 'Finals Term'
  headers[C_FINAL - 1]  = 'Final Grade (%)'
  headers[C_MTEQ - 1]   = 'Midterm Equiv'
  headers[C_FTEQ - 1]   = 'Finals Equiv'
  headers[C_FINEQ - 1]  = 'Final Equiv'
  headers[C_REM - 1]    = 'Remark'

  // App activity score → percentage (normalized by the activity's maxScore).
  function appActPct(s, a, idx) {
    const comp = s.gradeComponents?.[subject] || {}
    let raw = (a.submissions || {})[s.id]?.score
    if (raw == null) raw = comp.activityScores?.[a.id] ?? comp.activityScores?.[`a${idx + 1}`]
    if (raw == null) return ''
    const max = a.maxScore || 100
    return round2((Number(raw) / max) * 100)
  }
  // App quiz score → percentage (quizScores are already stored as percentages).
  function appQzPct(s, q, idx) {
    const comp = s.gradeComponents?.[subject] || {}
    const sub = (q.submissions || {})[s.id]
    if (sub?.score != null) {
      const total = (sub.total ?? q.totalPoints ?? q.questions?.length) || 1
      return round2((sub.score / total) * 100)
    }
    const v = comp.quizScores?.[q.id] ?? comp.quizScores?.[`q${idx + 1}`]
    return v != null ? round2(Number(v)) : ''
  }

  const rows = roster.map(s => {
    const comp   = s.gradeComponents?.[subject] || {}
    const attSet = s.attendance?.[subject] || new Set()
    const held   = getHeldDays(classId, subject, students)
    const attend = held > 0 ? Math.min(100, round2((attSet.size / held) * 100)) : ''
    return {
      id: s.id,
      name: s.name,
      appAct: panelActs.map((a, i) => appActPct(s, a, i)),
      appQz:  panelQz.map((q, i) => appQzPct(s, q, i)),
      attitude: prefilled ? (comp.attitude ?? '') : '',
      attend,
      mtEx: prefilled ? (comp.midtermExam ?? '') : '',
      ftEx: prefilled ? (comp.finalsExam ?? '') : '',
    }
  })

  // Per-row formula strings (R = excel row number).
  function formulas(R) {
    const L = CL
    const actAvg = `IFERROR(AVERAGE(${L(actStart)}${R}:${L(actEnd)}${R}),"")`
    const qzAvg  = `IFERROR(AVERAGE(${L(qzStart)}${R}:${L(qzEnd)}${R}),"")`
    const cs     = `IFERROR(AVERAGE(${L(C_ACTAVG)}${R},${L(C_QZAVG)}${R},${L(C_ATTEND)}${R},${L(C_ATT)}${R}),"")`
    const mt     = `IF(ISNUMBER(${L(C_MTEX)}${R}),IFERROR(AVERAGE(${L(C_CS)}${R},${L(C_MTEX)}${R}),""),"")`
    const ft     = `IF(ISNUMBER(${L(C_FTEX)}${R}),IFERROR(AVERAGE(${L(C_CS)}${R},${L(C_FTEX)}${R}),""),"")`
    const final  = `IFERROR(AVERAGE(${L(C_MT)}${R},${L(C_FT)}${R}),"")`
    const mtEq   = equivIFScale(`${L(C_MT)}${R}`, eqScale)
    const ftEq   = equivIFScale(`${L(C_FT)}${R}`, eqScale)
    const finEq  = fgIF(`${L(C_MTEQ)}${R}`, `${L(C_FTEQ)}${R}`)
    const rem    = remarkIF(`${L(C_FINEQ)}${R}`)
    return { actAvg, qzAvg, cs, mt, ft, final, mtEq, ftEq, finEq, rem }
  }

  const meta = [
    ['acadflow', 'grading-v2'],
    ['subject', subject],
    ['nApp', nApp], ['nAppQz', nAppQz], ['extra', EXTRA_COLS],
    ['actStart', actStart], ['actEnd', actEnd],
    ['qzStart', qzStart], ['qzEnd', qzEnd],
    ['attitude', C_ATT], ['attend', C_ATTEND], ['mtex', C_MTEX], ['ftex', C_FTEX],
    ['dataRow', DATA_ROW],
  ]

  const title = `GRADING SHEET — ${subject}`
  const sub   = `Class: ${cls.name || cls.id}   |   Section: ${cls.section || ''}   |   S.Y. ${cls.sy || ''}`
  const legend = 'Grey = locked (from the app)   ·   Green = type a number 0–100   ·   Blue = auto-computed (do not edit)'

  const widths = new Array(LAST).fill(11)
  widths[C_SNUM - 1] = 14
  widths[C_NAME - 1] = 26
  widths[C_ATTEND - 1] = 12
  widths[C_REM - 1] = 12

  const safeSub  = subject.replace(/[/\\:*?[\]]/g, '_').slice(0, 28)
  const safeDate = new Date().toISOString().slice(0, 10)
  const fileName = `${prefilled ? 'Grades' : 'GradingSheet'}_${safeSub}_${safeDate}.xlsx`

  // Which 1-based columns are the green fill-in cells (for locking + validation).
  const greenCols = []
  for (let i = 0; i < EXTRA_COLS; i++) greenCols.push(actStart + nApp + i)
  for (let i = 0; i < EXTRA_COLS; i++) greenCols.push(qzStart + nAppQz + i)
  greenCols.push(C_ATT, C_MTEX, C_FTEX)
  // Grey (locked, prefilled) columns.
  const greyCols = [C_SNUM, C_NAME, C_ATTEND]
  panelActs.forEach((_, i) => greyCols.push(actStart + i))
  panelQz.forEach((_, i) => greyCols.push(qzStart + i))
  // Blue (locked, formula) columns.
  const blueCols = [C_ACTAVG, C_QZAVG, C_CS, C_MT, C_FT, C_FINAL, C_MTEQ, C_FTEQ, C_FINEQ, C_REM]

  return {
    cls, subject, headers, rows, formulas, cols, widths, fileName, meta,
    title, sub, legend, greenCols, greyCols, blueCols,
  }
}

// ── ExcelJS writer — locked formulas/prefills, open green inputs ─────────────
async function gradingExcelJS(ExcelJS, ctx) {
  const { headers, rows, formulas, cols, widths, fileName, meta, title, sub, legend,
          greenCols, greyCols, blueCols } = ctx
  const greenSet = new Set(greenCols)
  const greySet  = new Set(greyCols)
  const blueSet  = new Set(blueCols)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Grades', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] })

  ws.addRow([title])
  ws.addRow([sub])
  ws.addRow([legend])
  ws.addRow(headers)
  ws.getRow(1).font = { bold: true, size: 13 }
  ws.getRow(2).font = { color: { argb: 'FF666666' } }
  ws.getRow(3).font = { italic: true, color: { argb: 'FF666666' } }
  const headRow = ws.getRow(4)
  headRow.font = { bold: true }
  headRow.alignment = { horizontal: 'center', wrapText: true, vertical: 'middle' }
  for (let c = 1; c <= cols.LAST; c++) {
    headRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEAD } }
  }

  rows.forEach((r, i) => {
    const R = DATA_ROW + i
    const arr = new Array(cols.LAST).fill(null)
    arr[cols.C_SNUM - 1] = r.id
    arr[cols.C_NAME - 1] = r.name
    r.appAct.forEach((v, k) => { arr[cols.actStart - 1 + k] = v === '' ? null : v })
    r.appQz.forEach((v, k) => { arr[cols.qzStart - 1 + k] = v === '' ? null : v })
    arr[cols.C_ATT - 1]    = r.attitude === '' ? null : r.attitude
    arr[cols.C_ATTEND - 1] = r.attend === '' ? null : r.attend
    arr[cols.C_MTEX - 1]   = r.mtEx === '' ? null : r.mtEx
    arr[cols.C_FTEX - 1]   = r.ftEx === '' ? null : r.ftEx
    const f = formulas(R)
    arr[cols.C_ACTAVG - 1] = { formula: f.actAvg }
    arr[cols.C_QZAVG - 1]  = { formula: f.qzAvg }
    arr[cols.C_CS - 1]     = { formula: f.cs }
    arr[cols.C_MT - 1]     = { formula: f.mt }
    arr[cols.C_FT - 1]     = { formula: f.ft }
    arr[cols.C_FINAL - 1]  = { formula: f.final }
    arr[cols.C_MTEQ - 1]   = { formula: f.mtEq }
    arr[cols.C_FTEQ - 1]   = { formula: f.ftEq }
    arr[cols.C_FINEQ - 1]  = { formula: f.finEq }
    arr[cols.C_REM - 1]    = { formula: f.rem }
    const row = ws.addRow(arr)

    for (let c = 1; c <= cols.LAST; c++) {
      const cell = row.getCell(c)
      if (greenSet.has(c)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_GREEN } }
        cell.protection = { locked: false }
        cell.dataValidation = {
          type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 100],
          showErrorMessage: true, errorStyle: 'warning',
          errorTitle: 'Check this score', error: 'Enter a number from 0 to 100.',
        }
      } else if (blueSet.has(c)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_BLUE } }
      } else if (greySet.has(c)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_GREY } }
      }
    }
  })

  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  await ws.protect(SHEET_PW, { selectLockedCells: true, selectUnlockedCells: true })

  // How-to sheet.
  const wsHow = wb.addWorksheet('How to use')
  ;[
    ['AcadFlow Grading Sheet'],
    [''],
    ['Fill in only the GREEN cells (Attitude, Midterm Exam, Finals Exam, and any'],
    ['"+ Activity" / "+ Quiz" columns). Enter a number from 0 to 100.'],
    [''],
    ['Grey cells are locked — they come straight from the app (student, app'],
    ['activities/quizzes, attendance) so you never retype them.'],
    [''],
    ['Blue cells are computed automatically and match the portal exactly:'],
    ['   Class Standing = average(Activities, Quizzes, Attendance, Attitude)'],
    ['   Midterm Term   = average(Class Standing, Midterm Exam)'],
    ['   Finals Term    = average(Class Standing, Finals Exam)'],
    ['   Final Grade %  = average(Midterm Term, Finals Term)'],
    [''],
    ['"+ Activity" / "+ Quiz" columns import as EXTRA columns next to the app\'s'],
    ['own activities and quizzes — they never overwrite them.'],
    [''],
    ['To unlock the sheet for manual edits, the password is: acadflow'],
  ].forEach(r => wsHow.addRow(r))
  wsHow.getColumn(1).width = 78

  // Hidden Meta sheet (column map) — read by the importer. Do not edit.
  const wsMeta = wb.addWorksheet('Meta', { state: 'veryHidden' })
  meta.forEach(r => wsMeta.addRow(r))

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName)
}

// ── SheetJS writer (fallback) — same layout, no locking/validation ───────────
function gradingSheetJS(XLSX, ctx) {
  const { headers, rows, formulas, cols, widths, fileName, meta, title, sub, legend } = ctx
  const aoa = [[title], [sub], [legend], headers]
  rows.forEach((r, i) => {
    const R = DATA_ROW + i
    const arr = new Array(cols.LAST).fill('')
    arr[cols.C_SNUM - 1] = r.id
    arr[cols.C_NAME - 1] = r.name
    r.appAct.forEach((v, k) => { arr[cols.actStart - 1 + k] = v })
    r.appQz.forEach((v, k) => { arr[cols.qzStart - 1 + k] = v })
    arr[cols.C_ATT - 1]    = r.attitude
    arr[cols.C_ATTEND - 1] = r.attend
    arr[cols.C_MTEX - 1]   = r.mtEx
    arr[cols.C_FTEX - 1]   = r.ftEx
    const f = formulas(R)
    arr[cols.C_ACTAVG - 1] = { f: f.actAvg }
    arr[cols.C_QZAVG - 1]  = { f: f.qzAvg }
    arr[cols.C_CS - 1]     = { f: f.cs }
    arr[cols.C_MT - 1]     = { f: f.mt }
    arr[cols.C_FT - 1]     = { f: f.ft }
    arr[cols.C_FINAL - 1]  = { f: f.final }
    arr[cols.C_MTEQ - 1]   = { f: f.mtEq }
    arr[cols.C_FTEQ - 1]   = { f: f.ftEq }
    arr[cols.C_FINEQ - 1]  = { f: f.finEq }
    arr[cols.C_REM - 1]    = { f: f.rem }
    aoa.push(arr)
  })
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = widths.map(w => ({ wch: w }))
  ws['!freeze'] = { xSplit: 2, ySplit: 4 }

  const wsMeta = XLSX.utils.aoa_to_sheet(meta)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Grades')
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Meta')
  if (wb.Workbook?.Sheets) wb.Workbook.Sheets[1] = { ...(wb.Workbook.Sheets[1] || {}), Hidden: 1 }
  else wb.Workbook = { Sheets: [{}, { Hidden: 1 }] }
  XLSX.writeFile(wb, fileName)
}

/**
 * Export a blank (or prefilled) grading sheet for one class+subject.
 * @param {{ classId, subject, students, classes, activities?, quizzes?, eqScale?, prefilled? }} opts
 */
export async function exportGradingSheet({ classId, subject, students, classes, activities = [], quizzes = [], eqScale = DEFAULT_EQ_SCALE, prefilled = false }) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('SheetJS not loaded.'); return }
  const ctx = buildGradingCtx({ classId, subject, students, classes, activities, quizzes, eqScale, prefilled })
  if (!ctx) return
  try {
    const ExcelJS = await ensureExcelJS()
    if (!ExcelJS) throw new Error('ExcelJS unavailable')
    await gradingExcelJS(ExcelJS, ctx)
  } catch {
    gradingSheetJS(XLSX, ctx)
  }
}

/** Export the currently stored grades (prefilled), re-importable via parseGradingSheetImport. */
export async function exportCurrentGrades({ classId, subject, students, classes, activities = [], quizzes = [], eqScale = DEFAULT_EQ_SCALE }) {
  return exportGradingSheet({ classId, subject, students, classes, activities, quizzes, eqScale, prefilled: true })
}

// ── Parser ───────────────────────────────────────────────────────────────────
function toN(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}
function avgNonNull(vals) {
  const nums = vals.filter(x => x !== null && x !== undefined && !isNaN(x))
  if (!nums.length) return null
  return round2(nums.reduce((s, x) => s + Number(x), 0) / nums.length)
}

/**
 * Read a grading workbook back into per-student score records.
 * v2 (single "Grades" + "Meta" sheet) is preferred; falls back to the legacy
 * multi-sheet format so older downloads still import.
 *
 * @returns {{ studentId, actScores:(number|null)[], qzScores:(number|null)[],
 *   nApp:number, nAppQz:number, attitude:number|null, mtExam:number|null,
 *   ftExam:number|null, actAvg:number|null, qzAvg:number|null }[]}
 */
export function parseGradingSheetImport(workbook) {
  const XLSX = window.XLSX
  if (!XLSX) throw new Error('SheetJS not loaded')
  if (workbook.Sheets?.['Grades'] && workbook.Sheets?.['Meta']) {
    return parseGradingV2(XLSX, workbook)
  }
  return parseGradingLegacy(XLSX, workbook)
}

function parseGradingV2(XLSX, workbook) {
  const metaAoa = XLSX.utils.sheet_to_json(workbook.Sheets['Meta'], { header: 1, defval: '' })
  const m = {}
  metaAoa.forEach(([k, v]) => { if (k) m[String(k)] = v })
  const num = (k, d) => { const n = parseInt(m[k], 10); return isNaN(n) ? d : n }

  const nApp    = num('nApp', 0)
  const nAppQz  = num('nAppQz', 0)
  const actStart = num('actStart', 3)
  const actEnd   = num('actEnd', 0)
  const qzStart  = num('qzStart', 0)
  const qzEnd    = num('qzEnd', 0)
  const cAtt     = num('attitude', 0)
  const cMtex    = num('mtex', 0)
  const cFtex    = num('ftex', 0)
  const dataRow  = num('dataRow', DATA_ROW)

  const aoa = XLSX.utils.sheet_to_json(workbook.Sheets['Grades'], { header: 1, defval: '' })
  const dataRows = aoa.slice(dataRow - 1)

  const out = []
  for (const row of dataRows) {
    const id = String(row[0] ?? '').trim()
    if (!id) continue
    const actScores = actEnd >= actStart ? row.slice(actStart - 1, actEnd).map(toN) : []
    const qzScores  = qzEnd  >= qzStart  ? row.slice(qzStart - 1, qzEnd).map(toN)  : []
    out.push({
      studentId: id,
      actScores,
      qzScores,
      nApp,
      nAppQz,
      attitude: cAtt ? toN(row[cAtt - 1]) : null,
      mtExam:   cMtex ? toN(row[cMtex - 1]) : null,
      ftExam:   cFtex ? toN(row[cFtex - 1]) : null,
      actAvg: avgNonNull(actScores),
      qzAvg:  avgNonNull(qzScores),
    })
  }
  return out
}

// Legacy 5-sheet format (Activities | Quizzes | Exams & Attendance | …).
function parseGradingLegacy(XLSX, workbook) {
  const LEGACY_DATA = 3
  const toAoa = name => {
    const ws = workbook.Sheets[name]
    return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) : []
  }
  const actRows  = toAoa('Activities').slice(LEGACY_DATA)
  const qzRows   = toAoa('Quizzes').slice(LEGACY_DATA)
  const examRows = toAoa('Exams & Attendance').slice(LEGACY_DATA)
  if (!examRows.length && !actRows.length) {
    throw new Error('Unrecognized file — please download a fresh template from AcadFlow.')
  }

  const actMap = {}, qzMap = {}, examMap = {}
  for (const row of actRows) {
    const id = String(row[1] ?? '').trim(); if (!id) continue
    const scores = row.slice(2, 12).map(toN)
    actMap[id] = { scores, avg: avgNonNull(scores) ?? toN(row[12]) ?? toN(row[13]) }
  }
  for (const row of qzRows) {
    const id = String(row[1] ?? '').trim(); if (!id) continue
    const scores = row.slice(2, 7).map(toN)
    qzMap[id] = { scores, avg: avgNonNull(scores) ?? toN(row[7]) }
  }
  for (const row of examRows) {
    const id = String(row[1] ?? '').trim(); if (!id) continue
    examMap[id] = { mtExam: toN(row[8]), ftExam: toN(row[9]) }
  }
  const ids = new Set([...Object.keys(actMap), ...Object.keys(qzMap), ...Object.keys(examMap)])
  return [...ids].map(id => ({
    studentId: id,
    actScores: actMap[id]?.scores ?? [],
    qzScores:  qzMap[id]?.scores ?? [],
    nApp: 0,
    nAppQz: 0,
    attitude: null,
    mtExam: examMap[id]?.mtExam ?? null,
    ftExam: examMap[id]?.ftExam ?? null,
    actAvg: actMap[id]?.avg ?? null,
    qzAvg:  qzMap[id]?.avg ?? null,
  }))
}
