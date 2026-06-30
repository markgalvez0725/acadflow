import React, { useState, useMemo } from 'react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'
import { useUI } from '@/context/UIContext'
import { Users, Sparkles, Plus, Minus, X, Trash2, ClipboardPaste, ClipboardList, Copy, Check, CheckCircle2, AlertTriangle } from 'lucide-react'
import { groupName, autoFormGroups } from '@/utils/activitySmart'
import { parseGroupPaste, verifyGroupRows, GROUP_COLUMNS } from '@/utils/groupImportVerifySmart'

// ── Custom groups (paste from Excel) ──────────────────────────────────
// The professor copies a grouping block out of Excel and pastes it here. Excel
// puts the clipboard on the board as TSV, so we parse it, smart-verify each row
// against the class roster, and hand back ready-to-apply groups[]. Pure UI on top
// of parseGroupPaste / verifyGroupRows.
function CustomGroupsPanel({ roster, allStudents, classes, semester, classMeta, onApply, onClose }) {
  const { toast } = useUI()
  const [rawRows, setRawRows] = useState([])

  const verify = useMemo(
    () => verifyGroupRows(rawRows, { roster, allStudents, classes, semester, classMeta }),
    [rawRows, roster, allStudents, classes, semester, classMeta]
  )
  const s = verify.summary

  function handlePaste(e) {
    const text = e.clipboardData?.getData('text/plain') || ''
    if (!text.trim()) return
    e.preventDefault()
    const parsed = parseGroupPaste(text)
    if (!parsed.length) { toast('Could not read any rows from the clipboard.', 'warn'); return }
    setRawRows(prev => [...prev, ...parsed])
    toast(`Added ${parsed.length} row${parsed.length === 1 ? '' : 's'} from the clipboard.`, 'green')
  }
  function copyHeaders() {
    const line = GROUP_COLUMNS.join('\t')
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(line).then(
        () => toast('Column headers copied - paste them into Excel row 1.', 'green'),
        () => toast('Could not copy headers.', 'warn')
      )
    } else { toast('Clipboard not available in this browser.', 'warn') }
  }
  function removeRow(i) { setRawRows(prev => prev.filter((_, idx) => idx !== i)) }
  function clearAll() { setRawRows([]) }
  function apply() {
    if (!verify.groups.length) { toast('No valid rows to apply yet.', 'warn'); return }
    onApply(verify.groups)
    toast(`Applied ${s.assigned} student${s.assigned === 1 ? '' : 's'} across ${verify.groups.length} group${verify.groups.length === 1 ? '' : 's'}.`, 'green')
  }

  const C_WARN = '#B5710D', C_ERR = '#A32D2D'
  const td = { padding: '5px 7px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  const th = { ...td, textAlign: 'left', fontWeight: 600, color: 'var(--ink2)', position: 'sticky', top: 0, background: 'var(--surface2)' }

  return (
    <Modal isOpen onClose={onClose} zIndex={320} wide sheetOnMobile
      header={<ModalHeader flush icon={<ClipboardPaste size={18} />} title="Custom groups" subtitle="Build the grouping in Excel, copy the cells, then paste them below." />}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={apply} disabled={!verify.groups.length}>
          <Check size={16} /> Apply groups
        </button>
      </>}
    >
      <div onPaste={handlePaste}>
        {/* Column-order guide */}
        <div className="mb-3 px-3 py-2 rounded-lg flex items-start gap-2" style={{ background: 'var(--accent-l)', border: '1px solid var(--accent)' }}>
          <ClipboardList size={15} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
          <div className="text-xs" style={{ color: 'var(--accent)', lineHeight: 1.6 }}>
            Match this column order in Excel (M.I. may be left blank):
            <div className="mt-1 font-mono" style={{ fontSize: 11, background: 'var(--surface)', color: 'var(--ink2)', padding: '3px 7px', borderRadius: 4, display: 'inline-block' }}>
              {GROUP_COLUMNS.join('  ·  ')}
            </div>
            <button type="button" className="btn btn-ghost btn-sm ml-2" style={{ verticalAlign: 1 }} onClick={copyHeaders}><Copy size={12} className="inline-block mr-1" />Copy headers</button>
          </div>
        </div>

        {verify.rows.length === 0 ? (
          <div tabIndex={0} className="rounded-lg flex flex-col items-center justify-center text-center"
            style={{ border: '1.5px dashed var(--border)', background: 'var(--surface2)', padding: '34px 16px', outline: 'none', cursor: 'text' }}>
            <ClipboardPaste size={26} style={{ color: 'var(--ink3)' }} />
            <p className="text-sm font-semibold text-ink2 mt-2">Paste your grouping here</p>
            <p className="text-xs text-ink3 mt-1">Copy the cells in Excel, click this panel, then press Ctrl/Cmd + V.</p>
          </div>
        ) : (
          <>
            {/* Summary chips */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--green-l, #EAF3DE)', color: 'var(--green, #3B6D11)' }}><Check size={12} className="inline-block mr-1" style={{ verticalAlign: -2 }} />{s.assigned} assigned</span>
              {s.review > 0 && <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(181,113,13,.12)', color: C_WARN }}>{s.review} need review</span>}
              {s.notEnrolled > 0 && <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(163,45,45,.1)', color: C_ERR }}>{s.notEnrolled} not enrolled</span>}
              {s.skipped > 0 && <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(163,45,45,.1)', color: C_ERR }}>{s.skipped} skipped</span>}
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface2)', color: 'var(--ink2)', border: '1px solid var(--border)' }}>{s.groupCount} group{s.groupCount === 1 ? '' : 's'}</span>
            </div>

            <div style={{ maxHeight: '46vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 30 }} /><col style={{ width: 92 }} /><col /><col /><col style={{ width: 44 }} />
                  <col style={{ width: 72 }} /><col style={{ width: 72 }} /><col style={{ width: 56 }} /><col style={{ width: 52 }} /><col style={{ width: 30 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={th}></th><th style={th}>ID</th><th style={th}>Surname</th><th style={th}>First name</th><th style={th}>M.I.</th>
                    <th style={th}>Group</th><th style={th}>Course</th><th style={th}>Section</th><th style={th}>Year</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {verify.rows.map(r => {
                    const tint = r.status === 'error' ? 'rgba(163,45,45,.06)' : r.status === 'warn' ? 'rgba(181,113,13,.07)' : 'transparent'
                    const ink = r.status === 'error' ? C_ERR : r.status === 'warn' ? C_WARN : 'var(--ink)'
                    return (
                      <React.Fragment key={r.i}>
                        <tr style={{ borderTop: '1px solid var(--border)', background: tint }}>
                          <td style={{ ...td, textAlign: 'center' }}>
                            {r.status === 'ok' ? <CheckCircle2 size={15} style={{ color: 'var(--green)' }} />
                              : r.status === 'warn' ? <AlertTriangle size={15} style={{ color: C_WARN }} />
                              : <X size={15} style={{ color: C_ERR }} />}
                          </td>
                          <td style={{ ...td, fontFamily: 'var(--font-mono)', color: 'var(--ink3)' }} title={r.id}>{r.id || '-'}</td>
                          <td style={{ ...td, color: ink }} title={r.surname}>{r.surname || '-'}</td>
                          <td style={{ ...td, color: ink }} title={r.first}>{r.first || '-'}</td>
                          <td style={{ ...td, color: 'var(--ink2)' }}>{r.mi || ''}</td>
                          <td style={{ ...td, color: r.applied ? 'var(--accent)' : 'var(--ink3)' }}>{r.groupLabel || r.group || '-'}</td>
                          <td style={{ ...td, color: 'var(--ink3)' }} title={r.course}>{r.course || ''}</td>
                          <td style={{ ...td, color: 'var(--ink3)' }} title={r.section}>{r.section || ''}</td>
                          <td style={{ ...td, color: 'var(--ink3)' }} title={r.year}>{r.year || ''}</td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <button type="button" className="btn btn-ghost btn-sm text-red-500" style={{ padding: 2 }} title="Remove row" onClick={() => removeRow(r.i)}><X size={13} /></button>
                          </td>
                        </tr>
                        {r.warnings.length > 0 && (
                          <tr style={{ background: tint }}>
                            <td></td>
                            <td colSpan={9} style={{ padding: '0 7px 5px', fontSize: 11, color: ink }}>
                              {r.warnings.join('  •  ')}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-ink3">Pasting more rows adds to the list. Applying replaces the current groups.</span>
              <button type="button" className="btn btn-ghost btn-sm text-red-500" onClick={clearAll}><Trash2 size={13} className="inline-block mr-1" />Clear all</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ── One group card: phonetic name + member chips, with an inline picker to add
// students. Removing a member or adding from the picker both flow through the
// same `onToggle`, which keeps the one-student-per-group rule.
function GroupCard({ group, badge, roster, assignedIds, onRename, onRemove, onToggle }) {
  const [adding, setAdding] = useState(false)
  const members = roster.filter(s => (group.memberIds || []).includes(s.id))

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 11 }}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent-l)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{badge}</span>
        <input className="input" style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, height: 30 }} value={group.name} onChange={e => onRename(group.id, e.target.value)} aria-label="Group name" />
        <span className="text-xs text-ink3">{members.length}</span>
        <button type="button" className="btn btn-ghost btn-sm text-red-500" style={{ padding: 4 }} onClick={() => onRemove(group.id)} aria-label="Remove group"><Trash2 size={14} /></button>
      </div>

      <div className="flex flex-wrap gap-1">
        {members.map(s => (
          <button key={s.id} type="button" onClick={() => onToggle(group.id, s.id)} title="Remove from group"
            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {s.name}<X size={11} />
          </button>
        ))}
        <button type="button" onClick={() => setAdding(a => !a)}
          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, cursor: 'pointer', background: 'var(--surface2)', color: 'var(--ink2)', border: '1px dashed var(--border2)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Plus size={12} />{adding ? 'Done' : 'Add'}
        </button>
      </div>

      {adding && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px dashed var(--border)' }}>
          <div className="flex flex-wrap gap-1">
            {roster.filter(s => !(group.memberIds || []).includes(s.id)).map(s => {
              const elsewhere = assignedIds.has(s.id)
              return (
                <button key={s.id} type="button" onClick={() => onToggle(group.id, s.id)}
                  title={elsewhere ? 'In another group - click to move here' : 'Add to group'}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, cursor: 'pointer', background: 'var(--surface2)', color: elsewhere ? 'var(--ink3)' : 'var(--ink2)', border: '1px solid var(--border)', opacity: elsewhere ? 0.6 : 1 }}>
                  {s.name}
                </button>
              )
            })}
            {roster.filter(s => !(group.memberIds || []).includes(s.id)).length === 0 && (
              <span className="text-xs text-ink3">Everyone is in this group.</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Dedicated grouping modal ──────────────────────────────────────────────
// Edits a local copy of the groups and hands the result back via `onApply`.
// All the grouping behaviour (auto-form, NATO phonetic names, one-student-per-
// group) is unchanged - only relocated out of the activity form.
export default function GroupsModal({ roster, allStudents, classes, semester, classMeta, subjectLabel, initialGroups = [], initialSize = 3, onApply, onClose }) {
  const { toast } = useUI()
  const [groups, setGroups] = useState(() => initialGroups.map(g => ({ ...g, memberIds: [...(g.memberIds || [])] })))
  const [groupSize, setGroupSize] = useState(initialSize)
  const [autoForming, setAutoForming] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)

  const assignedIds = useMemo(() => new Set(groups.flatMap(g => g.memberIds || [])), [groups])
  const unassigned = useMemo(() => roster.filter(s => !assignedIds.has(s.id)), [roster, assignedIds])

  function addGroup() {
    setGroups(g => [...g, { id: 'g_' + Date.now() + '_' + g.length, name: groupName(g.length), memberIds: [] }])
  }
  function removeGroup(id) { setGroups(g => g.filter(x => x.id !== id)) }
  function renameGroup(id, name) { setGroups(g => g.map(x => x.id === id ? { ...x, name } : x)) }
  function toggleMember(groupId, sid) {
    setGroups(g => g.map(x => {
      if (x.id === groupId) {
        const has = (x.memberIds || []).includes(sid)
        return { ...x, memberIds: has ? x.memberIds.filter(i => i !== sid) : [...(x.memberIds || []), sid] }
      }
      // A student can be in only one group - strip them from every other group.
      return { ...x, memberIds: (x.memberIds || []).filter(i => i !== sid) }
    }))
  }
  function clampSize(n) { return Math.max(2, Math.min(10, n)) }
  async function autoForm() {
    if (!roster.length) { toast('Select a class with students first.', 'warn'); return }
    setAutoForming(true)
    try {
      const formed = await autoFormGroups(roster.map(s => ({ id: s.id, name: s.name })), groupSize)
      setGroups(formed)
      toast(`Formed ${formed.length} balanced group${formed.length === 1 ? '' : 's'}.`, 'green')
    } catch {
      toast('Could not auto-form groups.', 'warn')
    } finally { setAutoForming(false) }
  }
  function save() {
    onApply(groups, groupSize)
    onClose()
  }

  const grouped = assignedIds.size
  const pct = roster.length ? Math.round((grouped / roster.length) * 100) : 0

  return (
    <Modal isOpen onClose={onClose} zIndex={310} wide sheetOnMobile
      header={<ModalHeader flush icon={<Users size={18} />} title="Set up groups" subtitle={`${roster.length} student${roster.length === 1 ? '' : 's'}${subjectLabel ? ` · ${subjectLabel}` : ''}`} />}
      footer={<>
        <span className="text-xs text-ink3" style={{ marginRight: 'auto' }}>Each student can be in one group.</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save}><Check size={16} /> Save groups</button>
      </>}
    >
      {roster.length === 0 ? (
        <p className="text-xs text-ink3">Select a class with registered students first.</p>
      ) : (
        <>
          {/* Toolbar: size + actions */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className="text-xs text-ink2">Students per group</span>
            <div className="inline-flex items-center" style={{ border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden' }}>
              <button type="button" aria-label="Fewer per group" onClick={() => setGroupSize(s => clampSize(s - 1))} style={{ width: 28, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink2)', borderRight: '1px solid var(--border)' }}><Minus size={14} /></button>
              <span style={{ width: 34, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{groupSize}</span>
              <button type="button" aria-label="More per group" onClick={() => setGroupSize(s => clampSize(s + 1))} style={{ width: 28, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink2)', borderLeft: '1px solid var(--border)' }}><Plus size={14} /></button>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-primary btn-sm" onClick={autoForm} disabled={autoForming}>
              <Sparkles size={13} className="inline-block mr-1" />{autoForming ? 'Forming…' : 'Auto-form'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addGroup}><Plus size={13} className="inline-block mr-1" />Add group</button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }} onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={13} className="inline-block mr-1" />Custom groups
            </button>
          </div>

          {/* Progress */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-ink">{grouped} of {roster.length} grouped</span>
              <span className="text-xs text-ink3">{unassigned.length} unassigned</span>
            </div>
            <div style={{ height: 5, background: 'var(--surface3)', borderRadius: 99, overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          </div>

          {/* Unassigned pool (read-only glance; assign from each group's Add) */}
          {unassigned.length > 0 && (
            <div className="mb-3 px-3 py-2 rounded-lg" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <div className="text-xs text-ink3 mb-1">Unassigned students</div>
              <div className="flex flex-wrap gap-1">
                {unassigned.map(s => (
                  <span key={s.id} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink2)' }}>{s.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Groups */}
          {groups.length === 0 ? (
            <div style={{ border: '1.5px dashed var(--border2)', borderRadius: 10, padding: '28px 16px', textAlign: 'center' }}>
              <Users size={24} style={{ color: 'var(--ink3)', margin: '0 auto 6px' }} />
              <p className="text-sm font-semibold text-ink2">No groups yet</p>
              <p className="text-xs text-ink3 mt-1">Click <strong>Auto-form</strong> to build balanced teams, or <strong>Add group</strong> to start one by hand.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {groups.map((g, i) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  badge={(g.name || '').trim().charAt(0).toUpperCase() || String(i + 1)}
                  roster={roster}
                  assignedIds={assignedIds}
                  onRename={renameGroup}
                  onRemove={removeGroup}
                  onToggle={toggleMember}
                />
              ))}
              <button type="button" onClick={addGroup}
                style={{ border: '1.5px dashed var(--border2)', borderRadius: 10, padding: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12, fontWeight: 600, minHeight: 64, cursor: 'pointer', background: 'transparent' }}>
                <Plus size={15} /> Add group
              </button>
            </div>
          )}
        </>
      )}

      {pasteOpen && (
        <CustomGroupsPanel
          roster={roster}
          allStudents={allStudents}
          classes={classes}
          semester={semester}
          classMeta={classMeta}
          onApply={g => { setGroups(g); setPasteOpen(false) }}
          onClose={() => setPasteOpen(false)}
        />
      )}
    </Modal>
  )
}
