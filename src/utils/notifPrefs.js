// ── Student notification preferences ──────────────────────────────────────
// Students can mute whole categories of notifications. Preferences live on the
// student record as `notifPrefs` (a map of category → boolean). A category is
// considered muted ONLY when explicitly set to false, so the default — and any
// older record without the field — shows everything.
//
// Filtering is applied at display/badge time (the single place every
// notification path converges), which keeps the many notification writers
// untouched and makes the toggle take effect instantly when changed.

export const NOTIF_CATEGORIES = [
  { key: 'activities',    label: 'Activities',    desc: 'New activities and submission updates' },
  { key: 'grades',        label: 'Grades',        desc: 'When your work is graded' },
  { key: 'messages',      label: 'Messages',      desc: 'Direct messages from your teacher' },
  { key: 'announcements', label: 'Announcements', desc: 'Class announcements' },
  { key: 'meetings',      label: 'Online classes', desc: 'Online class / meeting updates' },
]

// Maps a stored notification item `type` to a preference category.
const TYPE_TO_CATEGORY = {
  act_new:           'activities',
  act_sub:           'activities',
  act_reminder:      'activities',
  quiz_reminder:     'activities',
  act_grade:         'grades',
  msg_in:            'messages',
  msg_out:           'messages',
  mention:           'messages',
  announce:          'announcements',
  meeting_scheduled: 'meetings',
  meeting_live:      'meetings',
  meeting_cancelled: 'meetings',
  meeting_ended:     'meetings',
}

/** The preference category for a notification type, or null if uncategorized. */
export function notifCategory(type) {
  return TYPE_TO_CATEGORY[type] || null
}

/** All categories enabled — the default preference set. */
export function defaultNotifPrefs() {
  return NOTIF_CATEGORIES.reduce((acc, c) => { acc[c.key] = true; return acc }, {})
}

/** True if a notification item should be shown given the student's prefs. */
export function isNotifAllowed(item, prefs) {
  if (!prefs) return true
  const cat = notifCategory(item?.type)
  if (!cat) return true // uncategorized notifications are always shown
  return prefs[cat] !== false
}

/** Filter a list of notification items by the student's prefs. */
export function applyNotifPrefs(items, prefs) {
  if (!prefs) return items || []
  return (items || []).filter(it => isNotifAllowed(it, prefs))
}
