// ── Case study project plan helpers ─────────────────────────────────────────
// Pure, deterministic logic for the case study project management layer
// (Gantt timeline + member roles + per-member tasks). The plan lives in the
// caseStudyPlans/{csId} companion doc so students never read the grade doc:
//   milestones: [{ id, title, category, note, startAt, dueAt }]  professor-owned
//   roles:      { [studentId]: 'Lead' | ... }                    professor-owned
//   progress:   { [groupId]: { [milestoneId]: { done, at, byName } } }
//   tasks:      { [groupId]: { [taskId]: { title, category, assigneeId,
//                 done, at, byName, createdAt, addedByName } } }
// Step status is always DERIVED from the clock + progress, never stored, so
// there is nothing to keep in sync between the two roles.

export const ROLE_SUGGESTIONS = ['Lead', 'Programmer', 'Assets', 'Docs', 'QA', 'Researcher', 'Presenter']

export const DEFAULT_CATEGORIES = ['Documentation', 'Development', 'Defense']

// Category colors are assigned by order of first appearance in the plan
// (milestones first, then tasks), so both roles derive the SAME color for a
// category without storing anything and two categories never collide until
// the palette wraps.
const CAT_COLORS = ['#8b7ff5', '#2fa87c', '#e0834a', '#d4537e', '#4f9cd8', '#b8973a', '#4fb5c9', '#a76fd1']

