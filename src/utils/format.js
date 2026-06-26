// ── Formatting utilities ───────────────────────────────────────────────────

export function fmtDateShort(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
}

export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

// Messenger-style day separator label for a timestamp: "Today" / "Yesterday"
// / "Jun 18" (adds the year only when it differs from the current one).
export function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

// Returns an array of page numbers/ellipsis strings for a pagination bar.
// e.g. buildPageRange(5, 20) → [1, '…', 4, 5, 6, '…', 20]
export function buildPageRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, cur, cur - 1, cur + 1].filter(p => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}

// Full date + time stamp: "Jun 18, 2026, 3:04 PM" ("—" when empty). Shared by
// the Stream and Announcements feeds.
export function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// Time only: "3:04 PM". Shared by the message threads.
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

// Stream/announcement date-group header: Today / Yesterday / weekday / date.
export function streamGroupLabel(ts) {
  if (!ts) return 'Earlier';
  const now = new Date();
  const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - itemDay) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-PH', { weekday: 'long' });
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Two-letter uppercase initials from a name (avatars / message bubbles).
export function getInitials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function sortByLastName(arr) {
  return [...arr].sort((a, b) => {
    const surname = n => {
      const s = (n || '').trim();
      const ci = s.indexOf(',');
      if (ci !== -1) return s.slice(0, ci).toLowerCase();
      const parts = s.split(/\s+/);
      return (parts[parts.length - 1] || '').toLowerCase();
    };
    const cmp = surname(a.name).localeCompare(surname(b.name));
    return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '');
  });
}
