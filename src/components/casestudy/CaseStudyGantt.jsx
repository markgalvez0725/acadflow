import React, { useMemo, useState } from 'react'
import {
  ganttGeometry, stepState, milestoneAggregate, categoryColorMap, catColor,
  planCategories, STEP_CLS, fmtShortDay,
} from '@/utils/caseStudyPlan'

// ── Case study Gantt ─────────────────────────────────────────────────────────
// One shared chart for both roles. With `gid` it colors each bar by THAT
// group's step status (student view / per-group view); without it, each bar
// aggregates across all groups and shows "done/total" (professor view).
// The "today" marker is drawn inside every track so the chart stays honest in
// both the desktop grid layout and the stacked mobile layout.
//
// With `editable` (professor only - the Firestore rule blocks students from
// touching milestones anyway) each bar becomes a scheduling control: drag the
// body to move the whole step, drag either edge to change its start or due
// date. Deltas snap to WHOLE DAYS so the stored 00:00 start / 23:59 due times
// survive every drag, a floating hint shows the live range, and release calls
// `onChangeDates(milestone, startAt, dueAt)` - the axis, statuses, and group
// chips then re-derive on their own. Pointer listeners live on window (never
// the handle) so a release outside the bar can't freeze the drag.

const BAR_TEXT = { done: 'done', doneLate: 'done late', behind: 'behind', active: 'now', upcoming: '' }
const DAY = 86400000

export default function CaseStudyGantt({ plan, gid = null, editable = false, onChangeDates }) {
  const milestones = plan?.milestones || []
  const now = Date.now()
  const geo = useMemo(() => ganttGeometry(milestones, now), [milestones, now])
  const colors = useMemo(() => categoryColorMap(plan), [plan])
  const cats = useMemo(() => planCategories(plan), [plan])
  // In-flight drag preview: { id, mode: 'move'|'l'|'r', days }
  const [drag, setDrag] = useState(null)
  if (!geo) return null

  // Whole days the step can shrink by from either edge before start and due
  // would swap (same-day steps floor to 0: they cannot shrink further).
  const shrinkRoom = m => Math.max(0, Math.floor((m.dueAt - m.startAt) / DAY))

  function draggedDates(m, mode, days) {
    let s = m.startAt
    let d = m.dueAt
    if (mode === 'move') { s += days * DAY; d += days * DAY }
    else if (mode === 'l') { s += Math.min(days, shrinkRoom(m)) * DAY }
    else if (mode === 'r') { d += Math.max(days, -shrinkRoom(m)) * DAY }
    return { s, d }
  }

  function startDrag(e, m, mode) {
    if (!editable || !onChangeDates) return
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    const track = e.currentTarget.closest('.csp-track')
    const w = track ? track.getBoundingClientRect().width : 0
    if (!w) return
    const spanDays = (geo.max - geo.min) / DAY
    const startX = e.clientX
    let days = 0
    const move = ev => {
      days = Math.round(((ev.clientX - startX) / w) * spanDays)
      setDrag({ id: m.id, mode, days })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDrag(null)
      if (days !== 0) {
        const { s, d } = draggedDates(m, mode, days)
        if (s !== m.startAt || d !== m.dueAt) onChangeDates(m, s, d)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

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
        const isDragging = drag?.id === m.id
        const { s: showS, d: showD } = isDragging ? draggedDates(m, drag.mode, drag.days) : { s: m.startAt, d: m.dueAt }
        const left = geo.pct(showS)
        const width = Math.max(2.5, geo.pct(showD) - left)
        return (
          <div key={m.id} className="csp-gl">
            <span className="csp-glabel" title={m.note ? `${m.title} - ${m.note}` : m.title}>
              <span className="csp-dot" style={{ background: catColor(colors, m.category) }} />
              <b>{m.title}</b>
              <span className={`csp-glstate csp-t-${STEP_CLS[state]}`}>{label}</span>
            </span>
            <div className="csp-track">
              {geo.todayPct != null && <span className="csp-now" style={{ left: geo.todayPct + '%' }} />}
              {isDragging && (
                <span className="csp-drag-hint" style={{ left: Math.min(left, 78) + '%' }}>
                  {fmtShortDay(showS)} to {fmtShortDay(showD)}
                </span>
              )}
              <span
                className={`csp-bar csp-b-${STEP_CLS[state]}${editable ? ' csp-edit' : ''}${isDragging ? ' dragging' : ''}`}
                style={{ left: left + '%', width: width + '%' }}
                title={editable ? 'Drag to move, pull an edge to resize' : undefined}
                onPointerDown={editable ? e => startDrag(e, m, 'move') : undefined}
              >
                {label}
                {editable && (
                  <>
                    <span
                      className="csp-rz l"
                      aria-hidden="true"
                      onPointerDown={e => { e.stopPropagation(); startDrag(e, m, 'l') }}
                    />
                    <span
                      className="csp-rz r"
                      aria-hidden="true"
                      onPointerDown={e => { e.stopPropagation(); startDrag(e, m, 'r') }}
                    />
                  </>
                )}
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
