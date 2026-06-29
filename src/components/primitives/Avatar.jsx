import React from 'react'
import { getInitials } from '@/utils/format'

// Canonical round avatar: renders the profile photo when present, else the
// initials (or whatever `children` fallback the call site passes). `className`
// adopts an existing avatar container style (.stu-avatar, .ds-stud-av,
// .msg-conv-avatar, etc.) so call sites keep their own sizing and positioning;
// when a photo is shown the container padding is zeroed and the image fills it.
export default function Avatar({ photo, name, className = '', style, size, children, alt = '' }) {
  const hasPhoto = !!photo
  return (
    <div
      className={className}
      style={{
        overflow: 'hidden',
        ...(hasPhoto ? { padding: 0 } : null),
        ...(size ? { width: size, height: size } : null),
        ...style,
      }}
    >
      {hasPhoto
        ? <img src={photo} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
        : (children != null ? children : getInitials(name))}
    </div>
  )
}
