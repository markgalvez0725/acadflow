import React, { useMemo, useState } from 'react'
import { useData } from '@/context/DataContext'
import PageHeader from '@/components/ds/PageHeader'
import { Library, ExternalLink, BookOpen, ShieldCheck, Sparkles, Folder, FolderX, Search } from 'lucide-react'
import { resourceType, RESOURCE_TYPES } from '@/utils/resourceTypes'
import { activeClassIds, activeSubjects } from '@/utils/active'
import { subjectColor } from '@/utils/subjectColor'

const WEEK = 7 * 86400000

// Subject-coverage ring (deterministic; mirrors the "N of M subjects" stat).
function CoverageRing({ covered, totalSubs, color }) {
  const rate = totalSubs ? covered / totalSubs : 0
  const C = 2 * Math.PI * 34
  const off = C * (1 - Math.max(0, Math.min(1, rate)))
  return (
    <svg width="80" height="80" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="34" fill="none" stroke="var(--border)" strokeWidth="9" />
      <circle cx="42" cy="42" r="34" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 42 42)" />
      <text x="42" y="39" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--ink)">{covered}/{totalSubs}</text>
      <text x="42" y="54" textAnchor="middle" fontSize="8.5" fill="var(--ink3)">subjects</text>
    </svg>
  )
}

