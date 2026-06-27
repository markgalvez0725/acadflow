import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X, Search } from 'lucide-react'

/**
 * Shared responsive settings shell for BOTH the admin and student portals.
 *
 * One presentation, two layouts, driven by viewport:
 *  - Mobile (≤639px): a full-height bottom sheet. The home list shows grouped
 *    rows; tapping a drill row PUSHES its panel in from the right with a back
 *    button (iOS-Settings push navigation).
 *  - Tablet / desktop (≥640px): a centered master-detail card — the grouped list
 *    stays pinned on the left, the selected panel renders on the right.
 *
 * Each side only supplies a `groups` config + an `identity` node; the existing
 * panel components (admin Tabs, embedded student modals) are reused verbatim.
 *
 * Row kinds (inferred):
 *  - `panel`   : has `panel({ onDone })` → drills in (mobile) / selects detail (wide)
 *  - `control` : has `control` node     → rendered inline in the row (e.g. theme)
 *  - `action`  : has `onClick`          → fires immediately (launches its own modal)
 *
 * Props:
 *  - open, onClose, title='Settings'
 *  - identity {ReactNode}  — rendered atop the home list / left pane
 *  - groups [{ title, rows: [{ id, Icon, label, sub, panel?|control?|onClick?, iconBg?, iconColor? }] }]
 *  - footer {ReactNode}    — optional block under the groups (e.g. Log out)
 *  - searchable {boolean}  — show a filter box on the home list
 */

function useIsMobile() {
  const q = '(max-width: 639px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = e => setM(e.matches)
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on) }
  }, [])
  return m
}

function rowKind(r) {
  if (r.panel) return 'panel'
  if (r.control) return 'control'
  return 'action'
}

