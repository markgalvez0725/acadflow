// ── iCalendar (.ics) generation ───────────────────────────────────────────
// Pure helpers — no dependencies. Produces RFC 5545 VEVENTs that import into
// Google Calendar, Apple Calendar, Outlook, etc.

function pad(n) { return String(n).padStart(2, '0') }

// UTC timestamp form: 20260620T133000Z
function toICSDate(ms) {
  const d = new Date(ms)
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  )
}

function esc(text = '') {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Fold lines longer than 75 octets per spec (keeps strict parsers happy).
function fold(line) {
  if (line.length <= 73) return line
  const chunks = []
  let s = line
  chunks.push(s.slice(0, 73))
  s = s.slice(73)
  while (s.length > 72) { chunks.push(' ' + s.slice(0, 72)); s = s.slice(72) }
  if (s.length) chunks.push(' ' + s)
  return chunks.join('\r\n')
}

/**
 * @param {Array<{uid:string,title:string,description?:string,start:number,end?:number,url?:string}>} events
 * @param {string} calName
 * @returns {string} ICS text
 */
export function buildICS(events = [], calName = 'AcadFlow') {
  const now = toICSDate(Date.now())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AcadFlow//Academic Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
  ]
  events.forEach((ev) => {
    const start = ev.start
    const end = ev.end || ev.start + 60 * 60 * 1000 // default 1h
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${esc(ev.uid)}@acadflow`)
    lines.push(`DTSTAMP:${now}`)
    lines.push(`DTSTART:${toICSDate(start)}`)
    lines.push(`DTEND:${toICSDate(end)}`)
    lines.push(fold(`SUMMARY:${esc(ev.title)}`))
    if (ev.description) lines.push(fold(`DESCRIPTION:${esc(ev.description)}`))
    if (ev.url) lines.push(fold(`URL:${esc(ev.url)}`))
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/** Trigger a browser download of an .ics file. */
export function downloadICS(filename, icsText) {
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.ics') ? filename : filename + '.ics'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
