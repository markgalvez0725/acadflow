// ── Smart Insights engine ─────────────────────────────────────────────────
// Deterministic, on-device "assistant" - no external AI, no API key, no
// network. It reads the same data the app already computes and turns it into
// plain-language summaries and suggestions. Pure functions only.
import { getGWA, getAttRate, computeFinalGradeFromTerms } from '@/utils/grades'

const PASS = 75
const COND_FLOOR = 71
const ATT_FLOOR = 80
const EXCEL = 90

function enrolledIdsOf(s) {
  return s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : [])
}

function subjectsOf(s, classes) {
  const ids = enrolledIdsOf(s)
  return ids.length
    ? [...new Set(ids.flatMap(id => classes.find(c => c.id === id)?.subjects || []))]
    : Object.keys(s.grades || {})
}

function subjectGrade(s, sub) {
  const comp = s.gradeComponents?.[sub] || {}
  return computeFinalGradeFromTerms(comp.midterm ?? null, comp.finals ?? null) ?? s.grades?.[sub] ?? null
}

function hasCompleteGrades(s, classes) {
  return subjectsOf(s, classes).some(sub => {
    const comp = s.gradeComponents?.[sub] || {}
    return comp.midterm != null && comp.finals != null
  })
}

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'there'
}

function joinNames(list, max = 3) {
  const names = list.map(s => s.name || s.id)
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

/**
 * Class / school-wide insights for the admin dashboard.
 * @returns {{tone:'good'|'warn'|'bad', headline:string, summary:string, items:Array<{type:string,text:string}>}}
 */
export function generateClassInsights(students = [], classes = []) {
  const items = []
  if (!students.length) {
    return { tone: 'info', headline: 'No students yet', summary: 'Add students and record grades to see insights here.', items: [] }
  }

  const gwas = [], atts = []
  let passed = 0, conditional = 0, failed = 0, pending = 0
  const atRisk = [], lowAtt = [], top = []

  students.forEach(s => {
    const g = getGWA(s, classes)
    const complete = hasCompleteGrades(s, classes)
    if (g !== null) gwas.push(g)
    if (g === null || !complete) pending++
    else if (g >= PASS) passed++
    else if (g >= COND_FLOOR) conditional++
    else failed++

    if (g !== null && complete && g < PASS) atRisk.push(s)
    if (g !== null && complete && g >= EXCEL) top.push(s)

    const r = getAttRate(s, students, classes)
    if (r !== null) atts.push(r)
    if (r !== null && r < ATT_FLOOR) lowAtt.push(s)
  })

  const avgGwa = gwas.length ? (gwas.reduce((a, b) => a + b, 0) / gwas.length) : null
  const avgAtt = atts.length ? (atts.reduce((a, b) => a + b, 0) / atts.length) : null

  const summary = [
    `Across ${students.length} student${students.length !== 1 ? 's' : ''}`,
    avgGwa != null ? `the average GWA is ${avgGwa.toFixed(1)}` : 'grades are still being recorded',
    avgAtt != null ? `and attendance averages ${avgAtt.toFixed(0)}%` : null,
  ].filter(Boolean).join(', ') + '.'

  // Lowest-performing class (to focus on)
  let weakestClass = null
  classes.filter(c => !c.archived).forEach(c => {
    const enrolled = students.filter(s => s.classId === c.id || s.classIds?.includes(c.id))
    const cg = enrolled.map(s => getGWA(s, classes)).filter(g => g !== null)
    if (cg.length) {
      const avg = cg.reduce((a, b) => a + b, 0) / cg.length
      if (!weakestClass || avg < weakestClass.avg) weakestClass = { name: `${c.name}${c.section ? ' ' + c.section : ''}`, avg }
    }
  })

  if (atRisk.length) {
    items.push({ type: 'risk', text: `${atRisk.length} student${atRisk.length !== 1 ? 's are' : ' is'} below passing (75): ${joinNames(atRisk)}. Consider one-on-one check-ins or a remedial activity.` })
  }
  if (lowAtt.length) {
    items.push({ type: 'warn', text: `${lowAtt.length} student${lowAtt.length !== 1 ? 's have' : ' has'} attendance under ${ATT_FLOOR}%: ${joinNames(lowAtt)}. Low attendance often precedes grade drops, so a quick follow-up helps.` })
  }
  if (weakestClass && avgGwa != null && weakestClass.avg < avgGwa - 3) {
    items.push({ type: 'info', text: `${weakestClass.name} has the lowest class average (${weakestClass.avg.toFixed(1)}). A review session or adjusted pacing could lift it.` })
  }
  if (pending > 0) {
    items.push({ type: 'info', text: `${pending} student${pending !== 1 ? 's are' : ' is'} missing complete grades. Finalizing midterm and finals will unlock accurate standing and remarks.` })
  }
  if (top.length) {
    items.push({ type: 'positive', text: `${top.length} student${top.length !== 1 ? 's are' : ' is'} excelling (GWA ≥ ${EXCEL}): ${joinNames(top)}. They could mentor peers or take on enrichment work.` })
  }
  if (!atRisk.length && !lowAtt.length && passed > 0) {
    items.push({ type: 'positive', text: `No students are currently at risk or below the attendance threshold. The cohort is on track.` })
  }

  const tone = atRisk.length || failed ? 'bad' : (lowAtt.length || conditional ? 'warn' : 'good')
  const headline = atRisk.length
    ? `${atRisk.length} student${atRisk.length !== 1 ? 's' : ''} need attention`
    : lowAtt.length
      ? `Attendance to watch for ${lowAtt.length}`
      : 'Class is on track'

  return { tone, headline, summary, items }
}

/**
 * Personal study-coach insights for a student's overview.
 * @returns {{tone:string, headline:string, summary:string, items:Array<{type:string,text:string}>}}
 */
export function generateStudentInsights(s, { classes = [], students = [], activities = [], quizzes = [] } = {}) {
  if (!s) return { tone: 'info', headline: '', summary: '', items: [] }

  const ids = enrolledIdsOf(s)
  const subs = subjectsOf(s, classes)
  const gwa = getGWA(s, classes)
  const att = getAttRate(s, students, classes)
  const now = Date.now()
  const items = []

  // Per-subject strengths / focus
  const graded = subs.map(sub => ({ sub, g: subjectGrade(s, sub) })).filter(x => x.g != null)
  const strong = graded.filter(x => x.g >= 85).sort((a, b) => b.g - a.g)
  const focus = graded.filter(x => x.g < PASS).sort((a, b) => a.g - b.g)
  const shaky = graded.filter(x => x.g >= PASS && x.g < 80).sort((a, b) => a.g - b.g)

  // Missing submissions (not submitted, not past due)
  const missing = activities.filter(a => {
    if (!ids.includes(a.classId)) return false
    const sub = (a.submissions || {})[s.id]
    if (sub?.link) return false
    if (a.deadline && now > a.deadline) return false
    return true
  })
  // Upcoming deadlines within 7 days
  const soon = missing
    .filter(a => a.deadline && a.deadline - now <= 7 * 864e5)
    .sort((a, b) => a.deadline - b.deadline)

  // Open quizzes not yet taken
  const openQuizzes = quizzes.filter(q =>
    q.classIds?.some(id => ids.includes(id)) && now >= q.openAt && now <= q.closeAt && !q.submissions?.[s.id]
  )

  const fname = firstName(s.name)
  const summary = gwa != null
    ? `${fname}, your GWA is ${gwa.toFixed(2)}${att != null ? ` and your attendance is ${att.toFixed(0)}%` : ''}.`
    : `${fname}, your grades are still being finalized. Here is what to focus on meanwhile.`

  if (strong.length) {
    items.push({ type: 'positive', text: `You're strong in ${strong.slice(0, 3).map(x => x.sub).join(', ')}. Keep that momentum.` })
  }
  if (focus.length) {
    items.push({ type: 'risk', text: `${focus.slice(0, 3).map(x => x.sub).join(', ')} ${focus.length === 1 ? 'is' : 'are'} below passing. Prioritize these: attend every session and submit all activities to recover points.` })
  } else if (shaky.length) {
    items.push({ type: 'warn', text: `${shaky.slice(0, 2).map(x => x.sub).join(' and ')} ${shaky.length === 1 ? 'is' : 'are'} close to the line. A little extra effort here can bump your standing.` })
  }
  if (att != null && att < ATT_FLOOR) {
    items.push({ type: 'warn', text: `Your attendance is ${att.toFixed(0)}%, under the ${ATT_FLOOR}% mark. Showing up consistently is the easiest way to protect your grade.` })
  }
  if (soon.length) {
    const next = soon[0]
    const when = new Date(next.deadline).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    items.push({ type: 'warn', text: `${soon.length} deadline${soon.length !== 1 ? 's are' : ' is'} coming up this week. Next: "${next.title || 'an activity'}" due ${when}.` })
  } else if (missing.length) {
    items.push({ type: 'info', text: `You have ${missing.length} activity submission${missing.length !== 1 ? 's' : ''} still open. Getting them in early keeps your scores up.` })
  }
  if (openQuizzes.length) {
    items.push({ type: 'info', text: `${openQuizzes.length} quiz${openQuizzes.length !== 1 ? 'zes are' : ' is'} open for you right now. Take ${openQuizzes.length !== 1 ? 'them' : 'it'} before the window closes.` })
  }
  if (!items.length) {
    items.push({ type: 'positive', text: `You're all caught up with nothing flagged. Keep up the steady work.` })
  }

  const tone = focus.length ? 'bad' : (att != null && att < ATT_FLOOR) || soon.length || shaky.length ? 'warn' : 'good'
  const headline = focus.length
    ? "Let's lift a few subjects"
    : tone === 'warn' ? 'A couple of things to stay on top of' : "You're in good standing"

  return { tone, headline, summary, items }
}
