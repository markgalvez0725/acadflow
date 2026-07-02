import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Plus, ChevronDown, ChevronRight, Trash2, Check, Loader2, X, ArrowRight, Users, ListChecks, CalendarDays } from 'lucide-react'
import PageHeader from '@/components/ds/PageHeader'
import EmptyState from '@/components/ds/EmptyState'
import GroupsModal from '@/components/admin/modals/GroupsModal'
import { sortByLastName, getInitials } from '@/utils/format'
import { courseShort } from '@/constants/courses'

// ── Case Studies: standalone grouped practicals ─────────────────────────────
// A case study is grouped work (same Alpha/Bravo/Charlie tool as Activities)
// graded as a TERM PRACTICAL: applying writes each member's percent-of-max
// into gradeComponents[subject].midtermExam or .finalsExam - the exact fields
// the Grades tab edits, through the same admin-only save path. Group scores
// autosave (debounced merge writes); a typed member score overrides just that
// member and survives group-score changes.

function csId() {
  return 'cs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

function classLabel(cls) {
  return cls?.section ? `${courseShort(cls.name)} - ${cls.section}` : courseShort(cls?.name) || 'Class'
}

function todayInput() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fmtDay(ts) {
  return new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

// GroupsModal hands back groups without guaranteed ids; scores are keyed by
// group id, so stamp stable ones (fresh regrouping intentionally resets the
// scores of groups that were replaced).
function normGroups(gs) {
  return (gs || []).map((g, i) => ({
    id: g.id || 'g_' + Date.now().toString(36) + '_' + i + Math.random().toString(36).slice(2, 5),
    name: g.name || `Group ${i + 1}`,
    memberIds: g.memberIds || [],
  }))
}

function Ava({ s, size = 20 }) {
  return (
    <span className="cs-ava" style={{ width: size, height: size }}>
      {s?.photo
        ? <img src={s.photo} alt="" loading="lazy" />
        : <span>{getInitials(s?.name || '?')}</span>}
    </span>
  )
}

export default function CaseStudiesTab() {
  const { caseStudies, students, classes, semester, saveStudents, saveCaseStudy, deleteCaseStudy } = useData()
  const { toast, openDialog } = useUI()

  const activeClasses = useMemo(() => classes.filter(c => !c.archived), [classes])
  const byId = useMemo(() => new Map(students.map(s => [s.id, s])), [students])

  // ── Creation form ────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ title: '', classId: '', subject: '', term: 'midterm', due: todayInput(), maxScore: 100 })
  const [formGroups, setFormGroups] = useState([])
  // 'new' = grouping for the creation form; otherwise the case study being edited.
  const [groupsFor, setGroupsFor] = useState(null)
  const formClass = activeClasses.find(c => c.id === form.classId)

  const rosterClassId = groupsFor === 'new' ? form.classId : groupsFor?.classId
  const roster = useMemo(
    () => sortByLastName((students || []).filter(s => s.classId === rosterClassId || s.classIds?.includes(rosterClassId))),
    [students, rosterClassId]
  )
  const rosterClass = classes.find(c => c.id === rosterClassId)
  const rosterSubject = groupsFor === 'new' ? form.subject : groupsFor?.subject

  function createCaseStudy(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.classId) return
    if (!form.subject) {
      toast(formClass?.subjects?.length ? 'Pick the subject this practical belongs to.' : 'This class has no subjects yet - add one in Classes first.', 'error')
      return
    }
    const cs = {
      id: csId(),
      title: form.title.trim(),
      classId: form.classId,
      className: classLabel(formClass),
      subject: form.subject,
      term: form.term,
      dueAt: new Date((form.due || todayInput()) + 'T23:59:00').getTime(),
      maxScore: Math.max(1, Number(form.maxScore) || 100),
      groups: formGroups,
      scores: {},
      memberScores: {},
      appliedAt: null,
      createdAt: Date.now(),
    }
    saveCaseStudy(cs)
      .then(() => toast('Case study created.', 'success'))
      .catch(() => toast('Failed to create the case study.', 'error'))
    setForm({ title: '', classId: '', subject: '', term: 'midterm', due: todayInput(), maxScore: 100 })
    setFormGroups([])
    setFormOpen(false)
  }

  // ── List + filter ────────────────────────────────────────────────────────
  const [listTab, setListTab] = useState('active')
  const sorted = useMemo(() => caseStudies.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [caseStudies])
  const activeList = sorted.filter(cs => !cs.appliedAt)
  const appliedList = sorted.filter(cs => cs.appliedAt)
  const list = listTab === 'active' ? activeList : appliedList

  // ── Auto-saving score edits ─────────────────────────────────────────────
  // drafts[csId] holds { scores, memberScores } while typing; a debounced
  // merge write persists them and the chip reports saving/saved/error.
  const [drafts, setDrafts] = useState({})
  const [saveState, setSaveState] = useState({})
  const timersRef = useRef({})
  useEffect(() => () => { Object.values(timersRef.current).forEach(clearTimeout) }, [])

  function draftFor(cs) {
    return drafts[cs.id] || { scores: cs.scores || {}, memberScores: cs.memberScores || {} }
  }

  function queueSave(cs, next) {
    setDrafts(d => ({ ...d, [cs.id]: next }))
    setSaveState(s => ({ ...s, [cs.id]: 'saving' }))
    clearTimeout(timersRef.current[cs.id])
    timersRef.current[cs.id] = setTimeout(() => {
      saveCaseStudy({ id: cs.id, scores: next.scores, memberScores: next.memberScores })
        .then(() => setSaveState(s => ({ ...s, [cs.id]: 'saved' })))
        .catch(() => {
          setSaveState(s => ({ ...s, [cs.id]: 'error' }))
          toast('Could not save the scores. Check your connection.', 'error')
        })
    }, 900)
  }

  function parseScore(raw, max) {
    if (raw === '' || raw == null) return null
    const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10)
    if (Number.isNaN(n)) return null
    return Math.max(0, Math.min(max, n))
  }

  function setGroupScore(cs, gid, raw) {
    const d = draftFor(cs)
    const scores = { ...d.scores }
    const v = parseScore(raw, cs.maxScore || 100)
    if (v === null) delete scores[gid]
    else scores[gid] = v
    queueSave(cs, { scores, memberScores: d.memberScores })
  }

  function setMemberScore(cs, sid, raw) {
    const d = draftFor(cs)
    const memberScores = { ...d.memberScores }
    const v = parseScore(raw, cs.maxScore || 100)
    if (v === null) delete memberScores[sid]
    else memberScores[sid] = v
    queueSave(cs, { scores: d.scores, memberScores })
  }

  // ── Expand/collapse groups ──────────────────────────────────────────────
  const [open, setOpen] = useState(() => new Set())
  function toggleOpen(key) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Apply to the term exam ──────────────────────────────────────────────
  const [applyingId, setApplyingId] = useState('')
  async function applyToExam(cs) {
    const d = draftFor(cs)
    const max = cs.maxScore || 100
    const field = cs.term === 'finals' ? 'finalsExam' : 'midtermExam'
    const label = cs.term === 'finals' ? 'Finals Exam' : 'Midterm Exam'
    const perStudent = new Map()
    for (const g of cs.groups || []) {
      const gScore = d.scores?.[g.id]
      for (const sid of g.memberIds || []) {
        const own = d.memberScores?.[sid]
        const sc = own != null ? own : gScore
        if (sc == null) continue
        perStudent.set(sid, Math.max(0, Math.min(100, Math.round((Number(sc) / max) * 100))))
      }
    }
    if (!perStudent.size) { toast('Score at least one group first.', 'error'); return }
    const ok = await openDialog({
      title: `Apply to ${label}?`,
      msg: `${perStudent.size} student${perStudent.size === 1 ? ' gets' : 's get'} their score written into the ${label} grade for ${cs.subject}. Existing values are replaced - you can still edit anyone in Grades.`,
      type: 'info',
      confirmLabel: 'Apply',
      showCancel: true,
    })
    if (!ok) return
    setApplyingId(cs.id)
    try {
      const changedIds = []
      const updated = students.map(s => {
        if (!perStudent.has(s.id)) return s
        changedIds.push(s.id)
        const comps = { ...(s.gradeComponents || {}) }
        comps[cs.subject] = { ...(comps[cs.subject] || {}), [field]: perStudent.get(s.id) }
        return { ...s, gradeComponents: comps }
      })
      await saveStudents(updated, changedIds)
      await saveCaseStudy({ id: cs.id, appliedAt: Date.now(), appliedField: field })
      toast(`Applied to ${label} for ${perStudent.size} student${perStudent.size === 1 ? '' : 's'}.`, 'success')
    } catch {
      toast('Failed to apply the scores.', 'error')
    } finally {
      setApplyingId('')
    }
  }

  async function handleDelete(cs) {
    const ok = await openDialog({
      title: 'Delete this case study?',
      msg: `"${cs.title}" and its scores are removed. Grades already applied to the ${cs.term === 'finals' ? 'Finals' : 'Midterm'} Exam stay untouched.`,
      type: 'danger',
      confirmLabel: 'Delete',
      showCancel: true,
    })
    if (!ok) return
    deleteCaseStudy(cs.id)
      .then(() => toast('Case study deleted.', 'success'))
      .catch(() => toast('Failed to delete the case study.', 'error'))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Case Studies"
        subtitle="Grouped practicals graded into the midterm and finals exams."
        actions={<>
          <span className="badge badge-gray">{activeList.length} active</span>
          <span className="badge badge-gray">{appliedList.length} applied</span>
          <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(o => !o)}>
            {formOpen ? <X size={14} style={{ marginRight: 4 }} /> : <Plus size={14} style={{ marginRight: 4 }} />}
            {formOpen ? 'Close' : 'New case study'}
          </button>
        </>}
      />

      <div className={formOpen ? 'cs-layout' : undefined}>
        {formOpen && (
          <section className="card cs-form">
            <div className="olc-lc-h" style={{ marginBottom: 12 }}>
              <span className="olc-lc-ic"><ListChecks size={17} /></span>
              <div className="olc-lc-name">
                <b>New case study</b>
                <span>Grouped work graded as a term practical exam</span>
              </div>
            </div>
            <form onSubmit={createCaseStudy} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="label">Title</label>
                <input
                  className="input"
                  placeholder="Case Study 1: Systems proposal defense"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="label">Class</label>
                  <select
                    className="input"
                    value={form.classId}
                    onChange={e => setForm(f => ({ ...f, classId: e.target.value, subject: '' }))}
                    required
                  >
                    <option value="">Select class...</option>
                    {activeClasses.map(cls => (
                      <option key={cls.id} value={cls.id}>{classLabel(cls)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Subject</label>
                  <select
                    className="input"
                    value={form.subject}
                    onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  >
                    <option value="">Select subject...</option>
                    {(formClass?.subjects || []).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Counts toward</label>
                <div className="olc-where">
                  <button
                    type="button"
                    className={`olc-wcard${form.term === 'midterm' ? ' on' : ''}`}
                    aria-pressed={form.term === 'midterm'}
                    onClick={() => setForm(f => ({ ...f, term: 'midterm' }))}
                  >
                    <span className="olc-wcard-h"><b>Midterm Practical Exam</b></span>
                    <span className="olc-wcard-sub">Fills the Midterm Exam grade in Grades</span>
                  </button>
                  <button
                    type="button"
                    className={`olc-wcard${form.term === 'finals' ? ' on' : ''}`}
                    aria-pressed={form.term === 'finals'}
                    onClick={() => setForm(f => ({ ...f, term: 'finals' }))}
                  >
                    <span className="olc-wcard-h"><b>Finals Practical Exam</b></span>
                    <span className="olc-wcard-sub">Fills the Finals Exam grade in Grades</span>
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label className="label">Due date</label>
                  <input
                    className="input"
                    type="date"
                    value={form.due}
                    onChange={e => setForm(f => ({ ...f, due: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Max score</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="1000"
                    value={form.maxScore}
                    onChange={e => setForm(f => ({ ...f, maxScore: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Groups</label>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ width: '100%' }}
                    disabled={!form.classId}
                    title={form.classId ? 'Auto-form, build by hand, or paste from Excel' : 'Pick a class first'}
                    onClick={() => setGroupsFor('new')}
                  >
                    <Users size={14} style={{ marginRight: 5 }} />
                    {formGroups.length ? `${formGroups.length} groups` : 'Set up'}
                  </button>
                </div>
              </div>
              {formGroups.length > 0 && (
                <div className="cs-gchips">
                  {formGroups.map(g => (
                    <span key={g.id} className="cs-gchip">{g.name} · {(g.memberIds || []).length}</span>
                  ))}
                </div>
              )}
              <div className="olc-subhint" style={{ marginTop: -4 }}>
                Due date starts at today. Groups use the same tool as Activities and can be edited later.
              </div>
              <div>
                <button className="btn btn-primary" type="submit">
                  <Plus size={15} style={{ marginRight: 6 }} /> Create case study
                </button>
              </div>
            </form>
          </section>
        )}

        <div>
          <div className="seg-filter mb-3">
            <button className={`seg-btn${listTab === 'active' ? ' active' : ''}`} onClick={() => setListTab('active')}>
              Active <span className="seg-count">{activeList.length}</span>
            </button>
            <button className={`seg-btn${listTab === 'applied' ? ' active' : ''}`} onClick={() => setListTab('applied')}>
              Applied <span className="seg-count">{appliedList.length}</span>
            </button>
          </div>

          {list.length === 0 ? (
            <EmptyState
              Icon={ListChecks}
              title={listTab === 'active' ? 'No case studies yet' : 'Nothing applied yet'}
              text={listTab === 'active' ? 'Create one and set up its groups - scores apply straight into the term exam.' : 'Applied case studies land here for the record.'}
              tone="muted"
              compact
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {list.map(cs => {
                const d = draftFor(cs)
                const max = cs.maxScore || 100
                const groups = cs.groups || []
                const memberCount = new Set(groups.flatMap(g => g.memberIds || [])).size
                const termLabel = cs.term === 'finals' ? 'Finals' : 'Midterm'
                const st = saveState[cs.id]
                return (
                  <section key={cs.id} className="card cs-card">
                    <div className="cs-head">
                      <div className="cs-head-t">
                        <b>{cs.title}</b>
                        <span>{cs.className}{cs.subject ? ` · ${cs.subject}` : ''}{cs.dueAt ? ` · Due ${fmtDay(cs.dueAt)}` : ''} · {groups.length} group{groups.length === 1 ? '' : 's'} · {memberCount} student{memberCount === 1 ? '' : 's'}</span>
                      </div>
                      <span className={`cs-term${cs.term === 'finals' ? ' fin' : ''}`}>{termLabel.toUpperCase()} PRACTICAL</span>
                      {st === 'saving' && <span className="cs-save saving"><Loader2 size={11} className="animate-spin" /> Saving...</span>}
                      {st === 'saved' && <span className="cs-save"><Check size={11} /> Saved</span>}
                      {st === 'error' && <span className="cs-save err">Not saved</span>}
                      <button className="btn btn-ghost btn-sm" title="Edit the groups" onClick={() => setGroupsFor(cs)}>
                        <Users size={14} />
                      </button>
                      <button className="btn btn-ghost btn-sm" title="Delete this case study" onClick={() => handleDelete(cs)}>
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {groups.length === 0 && (
                      <div className="cs-empty">No groups yet - use the groups button above to set them up.</div>
                    )}

                    {groups.map(g => {
                      const key = cs.id + ':' + g.id
                      const isOpen = open.has(key)
                      const gv = d.scores?.[g.id]
                      const members = (g.memberIds || []).map(id => byId.get(id)).filter(Boolean)
                      const overrides = (g.memberIds || []).filter(id => d.memberScores?.[id] != null).length
                      return (
                        <div key={g.id} className="cs-group">
                          <div
                            className="cs-ghead"
                            onClick={e => { if (e.target.tagName !== 'INPUT') toggleOpen(key) }}
                            title={isOpen ? 'Hide members' : 'Show members'}
                          >
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <b>{g.name}</b>
                            <span className="cs-avs">
                              {members.slice(0, 4).map(m => <Ava key={m.id} s={m} size={20} />)}
                              {members.length > 4 && <span className="cs-ava cs-ava-more" style={{ width: 20, height: 20 }}>+{members.length - 4}</span>}
                            </span>
                            {overrides > 0 && <span className="cs-ovr-n">{overrides} override{overrides === 1 ? '' : 's'}</span>}
                            <span className="cs-spacer" />
                            <input
                              className="cs-sco"
                              inputMode="numeric"
                              value={gv ?? ''}
                              placeholder="--"
                              onChange={e => setGroupScore(cs, g.id, e.target.value)}
                              aria-label={`${g.name} score`}
                            />
                            <span className="cs-max">/ {max}</span>
                          </div>
                          {isOpen && sortByLastName(members).map(m => {
                            const own = d.memberScores?.[m.id]
                            const isOvr = own != null
                            return (
                              <div key={m.id} className="cs-mrow">
                                <Ava s={m} size={24} />
                                <span className="cs-mname">{m.name}</span>
                                {isOvr ? (
                                  <button className="cs-reset" onClick={() => setMemberScore(cs, m.id, '')} title="Back to the group score">
                                    <X size={10} /> reset
                                  </button>
                                ) : (
                                  <span className="cs-msub">group score</span>
                                )}
                                <input
                                  className={`cs-msco${isOvr ? ' ovr' : ''}`}
                                  inputMode="numeric"
                                  value={own ?? ''}
                                  placeholder={gv != null ? String(gv) : '--'}
                                  onChange={e => setMemberScore(cs, m.id, e.target.value)}
                                  aria-label={`${m.name} score`}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}

                    <div className="cs-foot">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={applyingId === cs.id}
                        onClick={() => applyToExam(cs)}
                      >
                        <ArrowRight size={14} style={{ marginRight: 4 }} />
                        {applyingId === cs.id ? 'Applying...' : `Apply${cs.appliedAt ? ' again' : ''} to ${termLabel} Exam`}
                      </button>
                      {cs.appliedAt && (
                        <span className="cs-applied"><Check size={12} /> Applied {fmtDay(cs.appliedAt)}</span>
                      )}
                      {cs.dueAt && !cs.appliedAt && (
                        <span className="cs-due"><CalendarDays size={12} /> Due {fmtDay(cs.dueAt)}</span>
                      )}
                    </div>
                    <div className="cs-note">
                      Members start at their group score; a typed member score overrides just them. Apply writes each member's score into their {termLabel} Exam grade in Grades - ungraded groups are skipped.
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {groupsFor && (
        <GroupsModal
          roster={roster}
          allStudents={students}
          classes={classes}
          semester={semester}
          classMeta={{ courseName: rosterClass?.name, subject: rosterSubject, section: rosterClass?.section }}
          subjectLabel={[rosterSubject, rosterClass ? `${courseShort(rosterClass.name)} ${rosterClass.section || ''}`.trim() : ''].filter(Boolean).join(' · ')}
          initialGroups={groupsFor === 'new' ? formGroups : (groupsFor.groups || [])}
          initialSize={5}
          onApply={(g) => {
            const groups = normGroups(g)
            if (groupsFor === 'new') setFormGroups(groups)
            else {
              saveCaseStudy({ id: groupsFor.id, groups })
                .then(() => toast('Groups updated.', 'success'))
                .catch(() => toast('Failed to update the groups.', 'error'))
            }
          }}
          onClose={() => setGroupsFor(null)}
        />
      )}
    </div>
  )
}
