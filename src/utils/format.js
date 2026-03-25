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

// Used only for export HTML strings — JSX handles escaping elsewhere.
export function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
