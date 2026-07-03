import React, { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import Avatar from '@/components/primitives/Avatar'
import SuggestInput from '@/components/primitives/SuggestInput'
import { sortByLastName } from '@/utils/format'
import {
  groupTasks, memberTaskStats, categoryTaskStats, categoryColorMap, catColor,
  planCategories, isLeadRole, fmtShortDay, ROLE_SUGGESTIONS, DEFAULT_CATEGORIES,
} from '@/utils/caseStudyPlan'

// ── Member task board for ONE group ──────────────────────────────────────────
// One card per member with their assigned tasks, grouped visually by category
// dot. Permissions are enforced by the callers' Firestore rules; here they
// just shape the UI:
//   - professor (isAdmin): assigns/deletes tasks anywhere, ticks anything,
//     and edits each member's role inline.
//   - group Lead (viewer's role is "Lead"): assigns/deletes tasks in their
//     own group.
//   - any member: ticks ONLY their own tasks.
// Callers pass `onToggleTask(task, done)`, `onAssignTask({assigneeId, title,
// category})`, `onDeleteTask(task)`, and (professor only) `onRoleChange(sid,
// role)`.

export default function TaskBoard({
  plan, group, members, viewerId = null, isAdmin = false,
  onToggleTask, onAssignTask, onDeleteTask, onRoleChange,
}) {
  const roles = plan?.roles || {}
  const gid = group?.id
  const tasksArr = groupTasks(plan, gid)
  const colors = categoryColorMap(plan)
  const catStats = categoryTaskStats(tasksArr)
  const viewerIsLead = viewerId != null && isLeadRole(roles[viewerId])
  const canAssign = isAdmin || viewerIsLead
  const canManage = isAdmin || viewerIsLead

  const [roleDraft, setRoleDraft] = useState({})   // sid -> in-progress text
  const [addingFor, setAddingFor] = useState('')   // sid with the inline form open
  const [draft, setDraft] = useState({ title: '', category: '' })

  // Nothing to show and nothing the viewer could do: stay out of the way.
  if (!gid || !members?.length) return null
  const groupHasRoles = members.some(m => roles[m.id])
  if (!isAdmin && !viewerIsLead && !tasksArr.length && !groupHasRoles) return null

  // The viewer's own card leads; everyone else follows in roster order.
  const ordered = viewerId
    ? [...members.filter(m => m.id === viewerId), ...sortByLastName(members.filter(m => m.id !== viewerId))]
    : sortByLastName(members)

  const catSuggestions = (() => {
    const out = []
    const seen = new Set()
    ;[...planCategories(plan), ...DEFAULT_CATEGORIES].forEach(c => {
      const k = c.toLowerCase()
      if (!seen.has(k)) { seen.add(k); out.push(c) }
    })
    return out
  })()

  function commitRole(sid, next) {
    if (!isAdmin || !onRoleChange) return
    const v = String(next ?? '').trim()
    if (v !== (roles[sid] || '')) onRoleChange(sid, v)
    setRoleDraft(d => { const n = { ...d }; delete n[sid]; return n })
  }

  function submitTask(sid) {
    const title = draft.title.trim()
    if (!title) return
    onAssignTask?.({ assigneeId: sid, title, category: draft.category.trim() })
    setDraft({ title: '', category: '' })
    setAddingFor('')
  }

  return (
    <div className="csp-tasks">
      <div className="csp-tasks-h">
        <b>Tasks</b>
        {catStats.map(c => (
          <span key={c.name.toLowerCase()} className="csp-cat-chip">
            <span className="csp-dot" style={{ background: catColor(colors, c.name) }} />
            {c.name} {c.done}/{c.total}
          </span>
        ))}
      </div>

      <div className="csp-board">
        {ordered.map(m => {
          const isYou = m.id === viewerId
          const role = roles[m.id] || ''
          const stats = memberTaskStats(tasksArr, m.id)
          const mine = tasksArr.filter(t => t.assigneeId === m.id)
          return (
            <div key={m.id} className={`csp-mcard${isYou ? ' you' : ''}`}>
              <div className="csp-mhead">
                <Avatar photo={m.photo} name={m.name} className="csp-ava" />
                <div className="csp-mmeta">
                  <b>{isYou ? 'Your tasks' : m.name}</b>
                  {isAdmin ? (
                    <SuggestInput
                      className="csp-role-in"
                      options={ROLE_SUGGESTIONS}
                      placeholder="Set a role"
                      ariaLabel={`Role for ${m.name}`}
                      value={roleDraft[m.id] ?? role}
                      onChange={v => setRoleDraft(d => ({ ...d, [m.id]: v }))}
                      onCommit={v => commitRole(m.id, v)}
                    />
                  ) : (
                    <span className={`csp-mrole${isLeadRole(role) ? ' lead' : ''}`}>
                      {role || 'No role yet'}
                    </span>
                  )}
                </div>
                {stats.total > 0 && <span className="csp-mstat">{stats.done}/{stats.total}</span>}
              </div>
              {stats.total > 0 && (
                <div className="csp-pbar">
                  <span style={{ width: `${Math.round((stats.done / stats.total) * 100)}%` }} />
                </div>
              )}

              {mine.map(t => {
                const mayTick = isAdmin || t.assigneeId === viewerId
                return (
                  <div key={t.id} className={`csp-task${t.done ? ' is-done' : ''}`}>
                    <button
                      type="button"
                      className={`csp-check csp-check-sm${t.done ? ' on' : ''}`}
                      disabled={!mayTick}
                      aria-label={t.done ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
                      onClick={() => mayTick && onToggleTask?.(t, !t.done)}
                    >
                      {t.done && <Check size={10} />}
                    </button>
                    <span className="csp-dot" style={{ background: catColor(colors, t.category) }} />
                    <div className="csp-task-main">
                      <span className="csp-task-t">{t.title}</span>
                      {t.done && t.byName && (
                        <span className="csp-task-by">{t.byName}{t.at ? ` · ${fmtShortDay(t.at)}` : ''}</span>
                      )}
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        className="csp-task-x"
                        aria-label={`Delete task "${t.title}"`}
                        onClick={() => onDeleteTask?.(t)}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                )
              })}
              {!mine.length && <div className="csp-task-none">No tasks yet</div>}

              {canAssign && (
                addingFor === m.id ? (
                  <div className="csp-add">
                    <input
                      className="csp-add-in"
                      placeholder="What needs to be done?"
                      autoFocus
                      value={draft.title}
                      onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') submitTask(m.id) }}
                    />
                    <SuggestInput
                      className="csp-add-in csp-add-cat"
                      placeholder="Category"
                      options={catSuggestions}
                      value={draft.category}
                      onChange={v => setDraft(d => ({ ...d, category: v }))}
                      onEnterEmpty={() => submitTask(m.id)}
                    />
                    <div className="csp-add-row">
                      <button type="button" className="btn btn-primary btn-sm" disabled={!draft.title.trim()} onClick={() => submitTask(m.id)}>
                        Add
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddingFor(''); setDraft({ title: '', category: '' }) }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="csp-assign" onClick={() => { setAddingFor(m.id); setDraft({ title: '', category: '' }) }}>
                    <Plus size={12} /> Assign task
                  </button>
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
