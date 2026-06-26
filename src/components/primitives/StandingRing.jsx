import React from 'react'

// Shared standing/progress ring used across the student tabs. The defaults
// reproduce the compact 80px "done" ring (Activities / Assignments); props cover
// the quiz "avg score" variant and the larger attendance "present" gauge, so
// every call renders exactly as its previous inline copy did. Centralized here
// so the four copies can never drift apart again.
export default function StandingRing({
  rate,
  color,
  label = 'done',
  box = 84,            // square viewBox size
  draw = 80,           // rendered width/height in px
  radius = 34,
  stroke = 9,
  valueSize = 20,
  labelSize = 9,
  valueY = 40,
  labelY = 55,
  formatValue = (r) => `${r}%`,
  transition = false,
  style,
}) {
  const c = box / 2
  const C = 2 * Math.PI * radius
  const off = C * (1 - Math.max(0, Math.min(100, rate)) / 100)
  return (
    <svg width={draw} height={draw} viewBox={`0 0 ${box} ${box}`} aria-hidden="true" style={style}>
      <circle cx={c} cy={c} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={c} cy={c} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={off} transform={`rotate(-90 ${c} ${c})`}
        style={transition ? { transition: 'stroke-dashoffset .4s' } : undefined} />
      <text x={c} y={valueY} textAnchor="middle" fontSize={valueSize} fontWeight="700" fill="var(--ink)">{formatValue(rate)}</text>
      <text x={c} y={labelY} textAnchor="middle" fontSize={labelSize} fill="var(--ink3)">{label}</text>
    </svg>
  )
}
