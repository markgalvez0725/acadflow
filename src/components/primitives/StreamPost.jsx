import React from 'react'
import { Megaphone, ClipboardList, FileQuestion, BookOpen, CalendarCheck, MessageSquare } from 'lucide-react'

// Type → round avatar (translucent tint works in light + dark) for the feed.
const TYPE_AVATARS = {
  announcement: { bg: 'rgba(245,158,11,0.16)', color: '#f59e0b', Icon: Megaphone },
  activity:     { bg: 'rgba(99,102,241,0.16)',  color: '#6366f1', Icon: ClipboardList },
  quiz:         { bg: 'rgba(139,92,246,0.16)',  color: '#8b5cf6', Icon: FileQuestion },
  grade:        { bg: 'rgba(16,185,129,0.16)',  color: '#10b981', Icon: BookOpen },
  attendance:   { bg: 'rgba(14,165,233,0.16)',  color: '#0ea5e9', Icon: CalendarCheck },
  default:      { bg: 'var(--bg2)',             color: 'var(--ink2)', Icon: Megaphone },
}

// Facebook/Instagram-style feed post shell shared by the admin + student Stream.
// Renders an avatar header (type-coloured icon + title + meta + optional badges
// and kebab), the body (children), and an optional engagement footer.
export default function PostShell({
  type, title, meta, badges, kebab, pinned,
  children, commentCount, onComment, photo,
}) {
  const av = TYPE_AVATARS[type] || TYPE_AVATARS.default
  const Icon = av.Icon
  const hasFoot = (commentCount != null && commentCount > 0)
  return (
    <div className={`s-post${pinned ? ' s-post--pinned' : ''}`}>
      <div className="s-post-head">
        <div className="s-post-av" style={{ background: av.bg, color: av.color }}>
          {photo ? <img src={photo} alt="" className="s-post-av-img" /> : <Icon size={18} />}
        </div>
        <div className="s-post-titles">
          <div className="s-post-title">{title}</div>
          {meta && <div className="s-post-meta">{meta}</div>}
        </div>
        {badges}
        {kebab}
      </div>

      {children != null && <div className="s-post-body">{children}</div>}

      {hasFoot && (
        <div className="s-post-foot">
          <span className="s-post-foot-stat"><MessageSquare size={13} /> {commentCount} comment{commentCount !== 1 ? 's' : ''}</span>
        </div>
      )}
      {onComment && (
        <div className="s-post-actions">
          <button type="button" className="s-post-action" onClick={onComment}>
            <MessageSquare size={15} /> Comment{!hasFoot && commentCount > 0 ? ` (${commentCount})` : ''}
          </button>
        </div>
      )}
    </div>
  )
}
