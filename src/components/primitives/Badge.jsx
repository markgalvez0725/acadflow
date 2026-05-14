import React from 'react'

const VARIANTS = {
  blue:   'badge-blue',
  green:  'badge-green',
  yellow: 'badge-yellow',
  red:    'badge-red',
  purple: 'badge-purple',
  gray:   'badge-gray',
}

export default function Badge({ variant = 'blue', children, className = '' }) {
  return (
    <span className={`badge ${VARIANTS[variant] || 'badge-gray'} ${className}`}>
      {children}
    </span>
  )
}
