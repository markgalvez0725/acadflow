import React, { useState, useMemo, useRef } from 'react'
import { Heart, MessageCircle, Send, MoreHorizontal, BookOpen, CalendarOff, Video, Library } from 'lucide-react'
import ProfessorBadge from '@/components/primitives/ProfessorBadge'
import { courseShort } from '@/constants/courses'
import { sanitizeAnnouncementHtml } from '@/utils/sanitizeHtml'
import StreamMedia from '@/components/primitives/StreamMedia'
import MediaLightbox from '@/components/primitives/MediaLightbox'
import TextCard from '@/components/primitives/TextCard'
import CommentsSection from '@/components/primitives/CommentsSection'
import KebabMenu from '@/components/primitives/KebabMenu'
import { mediaFromAnnouncement, isPreviewableLink } from '@/utils/streamMedia'

// Instagram-style announcement post shared by the student AND teacher Stream.
// The card is identical; each side just passes different kebab `menuItems`, a
// `viewerId` for the like toggle, and a `commentAuthor` identity.
//
// Props:
//   ann          - announcement object
//   author       - { name, photo } shown in the header (the professor)
//   classObj     - the post's class (for the header label / caption footer)
//   pinned       - effective pin state (shows the Pinned badge)
//   statusBadge  - optional node rendered before the kebab (admin: Inactive/Expired)
//   menuItems    - KebabMenu items array (Save/notify on student; Edit/Pin/... on teacher)
//   viewerId     - id used for the like toggle (student.id, or the professor id)
//   onToggleLike - (annId, viewerId, nextLiked) => void
//   commentAuthor- { id, name, role } the viewer posts comments as

function timeAgo(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function classLabelOf(classObj) {
  return classObj?.name ? `${courseShort(classObj.name)}${classObj.section ? ' · ' + classObj.section : ''}` : ''
}

// Category pill metadata per announcement type (color + icon), shown in the
// caption in place of the old "Type - Class" title.
const TYPE_META = {
  no_class:       { label: 'No Class Today', Icon: CalendarOff, bg: 'var(--yellow-l)', fg: 'var(--yellow)' },
  online_class:   { label: 'Online Class',   Icon: Video,      bg: 'var(--accent-l)', fg: 'var(--accent)' },
  meeting_topics: { label: 'Lesson topics',  Icon: BookOpen,   bg: 'var(--purple-l)', fg: 'var(--purple)' },
  resource_hub:   { label: 'Resource Hub',   Icon: Library,    bg: 'var(--teal-l)',   fg: 'var(--teal)' },
}

function dateLabelOf(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))
}

function stripHtml(html) {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = sanitizeAnnouncementHtml(html)
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim()
}

function Avatar({ author }) {
  return (
    <div className="ig-av">
      {author?.photo
        ? <img src={author.photo} alt="" />
        : <span>{author?.name?.charAt(0)?.toUpperCase() || 'P'}</span>}
    </div>
  )
}

