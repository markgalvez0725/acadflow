// Resource Hub type config - shared by the admin and student Resource tabs so
// the icon/label for each material type stays consistent across both sides.
import { BookOpen, Presentation, Video, FileText, Link2 } from 'lucide-react'

export const RESOURCE_TYPES = [
  { key: 'module', label: 'Module', Icon: BookOpen },
  { key: 'slides', label: 'Slides', Icon: Presentation },
  { key: 'video',  label: 'Video',  Icon: Video },
  { key: 'file',   label: 'File',   Icon: FileText },
  { key: 'link',   label: 'Link',   Icon: Link2 },
]

export function resourceType(key) {
  return RESOURCE_TYPES.find(t => t.key === key) || RESOURCE_TYPES[RESOURCE_TYPES.length - 1]
}
