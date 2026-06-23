// Shared deadline helpers — used by the student Overview "Today" strip and the
// Assignment Tracker so the urgency wording/colour stays consistent.

// Human "time remaining" label for a deadline timestamp.
export function deadlineLabel(deadline, now = Date.now()) {
  const diff = deadline - now
  if (diff <= 0) return 'Overdue'
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `Due in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `Due in ${hrs}h`
  const days = Math.round(hrs / 24)
  return `Due in ${days}d`
}

// Urgency colour: overdue / <24h = red, <72h = amber, otherwise muted.
export function deadlineColor(deadline, now = Date.now()) {
  const diff = deadline - now
  if (diff <= 0) return 'var(--red)'
  const hrs = diff / 3600000
  if (hrs < 24) return 'var(--red)'
  if (hrs < 72) return 'var(--yellow)'
  return 'var(--ink2)'
}
