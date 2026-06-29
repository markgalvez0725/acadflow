// ── On-device group-paste verification ("Smart check") ────────────────────────
// The professor builds a grouping in Excel, copies the cells, and pastes them into
// the Custom groups panel. Excel puts a tab between columns and a newline between
// rows, so the clipboard is plain TSV - parseGroupPaste() turns that into rows and
// verifyGroupRows() matches each row to the class roster, flags anything that looks
// off, and assembles the ready-to-apply groups[] in the SAME shape the manual
// builder uses ({ id, name, memberIds }).
//
// Mirrors the established on-device-Smart pattern (importVerifySmart,
// gradeImportVerifySmart): pure, deterministic, nothing leaves the device, $0.
// Warnings are advisory - a row is APPLIED when it matches a student in this class
// and carries a valid group number; only hard problems (no match, not in this
// class, blank/invalid group, duplicate) are skipped.

import { splitStudentName, buildStudentName } from '@/utils/studentName.js'
import { courseShort } from '@/constants/courses.js'

const norm = v => String(v ?? '').trim().toLowerCase()
const yearDigit = v => parseInt(String(v ?? '').match(/(\d)/)?.[1] || '', 10) || null

// Canonical column order the panel asks the professor to match in Excel.
export const GROUP_COLUMNS = ['Student ID', 'Surname', 'First name', 'M.I.', 'Group #', 'Course', 'Subject', 'Section', 'Year']
const FIELD_ORDER = ['id', 'surname', 'first', 'mi', 'group', 'course', 'subject', 'section', 'year']

// Map a header cell to a field key (so a pasted header row in any sensible order
// still lines up). Returns null for an unrecognized header.
function headerField(cell) {
  const c = norm(cell)
  if (!c) return null
  if (/student\s*(id|no|number)|^id$|^no\.?$/.test(c)) return 'id'
  if (/surname|last\s*name|family/.test(c)) return 'surname'
  if (/first\s*name|^first$|given/.test(c)) return 'first'
  if (/^m\.?\s*i\.?$|^mi$|middle/.test(c)) return 'mi'
  if (/group/.test(c)) return 'group'
  if (/course|program|strand/.test(c)) return 'course'
  if (/subject/.test(c)) return 'subject'
  if (/section/.test(c)) return 'section'
  if (/year|level/.test(c)) return 'year'
  if (/^name$|full\s*name|student\s*name/.test(c)) return 'name'
  return null
}

function rowLooksLikeHeader(cells) {
  return cells.some(c => headerField(c) !== null) && !cells.some(c => /^\d{3,}/.test(String(c).trim()))
}

// Build a positional field map from a detected header row.
function mapFromHeader(cells) {
  const order = cells.map(headerField)
  // Fall back to the canonical order for any column the header didn't name.
  return order.map((f, i) => f || FIELD_ORDER[i] || null)
}

function cellsToRow(cells, order) {
  const row = {}
  order.forEach((field, i) => {
    if (!field) return
    const v = (cells[i] ?? '').trim()
    if (!v) return
    if (field === 'name') {
      // A single Name column instead of split parts - derive surname/first/mi.
      const n = splitStudentName(v)
      if (!row.surname) row.surname = n.last
      if (!row.first) row.first = n.first
      if (!row.mi) row.mi = n.middle
    } else {
      row[field] = v
    }
  })
  return row
}

/**
 * Parse clipboard text copied from an Excel selection into raw row objects.
 * Tolerates a header row (in any column order) and a single combined Name column.
 * @param {string} text  TSV from the clipboard (\t between cells, \n between rows)
 * @returns {{id?,surname?,first?,mi?,group?,course?,subject?,section?,year?}[]}
 */
export function parseGroupPaste(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim() !== '')
  if (!lines.length) return []
  const grid = lines.map(l => l.split('\t'))

  let order = FIELD_ORDER
  let start = 0
  if (rowLooksLikeHeader(grid[0])) { order = mapFromHeader(grid[0]); start = 1 }

  const rows = []
  for (let i = start; i < grid.length; i++) {
    const row = cellsToRow(grid[i], order)
    // Skip a wholly empty line.
    if (Object.keys(row).length) rows.push(row)
  }
  return rows
}

function findStudent(row, roster, allStudents) {
  const id = norm(row.id)
  if (id) {
    const byId = roster.find(s => norm(s.id) === id)
    if (byId) return { student: byId, by: 'id', inClass: true }
  }
  const canonical = norm(buildStudentName(row.surname, row.first, row.mi))
  const sf = norm(row.surname) + '|' + norm(row.first)
  const nameEq = s => {
    if (canonical && norm(s.name) === canonical) return true
    const n = splitStudentName(s.name)
    return !!row.surname && !!row.first && norm(n.last) + '|' + norm(n.first) === sf
  }
  const byName = roster.find(nameEq)
  if (byName) return { student: byName, by: 'name', inClass: true }

  // Not in this class - is it a real student from elsewhere, or unknown entirely?
  const elsewhere = (allStudents || []).find(s => (id && norm(s.id) === id) || nameEq(s))
  if (elsewhere) return { student: elsewhere, by: id ? 'id' : 'name', inClass: false }
  return { student: null, by: null, inClass: false }
}

