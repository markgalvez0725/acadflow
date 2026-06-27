// Pure helpers that turn announcement links / attachments into previewable
// media "descriptors" for the Facebook/Instagram-style Stream feed.
// No network, no deps - just string parsing so it is safe to call in render.
//
// Descriptor shape:
//   { id, kind, name, imageUrl?, embedUrl?, href, mime?, size? }
//     kind: 'image' | 'video' | 'youtube' | 'drive' | 'doc' | 'link'
//     imageUrl - direct <img> src (photos, thumbnails) -> shown in the grid
//     embedUrl - iframe/video src for the instant-preview lightbox
//     href     - canonical URL to open externally as a fallback
//
// Only https URLs are ever previewed. A Drive upload later just produces an
// `attachments[]` entry that flows through descriptorFromAttachment().

const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|#|$)/i
const VID_RE = /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i
const DOC_RE = /\.(pdf|docx?|pptx?|xlsx?|csv|txt|rtf|pages|key|numbers)(\?|#|$)/i

const GDOC_LABEL = { document: 'Google Doc', spreadsheets: 'Google Sheet', presentation: 'Google Slides' }

// Small, stable, non-crypto hash so repeated renders give the same id.
function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0 }
  return (h >>> 0).toString(36)
}

function fileNameFromUrl(url) {
  try {
    const path = new URL(url).pathname
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '')
    return last || 'File'
  } catch { return 'File' }
}

function driveId(url) {
  let m = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/i)
  if (m) return m[1]
  m = url.match(/drive\.(?:google|usercontent\.google)\.com\/(?:open|uc|download)\?[^#]*\bid=([^&#]+)/i)
  if (m) return m[1]
  return null
}

const GDOC_EXPORT = { document: 'pdf', spreadsheets: 'xlsx', presentation: 'pptx' }

function gDocsRef(url) {
  const m = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/?#]+)/i)
  return m ? { type: m[1], id: m[2] } : null
}

function youTubeId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?[^#]*\bv=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{6,})/i)
  return m ? m[1] : null
}

export function extOf(name = '') {
  const m = String(name).match(/\.([a-z0-9]+)(?:\?|#|$)/i)
  return m ? m[1].toLowerCase() : ''
}

export function formatBytes(n) {
  if (!n || n < 0) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

// Parse one raw URL into a media descriptor, or null when not previewable.
// `meta` lets a known attachment pass through its name/mime/size.
export function parseMediaLink(raw, meta = {}) {
  if (!raw || typeof raw !== 'string') return null
  const url = raw.trim()
  if (!/^https?:\/\//i.test(url)) return null

  const dId = driveId(url)
  if (dId) {
    return {
      id: 'drive-' + dId, kind: 'drive', name: meta.name || 'Drive file',
      embedUrl: `https://drive.google.com/file/d/${dId}/preview`,
      imageUrl: `https://drive.google.com/thumbnail?id=${dId}&sz=w1200`,
      href: `https://drive.google.com/file/d/${dId}/view`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${dId}`,
      mime: meta.mime || '', size: meta.size || 0,
    }
  }

  const gd = gDocsRef(url)
  if (gd) {
    return {
      id: 'gdoc-' + gd.id, kind: 'doc', name: meta.name || GDOC_LABEL[gd.type] || 'Google file',
      embedUrl: `https://docs.google.com/${gd.type}/d/${gd.id}/preview`,
      href: url,
      downloadUrl: `https://docs.google.com/${gd.type}/d/${gd.id}/export?format=${GDOC_EXPORT[gd.type] || 'pdf'}`,
      mime: meta.mime || '', size: meta.size || 0,
    }
  }

  const yt = youTubeId(url)
  if (yt) {
    return {
      id: 'yt-' + yt, kind: 'youtube', name: meta.name || 'YouTube video',
      embedUrl: `https://www.youtube.com/embed/${yt}`,
      imageUrl: `https://img.youtube.com/vi/${yt}/hqdefault.jpg`,
      href: url,
    }
  }

  if (IMG_RE.test(url)) {
    return { id: 'img-' + hash(url), kind: 'image', name: meta.name || fileNameFromUrl(url), imageUrl: url, href: url, downloadUrl: url }
  }

  if (VID_RE.test(url)) {
    return { id: 'vid-' + hash(url), kind: 'video', name: meta.name || fileNameFromUrl(url), embedUrl: url, href: url, downloadUrl: url }
  }

  if (DOC_RE.test(url)) {
    return {
      id: 'doc-' + hash(url), kind: 'doc', name: meta.name || fileNameFromUrl(url),
      embedUrl: `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(url)}`,
      href: url, downloadUrl: url, mime: meta.mime || '',
    }
  }

  return null
}

// A stored attachment (future Drive upload) -> descriptor.
// Accepts { driveId } or { url }, carrying name/mime/size through.
export function descriptorFromAttachment(att) {
  if (!att) return null
  if (att.driveId) return parseMediaLink(`https://drive.google.com/file/d/${att.driveId}/view`, att)
  if (att.url) return parseMediaLink(att.url, att)
  return null
}

// Collect every previewable item for an announcement: stored attachments first,
// then auto-upgrade a pasted moduleLink when it happens to be previewable.
export function mediaFromAnnouncement(ann) {
  const out = []
  const seen = new Set()
  const push = d => { if (d && !seen.has(d.id)) { seen.add(d.id); out.push(d) } }

  if (Array.isArray(ann?.attachments)) ann.attachments.forEach(a => push(descriptorFromAttachment(a)))
  if (ann?.referenceVideo) push(parseMediaLink(ann.referenceVideo))
  if (ann?.moduleLink) push(parseMediaLink(ann.moduleLink))

  return out
}

// True when a moduleLink is rendered as media (so the plain chip is suppressed).
export function isPreviewableLink(url) {
  return !!parseMediaLink(url)
}

// Items that belong in the photo grid (have a thumbnail) vs. file tiles.
export function splitMedia(items = []) {
  const gallery = []
  const files = []
  items.forEach(it => { (it.imageUrl ? gallery : files).push(it) })
  return { gallery, files }
}
