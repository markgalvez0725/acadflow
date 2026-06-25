// ── On-device import verification ("AI check") ─────────────────────────────
// Custom, in-browser check that a filled-in student-import file looks right —
// the same on-device-AI approach the app uses elsewhere (photoVerifyAI,
// identityVerify): nothing leaves the device, runs instantly, $0. It produces
// soft *warnings* (advisory, non-blocking) that complement the hard validation
// in the import modal (missing id/name/course, bad student-no, duplicates).
//
//   verifyImportRows(rows, { classes, students }) → { [rowIndex]: string[] }
//
// Only rows with at least one warning appear in the map. Warnings never block an
// import — they flag rows a teacher should eyeball before committing.

import { COURSES } from '@/constants/courses.js'
import { splitStudentName } from '@/utils/studentName.js'
import { eligibleForClass } from '@/utils/enrollment.js'

const norm = v => String(v ?? '').trim().toLowerCase()

// The template's example row — flag it if it was left in.
const EXAMPLE_ID = '2024-10001'

function isKnownCourse(course) {
  const c = norm(course)
  return !!c && COURSES.some(x => norm(x) === c)
}

/**
 * Heuristic "did they fill it out right?" pass over parsed import rows.
 * @param {{id,name,course,year,section}[]} rows  parsed rows (post course-expand)
 * @param {{ classes?: object[], students?: object[] }} ctx
 * @returns {Object<number,string[]>} rowIndex → list of warning messages
 */
export function verifyImportRows(rows, { classes = [] } = {}) {
  const out = {}
  const activeClasses = (classes || []).filter(c => !c.archived)
  const hasActive = activeClasses.length > 0

  // First occurrence of each name, for in-file duplicate detection.
  const nameFirstSeen = {}
  rows.forEach((r, i) => {
    const key = norm(r.name)
    if (key && !(key in nameFirstSeen)) nameFirstSeen[key] = i
  })

  rows.forEach((r, i) => {
    const msgs = []

    // 1) Example/placeholder row left in.
    if (norm(r.id) === EXAMPLE_ID) {
      msgs.push("Looks like the template's example row — replace it or delete it.")
    }

    // 2) Course present but not one of the four programs (typo / wrong code).
    if (r.course && !isKnownCourse(r.course)) {
      msgs.push(`Course "${r.course}" isn't one of the 4 programs — check the spelling.`)
    }

    // 3) Year level not 1st–4th.
    if (r.year) {
      const y = parseInt(String(r.year).match(/(\d)/)?.[1] || '', 10)
      if (!(y >= 1 && y <= 4)) msgs.push(`Year level "${r.year}" should be 1st, 2nd, 3rd, or 4th Year.`)
    }

    // 4) Name shape — needs both a surname and a first name; no digits.
    if (r.name) {
      if (/\d/.test(r.name)) {
        msgs.push('Name contains numbers — check the Surname / First Name columns.')
      } else {
        const n = splitStudentName(r.name)
        if (!n.last || !n.first) msgs.push('Name may be missing a surname or first name.')
      }
    }

    // 5) Section / class matching — does any current class actually accept them?
    if (!r.section) {
      msgs.push("No section — the student won't be matched to a class.")
    } else if (hasActive && r.course && isKnownCourse(r.course)) {
      const pseudo = { course: r.course, year: r.year, section: r.section }
      const matches = activeClasses.some(c => eligibleForClass(pseudo, c, []))
      if (!matches) {
        msgs.push(`No current class matches ${r.year || '?'} · section ${r.section} — student won't be enrolled.`)
      }
    }

    // 6) Duplicate name within the file (+2 → spreadsheet row number).
    const key = norm(r.name)
    if (key && nameFirstSeen[key] !== i) {
      msgs.push(`Same name as row ${nameFirstSeen[key] + 2} — possible duplicate.`)
    }

    if (msgs.length) out[i] = msgs
  })

  return out
}