// Normalize a group cell to a stable key + display label. Pulls a number out of
// "Group 3" / "G3" / "3"; falls back to the uppercased token (e.g. "A").
function groupKey(raw) {
  const v = String(raw ?? '').trim()
  if (!v) return null
  const digits = v.match(/\d+/)
  if (digits) return { key: 'n:' + parseInt(digits[0], 10), num: parseInt(digits[0], 10), label: `Group ${parseInt(digits[0], 10)}` }
  const tok = v.toUpperCase()
  return { key: 't:' + tok, num: null, label: `Group ${tok}` }
}

/**
 * Verify pasted group rows against the class roster and assemble groups[].
 * @param {object[]} rows  output of parseGroupPaste()
 * @param {{ roster: object[], allStudents?: object[], classMeta?: object }} ctx
 *        roster = registered students of the SELECTED class
 *        classMeta = { courseName, subject, section } expected for this activity
 * @returns {{ rows: object[], groups: object[], summary: object }}
 */
export function verifyGroupRows(rows, { roster = [], allStudents = [], classMeta = {} } = {}) {
  const expCourse = norm(courseShort(classMeta.courseName) || classMeta.courseName)
  const expSubject = norm(classMeta.subject)
  const expSection = norm(classMeta.section)

  const assigned = new Set()           // student ids already placed in a group
  const out = []

  rows.forEach((row, i) => {
    const warnings = []
    const { student, by, inClass } = findStudent(row, roster, allStudents)
    const gk = groupKey(row.group)

    let status = 'ok'
    let applied = false

    if (!student) {
      status = 'error'
      warnings.push('Student not found in the roster - check the ID or name.')
    } else if (!inClass) {
      status = 'error'
      warnings.push('Not enrolled in this class - will be skipped.')
    } else if (!gk) {
      status = 'warn'
      warnings.push('No group number - this student stays unassigned.')
    } else if (assigned.has(student.id)) {
      status = 'error'
      warnings.push('Already placed in an earlier row - duplicate skipped.')
    } else {
      applied = true
      assigned.add(student.id)
    }

    // Soft reference-column checks (only meaningful once a student is matched).
    if (student && inClass) {
      if (by === 'name' && !norm(row.id)) warnings.push('Matched by name (no Student ID given).')
      if (row.course && expCourse) {
        const rc = norm(courseShort(row.course) || row.course)
        if (rc !== expCourse && rc !== norm(courseShort(student.course) || student.course)) {
          warnings.push(`Course "${row.course}" does not match this class.`)
        }
      }
      if (row.subject && expSubject && norm(row.subject) !== expSubject) {
        warnings.push(`Subject "${row.subject}" does not match "${classMeta.subject}" - wrong template?`)
      }
      if (row.section && expSection && norm(row.section) !== expSection && norm(row.section) !== norm(student.section)) {
        warnings.push(`Section "${row.section}" does not match this class.`)
      }
      if (row.year) {
        const ry = yearDigit(row.year), sy = yearDigit(student.year)
        if (ry && sy && ry !== sy) warnings.push(`Year "${row.year}" does not match the student's records.`)
      }
      // Promote an applied row to "warn" when it carries any advisory note.
      if (applied && warnings.length) status = 'warn'
    }

    out.push({
      i,
      id: row.id || (student ? student.id : ''),
      surname: row.surname || '',
      first: row.first || '',
      mi: row.mi || '',
      group: row.group || '',
      course: row.course || '',
      subject: row.subject || '',
      section: row.section || '',
      year: row.year || '',
      student: student || null,
      matchedBy: by,
      groupLabel: gk ? gk.label : '',
      groupKey: gk ? gk.key : null,
      groupNum: gk ? gk.num : null,
      applied,
      status,
      warnings,
    })
  })

  // Assemble groups from applied rows, ordered numerically then alphabetically.
  const byKey = new Map()
  out.filter(r => r.applied).forEach(r => {
    if (!byKey.has(r.groupKey)) byKey.set(r.groupKey, { key: r.groupKey, num: r.groupNum, name: r.groupLabel, memberIds: [] })
    byKey.get(r.groupKey).memberIds.push(r.student.id)
  })
  const groups = [...byKey.values()]
    .sort((a, b) => {
      if (a.num != null && b.num != null) return a.num - b.num
      if (a.num != null) return -1
      if (b.num != null) return 1
      return a.name.localeCompare(b.name)
    })
    .map((g, idx) => ({ id: 'g_paste_' + idx + '_' + g.key.replace(/[^a-z0-9]/gi, ''), name: g.name, memberIds: g.memberIds }))

  const summary = {
    total: out.length,
    assigned: out.filter(r => r.applied).length,
    review: out.filter(r => r.applied && r.warnings.length).length,
    skipped: out.filter(r => !r.applied).length,
    notInClass: out.filter(r => r.student && r.matchedBy && !r.applied && r.warnings.some(w => /not enrolled/.test(w))).length,
    unmatched: out.filter(r => !r.student).length,
    groupCount: groups.length,
  }

  return { rows: out, groups, summary }
}
