// ── Shared HTML sanitization for user-authored announcement content ────────
// Single source of truth so every render point (admin + student stream) uses
// the same whitelist. Always sanitize announcement HTML before rendering.
import DOMPurify from 'dompurify'

export const ANNOUNCEMENT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'u', 'em', 'strong', 'mark', 'p', 'br', 'ul', 'ol', 'li', 'h3', 'h4', 'a', 'pre', 'code', 'font', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'size', 'colspan', 'rowspan'],
  FORCE_BODY: false,
}

export function sanitizeAnnouncementHtml(html) {
  return DOMPurify.sanitize(html || '', ANNOUNCEMENT_SANITIZE_CONFIG)
}
