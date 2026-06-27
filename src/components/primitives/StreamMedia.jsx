import React, { useState } from 'react'
import { Play, Eye, FileText, FileSpreadsheet, Presentation, File as FileIcon } from 'lucide-react'
import { splitMedia, formatBytes, extOf } from '@/utils/streamMedia'

// Instagram-style media block for a Stream post: a photo/thumbnail grid plus
// file tiles. Clicking anything calls onOpen(globalIndex) to launch the
// MediaLightbox. Pure presentational - parent owns the lightbox state.

function fileIconFor(item) {
  const e = extOf(item.name) || (item.mime || '')
  if (/sheet|xls|csv|numbers/i.test(e)) return FileSpreadsheet
  if (/slide|presentation|ppt|key/i.test(e)) return Presentation
  if (/pdf|doc|txt|rtf|pages/i.test(e)) return FileText
  return FileIcon
}

// Up to 4 thumbnails; a 5th+ collapses into a "+N" overlay on the last cell.
// A thumbnail that fails to load (e.g. a non-public Drive link) falls back to a
// neutral file icon so a broken image never shows.
function Gallery({ items, indexOf, onOpen }) {
  const [broken, setBroken] = useState({})
  const shown = items.slice(0, 4)
  const extra = items.length - shown.length
  const layout = `s-media-grid s-media-n${Math.min(shown.length, 4)}`
  return (
    <div className={layout}>
      {shown.map((it, i) => {
        const isLast = i === shown.length - 1
        const gi = indexOf(it)
        const Icon = fileIconFor(it)
        return (
          <button
            type="button"
            key={it.id}
            className="s-media-cell"
            onClick={() => onOpen(gi)}
            aria-label={`Open ${it.name || 'media'}`}
          >
            {broken[it.id]
              ? <span className="s-media-fallback"><Icon size={30} /></span>
              : <img src={it.imageUrl} alt={it.name || ''} loading="lazy" className="s-media-img" onError={() => setBroken(b => ({ ...b, [it.id]: true }))} />}
            {(it.kind === 'youtube' || it.kind === 'video') && !broken[it.id] && (
              <span className="s-media-play"><Play size={22} fill="currentColor" /></span>
            )}
            {isLast && extra > 0 && <span className="s-media-more">+{extra}</span>}
          </button>
        )
      })}
    </div>
  )
}

function FileTile({ item, index, onOpen }) {
  const Icon = fileIconFor(item)
  const meta = [extOf(item.name).toUpperCase(), formatBytes(item.size), item.kind === 'drive' ? 'Drive' : null]
    .filter(Boolean).join(' · ')
  return (
    <button type="button" className="s-media-file" onClick={() => onOpen(index)} aria-label={`Preview ${item.name}`}>
      <span className="s-media-file-ico"><Icon size={20} /></span>
      <span className="s-media-file-info">
        <span className="s-media-file-name">{item.name}</span>
        {meta && <span className="s-media-file-meta">{meta}</span>}
      </span>
      <span className="s-media-file-btn"><Eye size={14} /> Preview</span>
    </button>
  )
}

export default function StreamMedia({ items = [], onOpen }) {
  if (!items.length) return null
  const { gallery, files } = splitMedia(items)
  // Global indices must match the flat `items` order the lightbox receives.
  const indexOf = it => items.findIndex(x => x.id === it.id)

  return (
    <div className="s-media">
      {gallery.length > 0 && (
        <Gallery items={gallery} baseIndex={indexOf(gallery[0])} onOpen={onOpen} />
      )}
      {files.map(f => (
        <FileTile key={f.id} item={f} index={indexOf(f)} onOpen={onOpen} />
      ))}
    </div>
  )
}
