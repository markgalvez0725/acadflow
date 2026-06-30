import React from 'react'
import { appleEmojiUrl } from '@/utils/reactions'

// Render a reaction emoji as an Apple emoji IMAGE so it looks the same on every
// platform. If the emoji is not in the curated Apple set (or the image fails to
// load), the browser shows the raw unicode char via the img alt text.
export default function EmojiIcon({ emoji, size = 18, className = '' }) {
  const url = appleEmojiUrl(emoji)
  if (!url) {
    return <span className={className} style={{ fontSize: size, lineHeight: 1 }}>{emoji}</span>
  }
  return (
    <img
      src={url}
      alt={emoji}
      width={size}
      height={size}
      className={className}
      draggable={false}
      loading="lazy"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    />
  )
}
