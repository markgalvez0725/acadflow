import React from 'react'
import { ClipboardList, FileQuestion, BookOpen, CalendarCheck, Megaphone, Send } from 'lucide-react'

// Type → avatar tint/icon + solid accent (used for the body top-border + date
// kicker), mirroring the announcement card's per-post color treatment.
const TYPE_META = {
  activity:   { tint: 'rgba(99,102,241,0.16)', color: '#6366f1', accent: '#6366f1', Icon: ClipboardList, label: 'Activity' },
  quiz:       { tint: 'rgba(139,92,246,0.16)', color: '#8b5cf6', accent: '#8b5cf6', Icon: FileQuestion,  label: 'Quiz' },
  grade:      { tint: 'rgba(16,185,129,0.16)', color: '#10b981', accent: '#10b981', Icon: BookOpen,      label: 'Grade update' },
  attendance: { tint: 'rgba(14,165,233,0.16)', color: '#0ea5e9', accent: '#0ea5e9', Icon: CalendarCheck, label: 'Attendance' },
  default:    { tint: 'var(--bg2)',            color: 'var(--ink2)', accent: 'var(--accent)', Icon: Megaphone, label: 'Update' },
}

// Instagram-style feed card for the non-announcement Stream items (activity,
// quiz, grade, attendance). It shares the SAME chrome as AnnouncementPost
// (the `.ig-*` classes + the `.s-textcard` body panel): an avatar header, a
// colour-accented body panel, an optional "Message professor" action, and a
// pill row. Announcements render through AnnouncementPost directly; everything
// else flows through here so the whole feed reads as one consistent design.
//
// Props:
//   type           - activity | quiz | grade | attendance (drives colour + icon)
//   name           - header bold label (defaults to the type label)
//   time           - header relative-time string (e.g. "2h ago")
//   dateLabel      - uppercase accent kicker inside the body panel
//   title          - body title (the activity/quiz title, subject, …)
//   badges         - optional node before the kebab (OPEN/CLOSED, status)
//   kebab          - optional kebab menu node
//   pinned         - shows the pinned glow + badge
//   pills          - optional node rendered in the `.ig-pills` row
//   onAskProfessor - optional handler → renders the Send ("Message professor")
//                    action (student side only; the professor is the recipient)
//   children       - body details (status lines, scores, counts)
export default function PostShell({
  type, name, time, dateLabel, title, badges, kebab, pinned,
  pills, onAskProfessor, children, domId,
}) {
  const meta = TYPE_META[type] || TYPE_META.default
  const Icon = meta.Icon
  return (
    <article className={`ig-post${pinned ? ' ig-glow' : ''}`} id={domId}>
      <header className="ig-head">
        <div className="ig-av" style={{ background: meta.tint, color: meta.color }}>
          <Icon size={18} />
        </div>
        <div className="ig-id">
          <span className="ig-name">{name || meta.label}</span>
          {time && <><span className="ig-dot">·</span><span className="ig-time">{time}</span></>}
        </div>
        {pinned && <span className="ig-pin">Pinned</span>}
        {badges}
        {kebab}
      </header>

      <div className="ig-media">
        <div className="s-textcard" style={{ borderTop: `3px solid ${meta.accent}` }}>
          <div className="s-textcard-scroll open">
            {dateLabel && <div className="s-textcard-date" style={{ color: meta.accent }}>{dateLabel}</div>}
            {title && <div className="s-textcard-title">{title}</div>}
            {children != null && <div className="s-textcard-body">{children}</div>}
          </div>
        </div>
      </div>

      {onAskProfessor && (
        <div className="ig-actions">
          <div className="ig-actions-left">
            <button
              className="ig-icon"
              onClick={onAskProfessor}
              aria-label="Message professor about this post"
              title="Message professor"
              style={{ color: meta.color }}
            >
              <Send size={22} />
            </button>
          </div>
        </div>
      )}

      {pills && (
        <div className="ig-meta" style={onAskProfessor ? undefined : { paddingTop: 10 }}>
          <div className="ig-pills">{pills}</div>
        </div>
      )}
    </article>
  )
}