export default function SettingsShell({ open, onClose, title = 'Settings', identity, groups = [], footer = null, searchable = false, initialView = 'home' }) {
  const isMobile = useIsMobile()
  const allRows = useMemo(() => groups.flatMap(g => g.rows), [groups])
  const firstPanel = useMemo(() => allRows.find(r => r.panel), [allRows])
  const [view, setView] = useState('home')   // mobile: 'home' | rowId
  const [sel,  setSel]  = useState(null)      // wide: selected panel rowId
  const [q,    setQ]    = useState('')

  // Fresh navigation each time it opens. `initialView` deep-links straight to a
  // panel (e.g. a pending student auto-opened into "Get verified").
  useEffect(() => {
    if (!open) return
    const target = initialView && initialView !== 'home' && allRows.some(r => r.id === initialView && r.panel) ? initialView : null
    setView(isMobile ? (target || 'home') : 'home')
    setSel(target || firstPanel?.id || null)
    setQ('')
  }, [open, firstPanel?.id, initialView]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Escape: pop a mobile panel back to the list, otherwise close.
  useEffect(() => {
    if (!open) return
    const onKey = e => {
      if (e.key !== 'Escape') return
      if (isMobile && view !== 'home') setView('home')
      else onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, isMobile, view, onClose])

  if (!open) return null

  const findRow = id => allRows.find(r => r.id === id)
  // "Done with this panel" → mobile pops to the list, wide closes the shell.
  const onDone = isMobile ? () => setView('home') : () => onClose?.()

  function activate(r) {
    const k = rowKind(r)
    if (k === 'panel') { isMobile ? setView(r.id) : setSel(r.id) }
    else if (k === 'action') { r.onClick?.() }
  }

  const styleTag = (
    <style>{`
      .sset-row { display:flex; align-items:center; gap:12px; width:100%; padding:12px 14px; background:none; border:none; cursor:pointer; transition:background .12s; text-align:left }
      .sset-row:hover { background:var(--bg2) }
      .sset-ico { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:var(--accent-l); color:var(--accent); flex-shrink:0 }
      .sset-rtext { min-width:0; flex:1; text-align:left }
      .sset-rlabel { display:block; font-size:14px; font-weight:600; color:var(--ink) }
      .sset-rsub { display:block; font-size:12px; color:var(--ink3); margin-top:1px }
      .sset-card { background:var(--surface2); border:1px solid var(--border); border-radius:12px; overflow:hidden }
      .sset-grp-lbl { font-size:12px; color:var(--ink3); margin:0 0 6px 4px }
      .sset-back { display:inline-flex; align-items:center; gap:4px; background:none; border:none; cursor:pointer; color:var(--ink2); font-size:13px; font-weight:600; padding:0; margin-bottom:8px }
      .sset-back:hover { color:var(--ink) }
      .sset-h { font-size:18px; font-weight:700; color:var(--ink); font-family:'Cormorant Garamond',Georgia,serif }
      .sset-search { display:flex; align-items:center; gap:8px; background:var(--surface2); border:1px solid var(--border); border-radius:999px; padding:8px 14px; margin-bottom:18px }
      .sset-search input { border:none; background:none; outline:none; flex:1; font-size:13px; color:var(--ink) }
      .sset-x { position:absolute; top:14px; right:14px; z-index:2; background:none; border:none; cursor:pointer; color:var(--ink3); display:flex; padding:4px; border-radius:8px }
      .sset-x:hover { background:var(--bg2); color:var(--ink) }
      @keyframes ssetPush  { from { transform:translateX(26px); opacity:.35 } to { transform:translateX(0); opacity:1 } }
      @keyframes ssetSheet { from { transform:translateY(100%) }            to { transform:translateY(0) } }
      @keyframes ssetFade  { from { opacity:0 }                              to { opacity:1 } }
    `}</style>
  )

  function Row({ r, first }) {
    const k = rowKind(r)
    const accent = r.tone === 'accent'
    const icoStyle = r.iconBg
      ? { background: r.iconBg, color: r.iconColor }
      : accent ? { background: 'var(--accent)', color: '#fff' } : undefined
    const border = first ? 'none' : '1px solid var(--border)'
    if (k === 'control') {
      return (
        <div className="sset-row" style={{ cursor: 'default', borderTop: border }}>
          <span className="sset-ico" style={icoStyle}><r.Icon size={17} /></span>
          <span className="sset-rtext">
            <span className="sset-rlabel">{r.label}</span>
            {r.sub && <span className="sset-rsub">{r.sub}</span>}
          </span>
          <span style={{ flexShrink: 0 }}>{r.control}</span>
        </div>
      )
    }
    const active = !isMobile && k === 'panel' && sel === r.id
    const tinted = accent || active
    return (
      <button
        type="button"
        className="sset-row"
        onClick={() => activate(r)}
        style={{ borderTop: border, background: tinted ? 'var(--accent-l)' : undefined }}
      >
        <span className="sset-ico" style={icoStyle}><r.Icon size={17} /></span>
        <span className="sset-rtext">
          <span className="sset-rlabel" style={tinted ? { color: 'var(--accent)' } : undefined}>{r.label}</span>
          {r.sub && <span className="sset-rsub" style={accent ? { color: 'var(--accent)' } : undefined}>{r.sub}</span>}
        </span>
        <ChevronRight size={18} style={{ color: accent ? 'var(--accent)' : 'var(--ink3)', flexShrink: 0 }} />
      </button>
    )
  }

  function HomeList() {
    const ql = q.trim().toLowerCase()
    const filtered = searchable && ql
      ? [{ title: '', rows: allRows.filter(r => rowKind(r) !== 'control' && `${r.label} ${r.sub || ''}`.toLowerCase().includes(ql)) }]
      : groups
    return (
      <>
        {identity && <div style={{ marginBottom: 16 }}>{identity}</div>}
        {searchable && (
          <div className="sset-search">
            <Search size={15} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search settings" />
          </div>
        )}
        {filtered.length === 1 && filtered[0].rows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink3)', textAlign: 'center', padding: '20px 0' }}>No settings match “{q}”.</div>
        ) : (
          filtered.map((g, gi) => (
            <div key={g.title || gi} style={{ marginBottom: 16 }}>
              {g.title ? <div className="sset-grp-lbl">{g.title}</div> : null}
              <div className="sset-card">
                {g.rows.map((r, i) => <Row key={r.id} r={r} first={i === 0} />)}
              </div>
            </div>
          ))
        )}
        {!ql && footer}
      </>
    )
  }

  // ── Mobile: full-height bottom sheet with push navigation ──────────────────
  if (isMobile) {
    const panelRow = view !== 'home' ? findRow(view) : null
    return createPortal(
      <>
        <div
          onClick={() => onClose?.()}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 800, animation: 'ssetFade .18s ease' }}
        />
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 801,
            background: 'var(--surface)', borderRadius: '18px 18px 0 0',
            maxHeight: '92vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 -4px 24px rgba(0,0,0,.18)',
            animation: 'ssetSheet .24s cubic-bezier(.22,.8,.38,1) both',
          }}
        >
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '10px auto 6px', flexShrink: 0 }} />
          <div style={{ overflowY: 'auto', padding: '6px 16px calc(env(safe-area-inset-bottom) + 18px)' }}>
            {panelRow ? (
              <div key={view} style={{ animation: 'ssetPush .22s ease both' }}>
                <button type="button" className="sset-back" onClick={() => setView('home')}>
                  <ChevronLeft size={16} /> {title}
                </button>
                <div className="sset-h" style={{ marginBottom: 16 }}>{panelRow.label}</div>
                {panelRow.panel({ onDone, isMobile: true })}
              </div>
            ) : (
              <>
                <div className="sset-h" style={{ margin: '2px 0 16px' }}>{title}</div>
                <HomeList />
              </>
            )}
          </div>
        </div>
        {styleTag}
      </>,
      document.body
    )
  }

  // ── Tablet / desktop: centered master-detail card ──────────────────────────
  const selRow = (sel && findRow(sel)) || firstPanel
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(10,20,50,.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'ssetFade .15s ease' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'relative', width: 'min(900px, 96vw)', height: 'min(640px, 88vh)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
          display: 'flex', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.35)',
        }}
      >
        <button type="button" className="sset-x" aria-label="Close" onClick={() => onClose?.()}><X size={18} /></button>

        {/* Left: list */}
        <div style={{ width: 288, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '20px 14px', background: 'var(--bg)' }}>
          <div className="sset-h" style={{ margin: '0 4px 16px' }}>{title}</div>
          <HomeList />
        </div>

        {/* Right: detail */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 28 }}>
          {selRow ? (
            <div key={selRow.id} style={{ animation: 'ssetPush .2s ease both' }}>
              <div className="sset-h" style={{ marginBottom: 18 }}>{selRow.label}</div>
              {selRow.panel({ onDone, isMobile: false })}
            </div>
          ) : null}
        </div>
      </div>
      {styleTag}
    </div>,
    document.body
  )
}
