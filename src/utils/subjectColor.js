// Deterministic, stable color per subject — so a subject looks the same
// everywhere it appears (chips, dots, headers) with no storage required.
// Colors are mid-tone hues that read well on both light and dark themes; the
// soft variant uses color-mix so it adapts to the current surface.

const PALETTE = [
  '#2563eb', // blue
  '#7c3aed', // violet
  '#0d9488', // teal
  '#db2777', // pink
  '#ea580c', // orange
  '#16a34a', // green
  '#0891b2', // cyan
  '#9333ea', // purple
  '#ca8a04', // amber
  '#dc2626', // red
  '#4f46e5', // indigo
  '#65a30d', // lime
]

// Stable string hash (FNV-1a style) → palette index.
function hashIndex(str) {
  let h = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % PALETTE.length
}

// Returns { color, soft } for a subject name.
//   color — solid hue for text / dots / borders
//   soft  — translucent tint for chip backgrounds
export function subjectColor(subject) {
  const color = PALETTE[hashIndex(subject)]
  return { color, soft: `color-mix(in srgb, ${color} 14%, transparent)` }
}
