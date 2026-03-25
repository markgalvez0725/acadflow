import React, { useState } from 'react'

/**
 * SVG arc donut chart.
 * @param {{ data: Array<{label:string, value:number, color:string}>, size?: number, total?: number }} props
 */
export default function DonutChart({ data = [], size = 130, total }) {
  const [hovered, setHovered] = useState(null)

  const filteredData = data.filter(d => d.value > 0)
  const sum = total ?? filteredData.reduce((a, b) => a + b.value, 0)

  if (!sum) {
    return <div className="empty text-sm py-4">No data</div>
  }

  const cx = size / 2
  const cy = size / 2
  const R  = size / 2 - 8   // outer radius
  const r  = R - 22          // inner radius (hole)

  function arc(startAngle, endAngle) {
    const toRad = a => (a - 90) * Math.PI / 180
    const x1 = cx + R * Math.cos(toRad(startAngle))
    const y1 = cy + R * Math.sin(toRad(startAngle))
    const x2 = cx + R * Math.cos(toRad(endAngle))
    const y2 = cy + R * Math.sin(toRad(endAngle))
    const xi1 = cx + r * Math.cos(toRad(endAngle))
    const yi1 = cy + r * Math.sin(toRad(endAngle))
    const xi2 = cx + r * Math.cos(toRad(startAngle))
    const yi2 = cy + r * Math.sin(toRad(startAngle))
    const large = endAngle - startAngle > 180 ? 1 : 0
    return [
      `M ${x1} ${y1}`,
      `A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${r} ${r} 0 ${large} 0 ${xi2} ${yi2}`,
      'Z'
    ].join(' ')
  }

  let cursor = 0
  const arcs = filteredData.map((d, i) => {
    const angleDeg = (d.value / sum) * 360
    const start    = cursor
    const end      = cursor + angleDeg
    cursor         = end
    return { ...d, start, end, i }
  })

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map(seg => (
          <path
            key={seg.i}
            d={arc(seg.start, seg.end)}
            fill={seg.color}
            opacity={hovered === seg.i ? 1 : 0.82}
            style={{ cursor: 'default', transition: 'opacity .15s' }}
            onMouseEnter={() => setHovered(seg.i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--ink)">
          {sum}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="var(--ink3)">
          students
        </text>
      </svg>

      {/* Legend */}
      <div className="donut-labels flex flex-col gap-1">
        {arcs.map(seg => (
          <span
            key={seg.i}
            className="flex items-center gap-1.5 text-xs"
            style={{ fontWeight: hovered === seg.i ? 700 : 400 }}
            onMouseEnter={() => setHovered(seg.i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ background: seg.color }}/>
            <span className="text-ink2">{seg.label}</span>
            <span className="text-ink3 font-semibold">{seg.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
