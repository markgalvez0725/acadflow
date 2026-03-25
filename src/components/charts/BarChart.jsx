import React, { useState } from 'react'

const CHART_COLORS = ['#0d2f6e','#3b7dd8','#c8a84b','#1a7a4a','#5b21b6','#b93232','#0891b2','#d97706']

/**
 * Inline SVG bar chart.
 * @param {{ data: Array<{label:string, value:number}>, height?: number, maxVal?: number }} props
 */
export default function BarChart({ data = [], height = 160, maxVal = 100 }) {
  const [tooltip, setTooltip] = useState(null)

  if (!data.length) {
    return <div className="empty text-sm py-4">No data</div>
  }

  const svgPad   = { top: 10, right: 8, bottom: 36, left: 36 }
  const barGap   = 6
  const barW     = Math.max(12, Math.min(40, (300 - svgPad.left - svgPad.right) / data.length - barGap))
  const chartW   = data.length * (barW + barGap) + svgPad.left + svgPad.right
  const chartH   = height
  const innerH   = chartH - svgPad.top - svgPad.bottom
  const top      = maxVal

  const yLines = [0, 25, 50, 75, 100].filter(v => v <= top)

  return (
    <div className="overflow-x-auto">
      <svg width={chartW} height={chartH} className="bar-chart-svg" style={{ minWidth: '100%' }}>
        {/* Y-axis grid lines */}
        {yLines.map(v => {
          const y = svgPad.top + innerH - (v / top) * innerH
          return (
            <g key={v}>
              <line x1={svgPad.left} y1={y} x2={chartW - svgPad.right} y2={y}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3"/>
              <text x={svgPad.left - 4} y={y + 4} textAnchor="end"
                fontSize="9" fill="var(--ink3)">{v}</text>
            </g>
          )
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const x     = svgPad.left + i * (barW + barGap)
          const pct   = Math.min(1, (d.value || 0) / top)
          const bH    = Math.max(2, pct * innerH)
          const y     = svgPad.top + innerH - bH
          const color = CHART_COLORS[i % CHART_COLORS.length]
          return (
            <g key={i}
              onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, label: d.label, value: d.value })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'default' }}>
              <rect x={x} y={y} width={barW} height={bH} rx="3" fill={color} opacity="0.85"/>
              <text x={x + barW / 2} y={chartH - svgPad.bottom + 12} textAnchor="middle"
                fontSize="9" fill="var(--ink2)" style={{ overflow: 'hidden' }}>
                {d.label.length > 7 ? d.label.slice(0, 6) + '…' : d.label}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="chart-legend flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {data.map((d, i) => (
          <span key={i} className="flex items-center gap-1 text-xs text-ink2">
            <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}/>
            {d.label} <span className="text-ink3">({(d.value || 0).toFixed(1)})</span>
          </span>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="chart-tooltip" style={{ position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10, zIndex: 9999, pointerEvents: 'none' }}>
          <strong>{tooltip.label}</strong><br/>
          {(tooltip.value || 0).toFixed(1)}
        </div>
      )}
    </div>
  )
}
