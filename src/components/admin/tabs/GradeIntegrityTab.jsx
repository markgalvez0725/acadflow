import React, { useMemo, useState } from 'react'
import {
  AlertTriangle, RefreshCw, CheckCircle2, Pencil,
  ChevronDown, Search, Sparkles, Check, X, Info, ArrowRight,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { verifyPublishedGrade } from '@/utils/gradeEngine'
import { courseShort } from '@/constants/courses'

// ── Grade Integrity ────────────────────────────────────────────────────────
// Every published grade, its full computation breakdown, a publish history
// timeline, and an on-device AI re-audit of each one. The verifier recomputes
// every number from the GradeEngine (no model, no network), so its verdict can
// never disagree with what the student and gradebook show.

const STATUS = {
  verified: { label: 'Verified',        Icon: CheckCircle2,  c: 'var(--green)',  bg: 'var(--green-l)' },
  drift:    { label: 'Needs recompute', Icon: AlertTriangle, c: 'var(--yellow)', bg: 'var(--yellow-l)' },
  override: { label: 'Override',        Icon: Pencil,        c: 'var(--accent)', bg: 'var(--accent-l)' },
  anomaly:  { label: 'Anomaly',         Icon: AlertTriangle, c: 'var(--red)',    bg: 'var(--red-l)' },
}
const RANK = { anomaly: 0, drift: 1, override: 2, verified: 3 }
const ACTION_LABEL = { published: 'Published', recomputed: 'Recomputed', imported: 'Imported', live: 'Live · current data' }

const enrolledIdsOf = s => (s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : []))
const r1 = n => (n == null ? '-' : Math.round(n * 10) / 10)
const fmtDate = ts => {
  if (!ts) return '-'
  try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '-' }
}
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

