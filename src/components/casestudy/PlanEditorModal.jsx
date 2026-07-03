import React, { useState, useRef, useLayoutEffect } from 'react'
import Modal from '@/components/primitives/Modal'
import SuggestInput from '@/components/primitives/SuggestInput'
import { Plus, Trash2, CalendarDays, Loader2, GripVertical } from 'lucide-react'
import {
  seedMilestones, planId, tsToDateInput, dateInputToStart, dateInputToDue,
  DEFAULT_CATEGORIES,
} from '@/utils/caseStudyPlan'

// ── Plan timeline editor (professor) ─────────────────────────────────────────
// Edits the milestone list of a case study plan: title, free-text category
// (with quick suggestions), start/due dates, and a note the professor writes
// for the groups. Opens pre-seeded with a starter template spread between
// today and the case study's due date when no plan exists yet. Steps are
// sorted by start date on save, so row order never needs managing.
//
// Steps are DRAGGABLE by the grip handle: grabbing it collapses every card
// into a compact one-line row (number, title, category, dates) so the whole
// order fits under the pointer, the held row is tinted accent, and the list
// reorders live - one slot per ~compact-row-height of vertical movement,
// measured from where the drag started (never from absolute midpoints: the
// collapse shifts the layout, and full-size cards made the first drag feel
// dead because their midpoints sit hundreds of px away). The schedule
// re-flows automatically on every swap - the plan keeps its overall start
// date, every step keeps its own length in days, and each step starts on the
// day the previous one ends (the starter template's contiguous shape).
// Manual date edits are only re-flowed by a drag, never on their own. The
// full cards are hidden with CSS, not unmounted, so a touch drag keeps its
// event target; pointer listeners live on window so releasing outside the
// modal never freezes the drag.

// Calendar-day date math on 'YYYY-MM-DD' strings (no DST/ms drift).
function addDays(input, n) {
  const [y, m, d] = String(input).split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  const pad = v => String(v).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

function lenDays(start, due) {
  if (!start || !due) return 0
  const [y1, m1, d1] = start.split('-').map(Number)
  const [y2, m2, d2] = due.split('-').map(Number)
  return Math.max(0, Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000))
}

function reflowRows(rs, anchor) {
  let start = anchor
  return rs.map(r => {
    const out = { ...r, start, due: addDays(start, lenDays(r.start, r.due)) }
    start = out.due
    return out
  })
}

