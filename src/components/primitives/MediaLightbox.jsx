import React, { useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { X, ChevronLeft, ChevronRight, ExternalLink, Download } from 'lucide-react'

// Full-screen instant-preview overlay for Stream media. Shows the item at
// `index`: photos in an <img>, videos in <video>, and Drive / Google Docs /
// YouTube through their sandboxed preview iframe. Swipe/arrow between items.
//
// Rendered via createPortal so it sits above everything. Esc + backdrop close.
//
// Props: { items: descriptor[], index, onClose, onIndex }
export default function MediaLightbox({ items = [], index = 0, onClose, onIndex }) {
  const count = items.length
  const item = items[index]

  const go = useCallback((delta) => {
    if (count < 2) return
    onIndex?.((index + delta + count) % count)
  }, [index, count, onIndex])

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose?.()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, go])

  if (!item) return null

  let stage
  if (item.kind === 'image') {
    stage = <img src={item.imageUrl} alt={item.name || ''} className="s-lb-img" />
  } else if (item.kind === 'video' && !/youtube|drive|docs\.google/i.test(item.embedUrl || '')) {
    stage = <video src={item.embedUrl} controls autoPlay playsInline className="s-lb-img" />
  } else if (item.embedUrl) {
    stage = (
      <iframe
        src={item.embedUrl}
        title={item.name || 'Preview'}
        className="s-lb-frame"
        allow="autoplay; encrypted-media; fullscreen"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
      />
    )
  } else {
    stage = (
      <div className="s-lb-fallback">
        <p style={{ marginBottom: 12 }}>This file cannot be previewed inline.</p>
        <a href={item.href} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
          <ExternalLink size={14} style={{ marginRight: 6 }} /> Open file
        </a>
      </div>
    )
  }

  return ReactDOM.createPortal(
    <div className="s-lb" onClick={onClose} role="dialog" aria-modal="true" aria-label="Media preview">
      <button type="button" className="s-lb-close" aria-label="Close preview" onClick={onClose}><X size={22} /></button>

      {count > 1 && (
        <button type="button" className="s-lb-nav s-lb-prev" aria-label="Previous" onClick={e => { e.stopPropagation(); go(-1) }}>
          <ChevronLeft size={28} />
        </button>
      )}

      <div className="s-lb-stage" onClick={e => e.stopPropagation()}>
        {stage}
        <div className="s-lb-bar">
          <span className="s-lb-name">{item.name}</span>
          <span className="s-lb-actions">
            {count > 1 && <span className="s-lb-count">{index + 1} / {count}</span>}
            {item.downloadUrl && (
              <a href={item.downloadUrl} target="_blank" rel="noreferrer" download className="s-lb-open" onClick={e => e.stopPropagation()}>
                <Download size={14} /> Download
              </a>
            )}
            {item.href && (
              <a href={item.href} target="_blank" rel="noreferrer" className="s-lb-open" onClick={e => e.stopPropagation()}>
                <ExternalLink size={14} /> Open
              </a>
            )}
          </span>
        </div>
      </div>

      {count > 1 && (
        <button type="button" className="s-lb-nav s-lb-next" aria-label="Next" onClick={e => { e.stopPropagation(); go(1) }}>
          <ChevronRight size={28} />
        </button>
      )}
    </div>,
    document.body
  )
}
