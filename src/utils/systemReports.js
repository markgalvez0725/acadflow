// ── System reports: aggregation + PDF/Excel builders ──────────────────────
// Turns the raw telemetry device-day docs (see src/utils/telemetry.js) into
// the numbers the System reports tab shows and into downloadable documents.
// PDF rides the SAME branded template every academic export uses
// (reportTemplate.js + window.jspdf autoTable); Excel rides window.XLSX.
// Everything aggregates on the professor's device - no server.

import { drawReportHeader, drawReportFooter, tableHeadStyles, headUnderline, REPORT_ACCENTS } from '@/export/reportTemplate.js'
import { preloadPdfFonts } from '@/export/pdfFonts.js'

function median(arr) {
  const a = (arr || []).filter(n => typeof n === 'number' && n > 0).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2)
}

function fmtDay(day) {
  const s = String(day || '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
}

function pct(n) {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`
}

function ms(n) {
  if (n === null || n === undefined) return 'n/a'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

function browserOf(ua) {
  const u = String(ua || '')
  if (u.includes('Edg/')) return 'Edge'
  if (u.includes('SamsungBrowser')) return 'Samsung'
  if (u.includes('Chrome/')) return 'Chrome'
  if (u.includes('Safari/') && u.includes('Version/')) return 'Safari'
  if (u.includes('Firefox/')) return 'Firefox'
  return 'Other'
}

/** One pass over the fetched device-day rows -> everything the tab and the
 *  exports need. `meetings` (ended meeting docs) backfills the reliability
 *  section with joinLog data that predates telemetry. */
export function aggregateTelemetry(rows, meetings = [], sinceTs = 0) {
  const list = Array.isArray(rows) ? rows : []
  const devices = new Set(list.map(r => r.dev).filter(Boolean))
  let sessions = 0
  let errSes = 0
  let chunkFail = 0
  let saveFail = 0
  let offline = 0
  let slow = 0
  let long = 0
  let memMax = 0
  const boots = []
  const lcps = []
  const errMap = new Map()
  const meetMap = new Map()
  const browsers = {}

  for (const r of list) {
    sessions += r.ses || 0
    errSes += r.errSes || 0
    chunkFail += r.chunkFail || 0
    saveFail += r.saveFail || 0
    offline += r.offline || 0
    slow += r.slow || 0
    long += r.long || 0
    memMax = Math.max(memMax, r.memMax || 0)
    for (const b of r.boot || []) boots.push(b)
    for (const l of r.lcp || []) lcps.push(l)
    const bw = browserOf(r.ua)
    browsers[bw] = (browsers[bw] || 0) + (r.ses || 1)
    for (const e of r.errors || []) {
      const key = e.m
      const hit = errMap.get(key)
      if (hit) {
        hit.n += e.n || 1
        hit.devs.add(r.dev)
        hit.last = Math.max(hit.last, e.t || 0)
      } else {
        errMap.set(key, { m: e.m, src: e.src || '', n: e.n || 1, devs: new Set([r.dev]), last: e.t || 0 })
      }
    }
    for (const m of r.meet || []) {
      const hit = meetMap.get(m.id) || { id: m.id, devs: 0, rec: 0, relay: 0, q: { good: 0, weak: 0, bad: 0 }, dur: 0 }
      hit.devs += 1
      hit.rec += m.rec || 0
      if (m.relay) hit.relay += 1
      if (m.q && hit.q[m.q] !== undefined) hit.q[m.q] += 1
      hit.dur = Math.max(hit.dur, m.dur || 0)
      meetMap.set(m.id, hit)
    }
  }

  const errors = [...errMap.values()]
    .map(e => ({ ...e, devs: e.devs.size }))
    .sort((a, b) => b.n - a.n)

  // Reliability rows: every ended class in range (joinLog backfill), merged
  // with whatever quality telemetry devices reported for the same meeting.
  const meets = (meetings || [])
    .filter(m => m.status === 'ended' && (m.endedAt || m.scheduledAt || 0) >= sinceTs)
    .map(m => {
      const t = meetMap.get(m.id)
      const durMs = m.endedAt && m.scheduledAt ? m.endedAt - m.scheduledAt : 0
      return {
        id: m.id,
        title: m.title || 'Class',
        className: m.className || '',
        when: m.scheduledAt || 0,
        provider: m.provider === 'inapp' ? 'In-app' : 'Link',
        joins: (m.joinLog || []).length,
        durMin: durMs > 0 && durMs < 12 * 3600000 ? Math.round(durMs / 60000) : null,
        reconnects: t ? t.rec : null,
        reporting: t ? t.devs : 0,
        relayShare: t && t.devs ? t.relay / t.devs : null,
        weakShare: t && t.devs ? (t.q.weak + t.q.bad) / t.devs : null,
      }
    })
    .sort((a, b) => b.when - a.when)
  const reconTotal = meets.reduce((n, m) => n + (m.reconnects || 0), 0)

  return {
    devices: devices.size,
    sessions,
    errSes,
    crashFree: sessions > 0 ? Math.max(0, 1 - errSes / sessions) : null,
    errorsTotal: errors.reduce((n, e) => n + e.n, 0),
    errors,
    chunkFail,
    saveFail,
    offline,
    slow,
    long,
    memMax,
    bootMed: median(boots),
    lcpMed: median(lcps),
    browsers,
    meets,
    reconTotal,
    days: new Set(list.map(r => r.day)).size,
  }
}

// ── Shared PDF scaffolding ─────────────────────────────────────────────────

const SYS_ACCENT = REPORT_ACCENTS.quiz // purple, matches the app's brand ink

function statBar(doc, y, stats) {
  const pageW = doc.internal.pageSize.getWidth()
  const w = (pageW - 28) / stats.length
  doc.setFontSize(8.5)
  stats.forEach((s, i) => {
    const x = 14 + i * w
    doc.setFillColor(246, 246, 250)
    doc.roundedRect(x + 1, y, w - 2, 14, 1.5, 1.5, 'F')
    doc.setTextColor(90, 90, 100)
    doc.text(String(s.label), x + 4, y + 5)
    doc.setTextColor(30, 30, 40)
    doc.setFontSize(11)
    doc.text(String(s.value), x + 4, y + 11.5)
    doc.setFontSize(8.5)
  })
  return y + 19
}

function sysTable(doc, y, head, body) {
  doc.autoTable({
    startY: y,
    head: [head],
    body,
    margin: { left: 14, right: 14 },
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: tableHeadStyles(),
    didDrawCell: headUnderline(doc, SYS_ACCENT),
  })
  return (doc.lastAutoTable ? doc.lastAutoTable.finalY : y) + 8
}

// ── Report sections (each writes onto the current page and returns y) ─────

function secStability(doc, y, agg) {
  y = statBar(doc, y, [
    { label: 'Crash-free sessions', value: pct(agg.crashFree) },
    { label: 'Sessions', value: agg.sessions },
    { label: 'Errors', value: agg.errorsTotal },
    { label: 'Chunk-load failures', value: agg.chunkFail },
  ])
  return sysTable(doc, y,
    ['Error', 'Where', 'Count', 'Devices'],
    agg.errors.slice(0, 25).map(e => [e.m, e.src, e.n, e.devs]))
}

function secPerformance(doc, y, agg) {
  y = statBar(doc, y, [
    { label: 'Median app start', value: ms(agg.bootMed) },
    { label: 'Median first paint (LCP)', value: ms(agg.lcpMed) },
    { label: 'Long tasks', value: agg.long },
    { label: 'Peak JS memory', value: agg.memMax ? `${agg.memMax} MB` : 'n/a' },
  ])
  const rows = Object.entries(agg.browsers).sort((a, b) => b[1] - a[1]).map(([b, n]) => [b, n])
  return sysTable(doc, y, ['Browser', 'Sessions'], rows)
}

function secReliability(doc, y, agg) {
  y = statBar(doc, y, [
    { label: 'Classes held', value: agg.meets.length },
    { label: 'Reconnects', value: agg.reconTotal },
    { label: 'Devices reporting', value: agg.devices },
    { label: 'Offline events', value: agg.offline },
  ])
  return sysTable(doc, y,
    ['Class', 'Date', 'Type', 'Joins', 'Minutes', 'Reconnects', 'Relay share', 'Weak share'],
    agg.meets.slice(0, 30).map(m => [
      `${m.title}${m.className ? ` (${m.className})` : ''}`,
      m.when ? new Date(m.when).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '',
      m.provider,
      m.joins,
      m.durMin === null ? '' : m.durMin,
      m.reconnects === null ? 'no data' : m.reconnects,
      m.relayShare === null ? 'no data' : pct(m.relayShare),
      m.weakShare === null ? 'no data' : pct(m.weakShare),
    ]))
}

function secErrors(doc, y, agg) {
  y = statBar(doc, y, [
    { label: 'Distinct errors', value: agg.errors.length },
    { label: 'Total occurrences', value: agg.errorsTotal },
    { label: 'Devices affected', value: agg.errors.reduce((s, e) => Math.max(s, e.devs), 0) },
    { label: 'Days covered', value: agg.days },
  ])
  return sysTable(doc, y,
    ['Error', 'Where', 'Count', 'Devices', 'Last seen'],
    agg.errors.map(e => [
      e.m, e.src, e.n, e.devs,
      e.last ? new Date(e.last).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
    ]))
}

function secRobustness(doc, y, agg) {
  y = statBar(doc, y, [
    { label: 'Failed saves', value: agg.saveFail },
    { label: 'Offline events', value: agg.offline },
    { label: 'Slow-connection events', value: agg.slow },
    { label: 'Chunk-load failures', value: agg.chunkFail },
  ])
  doc.setFontSize(8.5)
  doc.setTextColor(90, 90, 100)
  doc.text('Failed saves are writes that timed out or were rejected; the app keeps the draft and the user retried.', 14, y + 2)
  return y + 8
}

const SECTIONS = {
  stability: { title: 'Stability report', draw: secStability },
  performance: { title: 'Performance report', draw: secPerformance },
  reliability: { title: 'Class reliability report', draw: secReliability },
  errors: { title: 'Bugs and errors report', draw: secErrors },
  robustness: { title: 'Robustness report', draw: secRobustness },
}

/** Build + download one report (or kind='full' for all five) as PDF. */
export async function buildSystemPdf(kind, agg, rangeLabel) {
  if (!window.jspdf) throw new Error('PDF library not loaded. Check your connection and reload.')
  await preloadPdfFonts()
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  if (typeof doc.autoTable !== 'function') throw new Error('PDF table plugin failed to load. Reload and try again.')

  const kinds = kind === 'full' ? Object.keys(SECTIONS) : [kind]
  const sub = `${rangeLabel} · ${agg.devices} devices · ${agg.sessions} sessions`
  kinds.forEach((k, i) => {
    if (i > 0) doc.addPage()
    const sec = SECTIONS[k]
    const y = drawReportHeader(doc, { title: `AcadFlow ${sec.title.toLowerCase()}`, subtitle: sub, accent: SYS_ACCENT })
    sec.draw(doc, y + 4, agg)
    drawReportFooter(doc, { note: 'Technical telemetry only - no student data. Generated on-device.' })
  })
  doc.save(`AcadFlow_${kind}_report_${new Date().toISOString().slice(0, 10)}.pdf`)
}

/** Build + download one report (or 'full') as an Excel workbook. */
export function buildSystemXlsx(kind, agg, rangeLabel) {
  const XLSX = window.XLSX
  if (!XLSX) throw new Error('Excel library not loaded. Check your connection and reload.')
  const wb = XLSX.utils.book_new()
  const kinds = kind === 'full' ? Object.keys(SECTIONS) : [kind]

  const summary = [
    ['AcadFlow system report', rangeLabel],
    [],
    ['Devices reporting', agg.devices],
    ['Sessions', agg.sessions],
    ['Crash-free sessions', pct(agg.crashFree)],
    ['Errors (total)', agg.errorsTotal],
    ['Chunk-load failures', agg.chunkFail],
    ['Failed saves', agg.saveFail],
    ['Offline events', agg.offline],
    ['Slow-connection events', agg.slow],
    ['Median app start (ms)', agg.bootMed || ''],
    ['Median LCP (ms)', agg.lcpMed || ''],
    ['Long tasks', agg.long],
    ['Peak JS memory (MB)', agg.memMax || ''],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')

  if (kinds.includes('errors') || kinds.includes('stability')) {
    const rows = [['Error', 'Where', 'Count', 'Devices', 'Last seen'],
      ...agg.errors.map(e => [e.m, e.src, e.n, e.devs, e.last ? new Date(e.last).toLocaleString('en-PH') : ''])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Errors')
  }
  if (kinds.includes('reliability')) {
    const rows = [['Class', 'Class group', 'Date', 'Type', 'Joins', 'Minutes', 'Reconnects', 'Relay share', 'Weak share'],
      ...agg.meets.map(m => [
        m.title, m.className, m.when ? new Date(m.when).toLocaleDateString('en-PH') : '', m.provider,
        m.joins, m.durMin === null ? '' : m.durMin,
        m.reconnects === null ? 'no data' : m.reconnects,
        m.relayShare === null ? 'no data' : pct(m.relayShare),
        m.weakShare === null ? 'no data' : pct(m.weakShare),
      ])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Classes')
  }
  if (kinds.includes('performance')) {
    const rows = [['Browser', 'Sessions'], ...Object.entries(agg.browsers).sort((a, b) => b[1] - a[1])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Browsers')
  }
  XLSX.writeFile(wb, `AcadFlow_${kind}_report_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export { pct as sysPct, ms as sysMs, fmtDay as sysDay }
