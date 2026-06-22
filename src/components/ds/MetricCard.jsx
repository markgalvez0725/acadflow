import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

// Metric / stat card. `Icon` is a lucide component; `color` maps to the
// .sc-icon-wrap colour variants (blue|green|purple|yellow|teal). `trend` is
// optional and only rendered when real delta data is supplied — never faked.
export default function MetricCard({ Icon, color = 'blue', label, value, sub, trend }) {
  return (
    <div className="stat-card">
      {Icon && <span className={`sc-icon-wrap ${color}`}><Icon size={19} /></span>}
      <div className="sc-val">{value}</div>
      <div className="sc-label">{label}</div>
      {sub && <div className="sc-sub">{sub}</div>}
      {trend && (
        <span className={`sc-trend ${trend.dir || 'flat'}`}>
          {trend.dir === 'up' && <TrendingUp size={12} />}
          {trend.dir === 'down' && <TrendingDown size={12} />}
          {trend.text}
        </span>
      )}
    </div>
  )
}