export default function GradeIntegrityTab() {
  const { students, activities, quizzes, classes, eqScale, gradeFloor, syncDriftedGrades } = useData()
  const { toast, openDialog } = useUI()
  const [busy, setBusy]               = useState(false)
  const [search, setSearch]           = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded]       = useState(null)

  // Build one record per published student×subject, each fully verified.
  const records = useMemo(() => {
    const ctx = { activities, quizzes, students, classes, eqScale, floor: gradeFloor }
    const out = []
    for (const s of students) {
      const enrolledIds = enrolledIdsOf(s)
      for (const sub of Object.keys(s.gradeComponents || {})) {
        const comp = s.gradeComponents[sub]
        const isPublished = comp?.midterm != null && comp?.finals != null && s.gradeUploadedAt?.[sub]
        if (!isPublished) continue
        const v = verifyPublishedGrade(s, sub, ctx)
        const cls = classes.find(c => enrolledIds.includes(c.id) && c.subjects?.includes(sub))
          || classes.find(c => c.subjects?.includes(sub))
        const courseLabel = cls ? `${courseShort(cls.name)}${cls.section ? ' ' + cls.section : ''}` : '-'
        out.push({
          key: s.id + '|' + sub,
          studentId: s.id, name: s.name || s.id, sub,
          courseLabel, classId: cls?.id || null,
          v, history: buildHistory(s, sub, v),
        })
      }
    }
    out.sort((a, b) => (RANK[a.v.status] - RANK[b.v.status]) || a.name.localeCompare(b.name))
    return out
  }, [students, activities, quizzes, classes, eqScale, gradeFloor])

  const counts = useMemo(() => {
    const c = { total: records.length, verified: 0, drift: 0, override: 0, anomaly: 0 }
    records.forEach(r => { c[r.v.status] += 1 })
    return c
  }, [records])

  const classOptions = useMemo(() => {
    const seen = new Map()
    records.forEach(r => { if (r.classId && !seen.has(r.classId)) seen.set(r.classId, r.courseLabel) })
    return [...seen.entries()]
  }, [records])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter(r => {
      if (statusFilter !== 'all' && r.v.status !== statusFilter) return false
      if (classFilter !== 'all' && r.classId !== classFilter) return false
      if (q && !(r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q) || r.courseLabel.toLowerCase().includes(q))) return false
      return true
    })
  }, [records, search, classFilter, statusFilter])

  // Recomputable = drifted inputs or a corrupted stored value (anomaly). An
  // override is intentional and never auto-recomputed.
  const driftRecords = useMemo(() => records.filter(r => r.v.status === 'drift' || r.v.status === 'anomaly'), [records])

  async function syncOne(rec) {
    setBusy(true)
    try {
      await syncDriftedGrades([{ studentId: rec.studentId, subject: rec.sub }])
      toast(`${rec.name} · ${rec.sub} recomputed & re-published.`, 'green')
    } catch (e) { toast('Sync failed: ' + e.message, 'red') }
    finally { setBusy(false) }
  }

  async function syncAll() {
    if (!driftRecords.length) return
    const ok = await openDialog({
      title: `Recompute ${driftRecords.length} grade${driftRecords.length > 1 ? 's' : ''}?`,
      msg: 'Each drifted grade is recomputed from the current activities, quizzes, and attendance, then re-published. This overwrites the stored term grades for those subjects and adds a history entry.',
      type: 'warning', confirmLabel: 'Recompute & sync', showCancel: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const n = await syncDriftedGrades(driftRecords.map(r => ({ studentId: r.studentId, subject: r.sub })))
      toast(`Synced ${n} grade${n > 1 ? 's' : ''} - all now match the live data.`, 'green')
    } catch (e) { toast('Sync failed: ' + e.message, 'red') }
    finally { setBusy(false) }
  }

  function reVerifyAll() {
    const { total, verified, drift, anomaly } = counts
    if (!total) { toast('No published grades to verify yet.', 'blue'); return }
    if (drift || anomaly) toast(`Re-verified ${total} grade${total > 1 ? 's' : ''} - ${drift + anomaly} need attention.`, 'yellow')
    else toast(`Re-verified ${total} grade${total > 1 ? 's' : ''} - all consistent.`, 'green')
  }

  return (
    <div style={{ maxWidth: 940, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={reVerifyAll} disabled={busy}>
          <RefreshCw size={14} /> Re-verify all
        </button>
        {driftRecords.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={syncAll} disabled={busy}>
            <RefreshCw size={14} /> Recompute &amp; sync all
          </button>
        )}
      </div>

      {/* Summary metric cards - click to filter */}
      <div className="gi-metrics" style={{ marginBottom: 16 }}>
        <MetricCard label="Published" value={counts.total} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <MetricCard label="Verified" value={counts.verified} c="var(--green)" bg="var(--green-l)" active={statusFilter === 'verified'} onClick={() => setStatusFilter(s => s === 'verified' ? 'all' : 'verified')} />
        <MetricCard label="Needs recompute" value={counts.drift} c="var(--yellow)" bg="var(--yellow-l)" active={statusFilter === 'drift'} onClick={() => setStatusFilter(s => s === 'drift' ? 'all' : 'drift')} />
        <MetricCard label="Overrides" value={counts.override} c="var(--accent)" bg="var(--accent-l)" active={statusFilter === 'override'} onClick={() => setStatusFilter(s => s === 'override' ? 'all' : 'override')} />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={16} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink3)', pointerEvents: 'none' }} />
          <input
            className="input"
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search student or subject"
            style={{ paddingLeft: 34 }}
          />
        </div>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All classes</option>
          {classOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      {records.length === 0 ? (
        <div className="empty" style={{ padding: '40px 0' }}>
          <div className="empty-icon"><CheckCircle2 size={40} /></div>
          No grades are published yet. Once you upload grades in the Grades tab, every one shows here with its history and an AI verification.
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty" style={{ padding: '32px 0' }}>Nothing matches this filter.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(rec => (
            <RecordRow
              key={rec.key} rec={rec} busy={busy}
              expanded={expanded === rec.key}
              onToggle={() => setExpanded(k => k === rec.key ? null : rec.key)}
              onSync={() => syncOne(rec)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Real append-only history when present; otherwise seed one display point from
// the stored snapshot so the timeline is never empty for existing grades. When
// a grade has drifted, a synthetic "live" node shows the current divergence.
function buildHistory(s, sub, v) {
  const real = Array.isArray(s.gradeHistory?.[sub]) ? s.gradeHistory[sub] : []
  let list
  if (real.length) {
    list = [...real].reverse()
  } else {
    const snap = s.gradeSnapshots?.[sub]
    list = [{
      at: s.gradeUploadedAt?.[sub] || snap?.at || null, action: 'published', seeded: true,
      final: v.final, midterm: v.breakdown.midterm, finals: v.breakdown.finals,
      components: v.components, hash: snap?.hash || null,
    }]
  }
  if (v.drift) list = [{ action: 'live', final: v.liveFinal, components: v.live.components, hash: null }, ...list]
  return list
}

function MetricCard({ label, value, c, bg, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: '12px 14px',
        background: bg || 'var(--surface2)',
        border: active ? '1.5px solid ' + (c || 'var(--accent)') : '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: 12.5, color: c || 'var(--ink2)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: c || 'var(--ink)' }}>{value}</div>
    </button>
  )
}

function RecordRow({ rec, expanded, onToggle, onSync, busy }) {
  const { v } = rec
  const st = STATUS[v.status]
  const c = v.components
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid ' + (expanded ? 'var(--accent)' : 'var(--border)'), borderRadius: 14, overflow: 'hidden' }}>
      {/* Header row */}
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: st.bg, color: st.c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700 }}>
          {initials(rec.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{rec.courseLabel} · {rec.sub}</div>
        </div>
        <div className="gi-chips">
          <Chip label="Act" val={c.activities} />
          <Chip label="Qz" val={c.quizzes} />
          <Chip label="Att" val={c.attendance} />
        </div>
        <div className="gi-final">
          {v.drift ? (
            <div style={{ fontSize: 13 }}>
              <span style={{ textDecoration: 'line-through', color: 'var(--ink3)' }}>{r1(v.final)}</span>{' → '}
              <strong style={{ color: 'var(--accent)' }}>{r1(v.liveFinal)}</strong>
            </div>
          ) : (
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{r1(v.final)}</div>
          )}
          <div style={{ fontSize: 11, color: v.drift ? 'var(--yellow)' : 'var(--ink2)' }}>
            {v.drift ? `Δ ${r1(v.delta)}` : (v.equiv?.eq && v.equiv.eq !== '-' ? v.equiv.eq : '')}
          </div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 7, background: st.bg, color: st.c, whiteSpace: 'nowrap', flexShrink: 0 }}>
          <st.Icon size={13} /> {st.label}
        </span>
        <ChevronDown size={18} style={{ color: 'var(--ink3)', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 16, background: 'var(--surface2)' }}>
          {/* Computation breakdown */}
          <SectionLabel>Computation breakdown</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 14 }}>
            <CompCard label="Activities" stored={c.activities} live={v.drift ? v.live.components.activities : null} sub={`avg of ${v.breakdown.detail.activityItems.length} item${v.breakdown.detail.activityItems.length === 1 ? '' : 's'}`} />
            <CompCard label="Quizzes" stored={c.quizzes} live={v.drift ? v.live.components.quizzes : null} sub={`avg of ${v.breakdown.detail.quizItems.length} item${v.breakdown.detail.quizItems.length === 1 ? '' : 's'}`} />
            <CompCard label="Attendance" stored={c.attendance} live={v.drift ? v.live.components.attendance : null} sub={`${v.breakdown.detail.attendance.present} / ${v.breakdown.detail.attendance.held} held`} />
            <CompCard label="Attitude" stored={c.attitude} sub="teacher input" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, marginBottom: 16 }}>
            <Pill>CS {r1(v.breakdown.cs)}</Pill>
            <ArrowRight size={13} style={{ color: 'var(--ink3)' }} />
            <Pill>Midterm {r1(v.breakdown.midterm)}</Pill>
            <Pill>Finals {r1(v.breakdown.finals)}</Pill>
            <ArrowRight size={13} style={{ color: 'var(--ink3)' }} />
            <Pill accent>Final {r1(v.final)}{v.equiv?.eq && v.equiv.eq !== '-' ? ` · ${v.equiv.eq}` : ''}</Pill>
          </div>

          <div className="gi-detail-grid">
            {/* History timeline */}
            <div>
              <SectionLabel>Publish history</SectionLabel>
              <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rec.history.map((h, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: -20, top: 3, width: 9, height: 9, borderRadius: '50%', background: i === 0 ? (v.drift ? 'var(--yellow)' : 'var(--accent)') : 'var(--ink3)', boxShadow: '0 0 0 3px var(--surface2)' }} />
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {ACTION_LABEL[h.action] || h.action}{h.action !== 'live' && h.at ? ` · ${fmtDate(h.at)}` : ''}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink2)' }}>
                      Final {r1(h.final)}{h.midterm != null ? ` · MT ${r1(h.midterm)}` : ''}{h.finals != null ? ` · FT ${r1(h.finals)}` : ''}{h.seeded ? ' · from snapshot' : ''}
                    </div>
                    {h.hash && <div style={{ fontSize: 10.5, color: 'var(--ink3)', fontFamily: 'monospace' }}>{h.hash}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* AI verification */}
            <div>
              <SectionLabel>AI verification</SectionLabel>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
                  <Sparkles size={15} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>On-device audit</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {v.checks.map(ch => (
                    <div key={ch.key} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 12 }}>
                      <CheckIcon state={ch.state} />
                      <span style={{ color: 'var(--ink2)' }}>{ch.label}</span>
                    </div>
                  ))}
                </div>
                {v.summary && (
                  <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px dashed var(--border)', fontSize: 11.5, color: 'var(--ink2)', lineHeight: 1.5 }}>
                    {v.summary}
                  </div>
                )}
                {(v.drift || v.status === 'anomaly') && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={onSync} style={{ width: '100%', marginTop: 10 }}>
                    <RefreshCw size={14} /> Recompute &amp; re-publish
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({ label, val }) {
  return (
    <span style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, background: 'var(--surface2)', color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
      {label} {r1(val)}
    </span>
  )
}

function CompCard({ label, stored, live, sub }) {
  const drifted = live != null && stored != null && Math.abs(live - stored) > 0.01
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--ink2)' }}>{label}{drifted ? <span style={{ color: 'var(--yellow)' }}> ⚠</span> : null}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
        {r1(stored)}{drifted ? <span style={{ fontSize: 11, color: 'var(--ink3)', fontWeight: 400 }}> → {r1(live)}</span> : null}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--ink3)' }}>{sub}</div>
    </div>
  )
}

function Pill({ children, accent }) {
  return (
    <span style={{ padding: '3px 8px', borderRadius: 6, fontWeight: accent ? 600 : 400, background: accent ? 'var(--accent-l)' : 'var(--surface)', color: accent ? 'var(--accent)' : 'var(--ink2)', border: '1px solid var(--border)' }}>
      {children}
    </span>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 8 }}>{children}</div>
}

function CheckIcon({ state }) {
  if (state === 'ok')   return <Check size={15} style={{ color: 'var(--green)', flexShrink: 0 }} />
  if (state === 'warn') return <AlertTriangle size={15} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
  if (state === 'fail') return <X size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
  return <Info size={15} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
}