export default function ResourcesTab({ student: s, viewClassId, classes }) {
  const { resources, semester, fbReady } = useData()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const now = Date.now()
  const enrolledIds = useMemo(() => activeClassIds(s, classes, semester), [s, classes, semester])
  const allSubs = useMemo(() => activeSubjects(s, classes, semester), [s, classes, semester])

  // Respect the class switcher: when a specific class is in view, scope to it.
  const viewCls = classes.find(c => c.id === viewClassId)
  const subs = viewCls ? (viewCls.subjects || []) : allSubs

  // Flat list of the student's materials (active classes + visible subjects).
  const mine = useMemo(() =>
    resources.filter(r =>
      enrolledIds.includes(r.classId) &&
      subs.includes(r.subject) &&
      (!viewClassId || r.classId === viewClassId)
    ),
    [resources, enrolledIds, subs, viewClassId]
  )

  // Library standing — total, subjects covered, new-this-week, by subject. All
  // recomputed from `mine` so the ring and Resource Watch can't disagree.
  const stats = useMemo(() => {
    const covered = [...new Set(mine.map(r => r.subject))]
    const missing = subs.filter(sub => !covered.includes(sub))
    const fresh = mine.filter(r => now - (r.createdAt || 0) <= WEEK)
    const bySub = {}
    mine.forEach(r => { bySub[r.subject] = (bySub[r.subject] || 0) + 1 })
    let best = null
    Object.entries(bySub).forEach(([sub, n]) => { if (!best || n > best.n) best = { sub, n } })
    return { covered, missing, fresh, best, total: mine.length, totalSubs: subs.length }
  }, [mine, subs, now])

  const ringColor = (() => {
    const rate = stats.totalSubs ? stats.covered.length / stats.totalSubs : 0
    return rate >= 0.8 ? 'var(--green)' : rate >= 0.5 ? 'var(--gold-var)' : 'var(--red)'
  })()

  // Deterministic "Resource Watch" findings.
  const watch = useMemo(() => {
    const f = []
    if (stats.fresh.length) {
      const subj = [...new Set(stats.fresh.map(r => r.subject))]
      f.push({ tone: 'info', Icon: Sparkles, lead: `${stats.fresh.length} new this week`, text: ` — ${subj.slice(0, 2).join(', ')}${subj.length > 2 ? '…' : ''}.` })
    }
    if (stats.best && stats.best.n >= 1)
      f.push({ tone: 'good', Icon: Folder, lead: 'Best stocked', text: ` — ${stats.best.sub} has ${stats.best.n} material${stats.best.n > 1 ? 's' : ''}.` })
    if (stats.missing.length)
      f.push({ tone: 'warn', Icon: FolderX, lead: 'Nothing yet', text: ` — ${stats.missing.slice(0, 2).join(', ')}${stats.missing.length > 2 ? ` +${stats.missing.length - 2}` : ''} ${stats.missing.length > 1 ? 'have' : 'has'} no materials posted.` })
    if (!f.length)
      f.push({ tone: 'good', Icon: ShieldCheck, lead: 'All set', text: ' — materials are posted for every subject.' })
    const lead = stats.fresh.length
      ? `${stats.fresh.length} new material${stats.fresh.length > 1 ? 's' : ''} this week${stats.missing.length ? ' — and one subject still has none.' : '.'}`
      : stats.total
        ? `${stats.total} material${stats.total > 1 ? 's' : ''} across ${stats.covered.length} subject${stats.covered.length > 1 ? 's' : ''}.`
        : 'No materials posted yet.'
    return { findings: f.slice(0, 4), lead }
  }, [stats])

  // Type filter pills — only the types actually present, with counts.
  const typePills = useMemo(() => {
    const present = {}
    mine.forEach(r => { present[r.type] = (present[r.type] || 0) + 1 })
    const pills = [{ key: 'all', label: 'All', count: mine.length }]
    RESOURCE_TYPES.forEach(t => { if (present[t.key]) pills.push({ key: t.key, label: t.label, count: present[t.key] }) })
    return pills
  }, [mine])

  // Filtered + grouped-by-subject (search + type narrow within the groups).
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = mine.filter(r =>
      (typeFilter === 'all' || r.type === typeFilter) &&
      (!q || `${r.title} ${r.description || ''}`.toLowerCase().includes(q))
    )
    const bySub = {}
    for (const r of filtered) (bySub[r.subject] ||= []).push(r)
    for (const k of Object.keys(bySub)) bySub[k].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return bySub
  }, [mine, query, typeFilter])

  const subjectsWithResources = Object.keys(grouped).sort((a, b) => a.localeCompare(b))

  if (!fbReady) return null

  return (
    <div className="student-resources">
      <PageHeader
        crumb={<><Library size={13} /> Resources</>}
        title="Resource Hub"
        subtitle={`${stats.total} material${stats.total === 1 ? '' : 's'} from your teacher`}
      />

      {!mine.length ? (
        <div className="empty">
          <div className="empty-icon"><Library size={40} /></div>
          No resources posted yet. Your teacher's modules, slides, and links will appear here.
        </div>
      ) : (
        <>
          {/* Coverage ring + Resource Watch */}
          <div className="sact-top">
            <div className="sact-card sact-ring-card">
              <CoverageRing covered={stats.covered.length} totalSubs={stats.totalSubs} color={ringColor} />
              <div className="sact-ring-meta">
                <strong>{stats.total} material{stats.total === 1 ? '' : 's'}</strong><br />
                {stats.covered.length} of {stats.totalSubs} subjects<br />
                {stats.fresh.length ? `${stats.fresh.length} new this week` : 'none new this week'}
              </div>
            </div>

            <div className="sact-card sact-watch">
              <div className="sact-watch-h">
                <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />
                <span className="sact-watch-title">Resource Watch</span>
                <span className="sact-chip-tag">on-device</span>
              </div>
              <div className="sact-watch-lead">{watch.lead}</div>
              {watch.findings.map((fd, i) => (
                <div key={i} className={`sact-find sact-find-${fd.tone}`}>
                  <fd.Icon size={16} />
                  <div className="sact-find-txt"><strong>{fd.lead}</strong>{fd.text}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Search */}
          <div className="res-search">
            <Search size={16} />
            <input
              className="input"
              placeholder="Search materials by title or topic…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search materials"
            />
          </div>

          {/* Type filter pills */}
          <div className="sact-pills">
            {typePills.map(p => (
              <button
                key={p.key}
                className={`sact-pill ${typeFilter === p.key ? 'on' : ''}`}
                onClick={() => setTypeFilter(p.key)}
              >
                {p.label} {p.count}
              </button>
            ))}
          </div>

          {!subjectsWithResources.length ? (
            <div className="empty" style={{ padding: '32px 16px' }}>
              <div className="empty-icon"><Search size={34} /></div>
              No materials match your search.
            </div>
          ) : (
            subjectsWithResources.map(subject => (
              <div key={subject} style={{ marginBottom: 22 }}>
                <div className="sec-hdr" style={{ marginBottom: 10 }}>
                  <div className="sec-title sec-title-ic" style={{ color: subjectColor(subject).color }}>
                    <BookOpen /> {subject} <span className="res-sub-count">· {grouped[subject].length}</span>
                  </div>
                </div>
                <div className="res-grid">
                  {grouped[subject].map(r => {
                    const { Icon, label } = resourceType(r.type)
                    const isNew = now - (r.createdAt || 0) <= WEEK
                    return (
                      <a
                        key={r.id}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="res-item res-item--link"
                      >
                        <span className="res-ic" aria-hidden="true"><Icon size={18} /></span>
                        <div className="res-main">
                          <div className="res-title">{r.title}</div>
                          <div className="res-meta">
                            <span className="badge badge-blue">{label}</span>
                            {isNew && <span className="res-new">New</span>}
                            {r.description && <span className="res-desc">{r.description}</span>}
                          </div>
                        </div>
                        <span className="res-open" aria-hidden="true"><ExternalLink size={16} /></span>
                      </a>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
