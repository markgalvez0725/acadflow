// ── Shared rich text renderer ──────────────────────────────────────────────
// Displays stored rich-text HTML with the same `.ann-message` styling the
// editor mirrors, so what a teacher typed in <RichTextEditor> renders
// identically to students. Legacy plain-text content (no HTML tags, saved
// before rich text existed) is shown with its line breaks preserved instead of
// collapsing. Returns null for empty content so callers can gate on it.
import { sanitizeRichHtml } from '@/utils/sanitizeHtml'

export default function RichText({ html, className = '', style }) {
  const raw = typeof html === 'string' ? html : ''
  if (!raw.trim()) return null
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(raw)
  if (!looksLikeHtml) {
    return (
      <div className={`ann-message ${className}`.trim()} style={{ whiteSpace: 'pre-wrap', ...style }}>
        {raw}
      </div>
    )
  }
  return (
    <div
      className={`ann-message ${className}`.trim()}
      style={style}
      dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(raw) }}
    />
  )
}
