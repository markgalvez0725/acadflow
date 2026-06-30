import React, { useState, useMemo } from 'react'
import StreamMedia from '@/components/primitives/StreamMedia'
import MediaLightbox from '@/components/primitives/MediaLightbox'
import { parseMediaLink } from '@/utils/streamMedia'

// Inline preview for a single activity submission (a pasted link or an uploaded
// Drive file). Reuses the SAME Stream stack - StreamMedia tile + MediaLightbox -
// so a submission previews identically to a Stream post: photos inline, Drive /
// PDF / Google Docs through their sandboxed preview iframe. A non-previewable
// link (a plain website) falls back to a simple "open externally" anchor.
//
// Used by BOTH the professor's review cards / Smart-grade modal and the
// student's own submission view, so the two sides stay pixel-identical.
//
// Props:
//   link          - the submission URL
//   name          - file label shown on the tile / lightbox bar
//   compact        - constrain the thumbnail to a small tile (review cards)
//   fallbackLabel  - text for the plain anchor when the link is not previewable
export default function SubmissionPreview({ link, name, compact = false, fallbackLabel = 'View submission' }) {
  const media = useMemo(() => {
    const d = parseMediaLink(link, name ? { name } : {})
    return d ? [d] : []
  }, [link, name])
  const [lb, setLb] = useState(-1)

  if (!link) return null
  if (!media.length) {
    return (
      <a href={link} target="_blank" rel="noopener noreferrer" className="sa-act-link">{fallbackLabel} ↗</a>
    )
  }
  return (
    <div className={compact ? 'sub-preview sub-preview-compact' : 'sub-preview'}>
      <StreamMedia items={media} onOpen={i => setLb(i)} />
      {lb >= 0 && <MediaLightbox items={media} index={lb} onClose={() => setLb(-1)} onIndex={setLb} />}
    </div>
  )
}
