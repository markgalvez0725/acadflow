import React, { useMemo } from 'react'
import {
  ganttGeometry, stepState, milestoneAggregate, categoryColorMap, catColor,
  planCategories, STEP_CLS,
} from '@/utils/caseStudyPlan'

// ── Case study Gantt ─────────────────────────────────────────────────────────
// One shared chart for both roles. With `gid` it colors each bar by THAT
// group's step status (student view / per-group view); without it, each bar
// aggregates across all groups and shows "done/total" (professor view).
// The "today" marker is drawn inside every track so the chart stays honest in
// both the desktop grid layout and the stacked mobile layout.

const BAR_TEXT = { done: 'done', doneLate: 'done late', behind: 'behind', active: 'now', upcoming: '' }

export default function CaseStudyGantt({ plan, gid = null }) {
  const milestones = plan?.milestones || []
  const now = Date.now()
  const geo = useMemo(() => ganttGeometry(milestones, now), [milestones, now])
  const colors = useMemo(() => categoryColorMap(plan), [plan])
  const cats = useMemo(() => planCategories(plan), [plan])
  if (!geo) return null

  return (
    <div className="csp-gantt">
      <div className="csp-gl csp-gl-axis" aria-hidden="true">
        <span className="csp-glabel" />
        <div className="csp-track csp-track-bare">
          {geo.ticks.map((t, i) => (
            <span
              key={i}
              className="csp-tick"
              style={{
                left: t.pct + '%',
                transform: i === 0 ? 'none' : i === geo.ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {milestones.map(m => {
        let state
        let label
        if (gid) {
          const st = stepState(m, plan?.progress?.[gid]?.[m.id], now)
          state = st
          label = BAR_TEXT[st]
        } else {
          const agg = milestoneAggregate(plan, m, now)
          state = agg.state
          label = agg.total ? `${agg.done}/${agg.total}` : ''
        }
        const left = geo.pct(m.startAt)
        const width = Math.max(2.5, geo.pct(m.dueAt) - left)
        return (
          <div key={m.id} className="csp-gl">
            <span className="csp-glabel" title={m.note ? `${m.title} - ${m.note}` : m.title}>
              <span className="csp-dot" style={{ background: catColor(colors, m.category) }} />
              <b>{m.title}</b>
              <span className={`csp-glstate csp-t-${STEP_CLS[state]}`}>{label}</span>
            </span>
            <div className="csp-track">
              {geo.todayPct != null && <span className="csp-now" style={{ left: geo.todayPct + '%' }} />}
              <span
                className={`csp-bar csp-b-${STEP_CLS[state]}`}
                style={{ left: left + '%', width: width + '%' }}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}

      {geo.todayPct != null && (
        <div className="csp-gl csp-gl-axis" aria-hidden="true">
          <span className="csp-glabel" />
          <div className="csp-track csp-track-bare">
            <span className="csp-tick csp-tick-today" style={{ left: geo.todayPct + '%' }}>Today</span>
          </div>
        </div>
      )}

      {cats.length > 0 && (
        <div className="csp-legend">
          {cats.map(c => (
            <span key={c.toLowerCase()}>
              <span className="csp-dot" style={{ background: catColor(colors, c) }} /> {c}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