function miniDate(input) {
  if (!input) return '?'
  const [y, m, d] = String(input).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function PlanEditorModal({ cs, plan, onSave, onClose }) {
  const [rows, setRows] = useState(() => {
    const src = plan?.milestones?.length ? plan.milestones : seedMilestones(Date.now(), cs?.dueAt)
    return src.map(m => ({
      id: m.id || planId('m'),
      title: m.title || '',
      category: m.category || '',
      note: m.note || '',
      start: tsToDateInput(m.startAt || Date.now()),
      due: tsToDateInput(m.dueAt || m.startAt || Date.now()),
    }))
  })
  const [saving, setSaving] = useState(false)
  const seeded = !plan?.milestones?.length

  // Drag-to-reorder: index of the card in hand, live row order, row elements.
  const [dragIdx, setDragIdx] = useState(-1)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const rowElsRef = useRef({})

  // FLIP slide on swap: while reordering, remember where each row sat and,
  // when a swap moves it, play it from its old position into the new one
  // (WAAPI, before paint). The row in hand is skipped - it snaps instantly so
  // the drag stays responsive; only the displaced neighbors glide. Positions
  // reset when the drag ends so the collapse/expand itself never animates.
  const lastTopsRef = useRef({})
  useLayoutEffect(() => {
    if (dragIdx < 0) { lastTopsRef.current = {}; return }
    const prev = lastTopsRef.current
    const next = {}
    rows.forEach((r, i) => {
      const el = rowElsRef.current[r.id]
      if (!el) return
      const top = el.getBoundingClientRect().top
      next[r.id] = top
      const was = prev[r.id]
      if (was != null && was !== top && i !== dragIdx && el.animate) {
        el.animate(
          [{ transform: `translateY(${was - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 160, easing: 'ease' }
        )
      }
    })
    lastTopsRef.current = next
  }, [rows, dragIdx])

  function startRowDrag(e, i) {
    if (rows.length < 2) return
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    const anchor = rowsRef.current[0]?.start || tsToDateInput(Date.now())
    const draggedId = rowsRef.current[i]?.id
    const startY = e.clientY
    const from = i
    let cur = i
    setDragIdx(i)
    const move = ev => {
      const order = rowsRef.current
      // One slot per compact-row-height of movement since the grab. Measured
      // live (the cards collapse right after the grab), 10px list gap included.
      const el = rowElsRef.current[draggedId]
      const slot = Math.max(34, (el ? el.getBoundingClientRect().height : 44) + 10)
      const to = Math.max(0, Math.min(order.length - 1, from + Math.round((ev.clientY - startY) / slot)))
      if (to !== cur) {
        setRows(rs => {
          const next = rs.slice()
          const [moved] = next.splice(cur, 1)
          next.splice(to, 0, moved)
          return reflowRows(next, anchor)
        })
        cur = to
        setDragIdx(to)
      }
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDragIdx(-1)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  function update(i, patch) {
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function remove(i) {
    setRows(rs => rs.filter((_, j) => j !== i))
  }

  function addRow() {
    setRows(rs => {
      const last = rs[rs.length - 1]
      const start = last?.due || tsToDateInput(Date.now())
      return [...rs, { id: planId('m'), title: '', category: '', note: '', start, due: start }]
    })
  }

  const catSuggestions = (() => {
    const out = []
    const seen = new Set()
    ;[...rows.map(r => r.category), ...DEFAULT_CATEGORIES].forEach(c => {
      const t = String(c || '').trim()
      if (!t) return
      const k = t.toLowerCase()
      if (!seen.has(k)) { seen.add(k); out.push(t) }
    })
    return out
  })()

  const valid = rows.length > 0 && rows.every(r => r.title.trim() && r.start && r.due)

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    const milestones = rows
      .map(r => {
        const startAt = dateInputToStart(r.start)
        let dueAt = dateInputToDue(r.due)
        if (dueAt < startAt) dueAt = dateInputToDue(r.start)
        return {
          id: r.id,
          title: r.title.trim(),
          category: r.category.trim(),
          note: r.note.trim(),
          startAt,
          dueAt,
        }
      })
      .sort((a, b) => a.startAt - b.startAt || a.dueAt - b.dueAt)
    try {
      await onSave(milestones)
      onClose()
    } catch (e) {
      setSaving(false)
    }
  }

  return (
    <Modal
      size="lg"
      onClose={onClose}
      icon={<CalendarDays size={18} />}
      title="Plan timeline"
      subtitle={`${cs?.title || 'Case study'} · every group follows the same steps`}
      footer={<>
        <span className="text-xs text-ink3" style={{ marginRight: 'auto' }}>Students see the steps, categories, and notes.</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={save}>
          {saving ? <Loader2 size={14} className="animate-spin" style={{ marginRight: 5 }} /> : null}
          {saving ? 'Saving...' : 'Save plan'}
        </button>
      </>}
    >
      {seeded && (
        <div className="note-banner" style={{ marginBottom: 12 }}>
          A starter plan was laid out between today and the due date. Rename, re-date, add, or remove steps to match what you have in mind.
        </div>
      )}

      <div className={`csp-ed-list${dragIdx >= 0 ? ' reordering' : ''}`}>
        {rows.map((r, i) => (
          <div
            key={r.id}
            ref={el => { rowElsRef.current[r.id] = el }}
            className={`csp-ed-row${dragIdx === i ? ' dragging' : ''}`}
          >
            <div className="csp-ed-mini" aria-hidden="true">
              <GripVertical size={13} />
              <span className="csp-ed-mini-n">{i + 1}</span>
              <span className="csp-ed-mini-t">{r.title.trim() || `Step ${i + 1}`}</span>
              {r.category.trim() ? <span className="csp-ed-mini-cat">{r.category.trim()}</span> : null}
              <span className="csp-ed-mini-d">{miniDate(r.start)} to {miniDate(r.due)}</span>
            </div>
            <div className="csp-ed-grid">
              <div>
                <label className="label">Step {i + 1}</label>
                <input
                  className="input"
                  placeholder="Research and data gathering"
                  value={r.title}
                  onChange={e => update(i, { title: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Category</label>
                <SuggestInput
                  className="input"
                  placeholder="Documentation"
                  options={catSuggestions}
                  value={r.category}
                  onChange={v => update(i, { category: v })}
                />
              </div>
            </div>
            <div className="csp-ed-grid">
              <div>
                <label className="label">Starts</label>
                <input
                  className="input"
                  type="date"
                  value={r.start}
                  onChange={e => update(i, { start: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Due</label>
                <input
                  className="input"
                  type="date"
                  value={r.due}
                  onChange={e => update(i, { due: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">Note to the groups (optional)</label>
              <textarea
                className="input csp-ed-note"
                rows={2}
                placeholder="What do you expect from this step? Students see this under the step."
                value={r.note}
                onChange={e => update(i, { note: e.target.value })}
              />
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                className="csp-ed-grip"
                aria-label={`Reorder step ${i + 1}`}
                title="Drag to reorder - the schedule re-flows to keep steps in sequence"
                onPointerDown={e => startRowDrag(e, i)}
              >
                <GripVertical size={14} />
              </button>
            )}
            <button
              type="button"
              className="csp-ed-del"
              aria-label={`Remove step ${i + 1}`}
              title="Remove this step"
              onClick={() => remove(i)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={addRow}>
        <Plus size={14} style={{ marginRight: 4 }} /> Add step
      </button>
      <div className="csp-ed-hint">
        Steps are shown to every group as a Gantt timeline. Categories get a consistent color, dates drive the behind/on-track status, and members check steps off as they finish them. Drag the grip on a step to reorder it - the schedule re-flows on its own: each step keeps its length and starts where the previous one ends.
      </div>
    </Modal>
  )
}