export function planId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function fmtShortDay(ts) {
  return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// Ordered unique category names across the plan's milestones and tasks.
export function planCategories(plan) {
  const out = []
  const seen = new Set()
  const add = c => {
    const t = String(c || '').trim()
    if (!t) return
    const k = t.toLowerCase()
    if (!seen.has(k)) { seen.add(k); out.push(t) }
  }
  ;(plan?.milestones || []).forEach(m => add(m.category))
  const tg = plan?.tasks || {}
  Object.keys(tg).sort().forEach(gid => {
    Object.values(tg[gid] || {})
      .filter(t => t && t.title)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach(t => add(t.category))
  })
  return out
}

export function categoryColorMap(plan) {
  const map = {}
  planCategories(plan).forEach((c, i) => { map[c.toLowerCase()] = CAT_COLORS[i % CAT_COLORS.length] })
  return map
}

export function catColor(map, name) {
  return map[String(name || '').trim().toLowerCase()] || 'var(--ink3)'
}

// ── Step status ─────────────────────────────────────────────────────────────
// done | doneLate | behind | active | upcoming
export function stepState(m, rec, now = Date.now()) {
  if (rec?.done) return rec.at && m.dueAt && rec.at > m.dueAt ? 'doneLate' : 'done'
  if (m.dueAt && now > m.dueAt) return 'behind'
  if (m.startAt && now >= m.startAt) return 'active'
  return 'upcoming'
}

// Visual class per state (doneLate renders as done, the meta text says late).
export const STEP_CLS = { done: 'done', doneLate: 'done', behind: 'behind', active: 'active', upcoming: 'upcoming' }

export function stepMetaText(m, rec, st, now = Date.now()) {
  if (st === 'done') return rec?.byName ? `Done · ${rec.byName} · ${fmtShortDay(rec.at)}` : 'Done'
  if (st === 'doneLate') return rec?.byName ? `Done late · ${rec.byName} · ${fmtShortDay(rec.at)}` : 'Done late'
  if (st === 'behind') {
    const days = Math.max(1, Math.ceil((now - m.dueAt) / 86400000))
    return `${days} day${days === 1 ? '' : 's'} late`
  }
  if (st === 'active') return `In progress · due ${fmtShortDay(m.dueAt)}`
  return `${fmtShortDay(m.startAt)} to ${fmtShortDay(m.dueAt)}`
}

// ── Gantt geometry ──────────────────────────────────────────────────────────
export function ganttGeometry(milestones, now = Date.now()) {
  const ms = (milestones || []).filter(m => m.startAt && m.dueAt)
  if (!ms.length) return null
  const min = Math.min(...ms.map(m => m.startAt))
  let max = Math.max(...ms.map(m => m.dueAt))
  if (max - min < 86400000) max = min + 86400000
  const span = max - min
  const pct = ts => Math.max(0, Math.min(100, ((ts - min) / span) * 100))
  const ticks = []
  for (let i = 0; i <= 3; i++) {
    ticks.push({ pct: (i / 3) * 100, label: fmtShortDay(min + (span * i) / 3) })
  }
  const todayPct = now >= min && now <= max ? pct(now) : null
  return { min, max, pct, ticks, todayPct }
}

// ── Progress math ───────────────────────────────────────────────────────────
export function groupStepStats(plan, gid, now = Date.now()) {
  const ms = plan?.milestones || []
  const prog = plan?.progress?.[gid] || {}
  let done = 0
  let behind = 0
  ms.forEach(m => {
    const st = stepState(m, prog[m.id], now)
    if (st === 'done' || st === 'doneLate') done++
    else if (st === 'behind') behind++
  })
  return { done, total: ms.length, behind }
}

// Professor-side aggregate for one milestone bar: how many groups finished it,
// and the bar's overall state (done only when EVERY group finished).
export function milestoneAggregate(plan, m, now = Date.now()) {
  const groups = plan?.groups || []
  const total = groups.length
  let done = 0
  groups.forEach(g => {
    const st = stepState(m, plan?.progress?.[g.id]?.[m.id], now)
    if (st === 'done' || st === 'doneLate') done++
  })
  let state = stepState(m, null, now)
  if (total > 0 && done >= total) state = 'done'
  return { done, total, state }
}

// ── Tasks ───────────────────────────────────────────────────────────────────
export function groupTasks(plan, gid) {
  const map = plan?.tasks?.[gid] || {}
  return Object.entries(map)
    .filter(entry => entry[1] && entry[1].title)
    .map(entry => ({ ...entry[1], id: entry[0] }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export function memberTaskStats(tasksArr, sid) {
  const mine = tasksArr.filter(t => t.assigneeId === sid)
  return { done: mine.filter(t => t.done).length, total: mine.length }
}

export function categoryTaskStats(tasksArr) {
  const order = []
  const stats = {}
  tasksArr.forEach(t => {
    const name = String(t.category || '').trim()
    if (!name) return
    const k = name.toLowerCase()
    if (!stats[k]) { stats[k] = { name, done: 0, total: 0 }; order.push(k) }
    stats[k].total++
    if (t.done) stats[k].done++
  })
  return order.map(k => stats[k])
}

export function isLeadRole(role) {
  return String(role || '').trim().toLowerCase() === 'lead'
}

export function myPlanGroup(plan, sid) {
  return (plan?.groups || []).find(g => (g.memberIds || []).includes(sid)) || null
}

// ── Plan editor helpers ─────────────────────────────────────────────────────
// Starter template spread between "now" and the case study's due date, so the
// professor edits a sensible plan instead of a blank page.
export function seedMilestones(fromTs, dueTs) {
  const start = fromTs || Date.now()
  const end = Math.max(dueTs || 0, start + 5 * 86400000)
  const span = end - start
  const defs = [
    { title: 'Title and scope proposal',    category: 'Documentation', a: 0,    b: 0.13 },
    { title: 'Research and data gathering', category: 'Documentation', a: 0.13, b: 0.43 },
    { title: 'System design draft',         category: 'Development',   a: 0.43, b: 0.7 },
    { title: 'Final paper and revisions',   category: 'Documentation', a: 0.7,  b: 0.92 },
    { title: 'Defense day',                 category: 'Defense',       a: 0.92, b: 1 },
  ]
  return defs.map(d => ({
    id: planId('m'),
    title: d.title,
    category: d.category,
    note: '',
    startAt: Math.round(start + span * d.a),
    dueAt: Math.round(start + span * d.b),
  }))
}

export function tsToDateInput(ts) {
  const d = new Date(ts)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function dateInputToStart(str) {
  return new Date(str + 'T00:00:00').getTime()
}

export function dateInputToDue(str) {
  return new Date(str + 'T23:59:00').getTime()
}