export default function AnnouncementPost({
  ann, author, classObj, classPills = [], pinned = false, statusBadge = null,
  menuItems = [], viewerId, onToggleLike, commentAuthor, onAskProfessor = null,
  domId, highlight = false,
}) {
  const media = useMemo(() => mediaFromAnnouncement(ann), [ann])
  const hasMessage = ann.message && ann.message !== '<p></p>' && ann.message !== ''
  // The text-card renders the SAME sanitized rich-editor HTML as the editor.
  const cardHtml = useMemo(() => {
    if (hasMessage) return sanitizeAnnouncementHtml(ann.message)
    if (ann.topics?.length) return sanitizeAnnouncementHtml('<ul>' + ann.topics.map(t => `<li>${escapeHtml(t)}</li>`).join('') + '</ul>')
    return ''
  }, [ann.message, ann.topics, hasMessage])
  const caption = useMemo(() => stripHtml(ann.message), [ann.message])
  const typeMeta = TYPE_META[ann.type] || null
  const likes = ann.likes || []
  const liked = !!viewerId && likes.includes(viewerId)
  const likeCount = likes.length

  const [lightbox, setLightbox] = useState(-1)
  const [expanded, setExpanded] = useState(false)
  const composerRef = useRef(null)

  const hasMedia = media.length > 0
  // Text card only when there's actual body content (message or topics); a
  // type-only post now shows just its caption pills.
  const showTextCard = !hasMedia && !!cardHtml
  const TypeIcon = typeMeta?.Icon

  function onLike() { if (viewerId && onToggleLike) onToggleLike(ann.id, viewerId, !liked) }
  function focusComposer() { composerRef.current?.focus() }

  return (
    <article className={`ig-post${highlight ? ' ig-glow' : ''}`} id={domId}>
      <header className="ig-head">
        <Avatar author={author} />
        <div className="ig-id">
          <span className="ig-name">{author?.name || 'Professor'}</span>
          <ProfessorBadge size={14} />
          <span className="ig-dot">·</span>
          <span className="ig-time">{timeAgo(ann.createdAt)}</span>
        </div>
        {pinned && <span className="ig-pin">Pinned</span>}
        {statusBadge}
        <KebabMenu items={menuItems} icon={<MoreHorizontal size={18} />} label="Post options" />
      </header>

      {hasMedia && <div className="ig-media"><StreamMedia items={media} onOpen={i => setLightbox(i)} /></div>}
      {showTextCard && (
        <div className="ig-media">
          <TextCard seed={ann.id} dateLabel={dateLabelOf(ann.createdAt)} title="" html={cardHtml} footer="" />
        </div>
      )}

      <div className="ig-actions">
        <div className="ig-actions-left">
          <button className={`ig-icon${liked ? ' liked' : ''}`} onClick={onLike} aria-label={liked ? 'Unlike' : 'Like'} title="Like">
            <Heart size={24} fill={liked ? 'currentColor' : 'none'} />
          </button>
          <button className="ig-icon" onClick={focusComposer} aria-label="Comment" title="Comment">
            <MessageCircle size={24} style={{ transform: 'scaleX(-1)' }} />
          </button>
          {onAskProfessor && (
            <button className="ig-icon" onClick={onAskProfessor} aria-label="Message professor about this post" title="Message professor"><Send size={24} /></button>
          )}
          {ann.meetingLink && (
            <a className="ig-icon" href={ann.meetingLink} target="_blank" rel="noreferrer" aria-label="Join meeting" title="Join meeting"><Video size={24} /></a>
          )}
        </div>
      </div>

      <div className="ig-meta">
        {(typeMeta || classPills.length > 0 || ann.subject) && (
          <div className="ig-pills">
            {typeMeta && (
              <span className="ig-pill" style={{ background: typeMeta.bg, color: typeMeta.fg }}>
                {TypeIcon && <TypeIcon size={12} />} {typeMeta.label}
              </span>
            )}
            {classPills.map(p => <span key={p} className="ig-pill ig-pill-class">{p}</span>)}
            {ann.subject && <span className="ig-pill ig-pill-subject">{ann.subject}</span>}
          </div>
        )}
        {likeCount > 0 && <div className="ig-likes">{likeCount} like{likeCount !== 1 ? 's' : ''}</div>}
        {hasMedia && caption && (
          <div className={`ig-caption${expanded ? ' expanded' : ''}`}>{caption}</div>
        )}
        {hasMedia && caption && caption.length > 140 && !expanded && (
          <button className="ig-more" onClick={() => setExpanded(true)}>more</button>
        )}
        {ann.moduleLink && !isPreviewableLink(ann.moduleLink) && (
          <a href={ann.moduleLink} target="_blank" rel="noreferrer" className="stream-link-chip" style={{ marginTop: 8, alignSelf: 'flex-start' }}><BookOpen size={12} /> Module link</a>
        )}
      </div>

      {commentAuthor && (
        <div className="ig-comments">
          <CommentsSection ann={ann} authorId={commentAuthor.id} authorName={commentAuthor.name} role={commentAuthor.role} compact previewCount={2} composerRef={composerRef} />
        </div>
      )}

      {lightbox >= 0 && <MediaLightbox items={media} index={lightbox} onClose={() => setLightbox(-1)} onIndex={setLightbox} />}
    </article>
  )
}
