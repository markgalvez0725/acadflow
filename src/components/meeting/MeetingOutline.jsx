import React, { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { X, List, Plus, Trash2, ExternalLink, CheckCircle, Circle } from 'lucide-react'

// In-room class outline: the professor keeps a short agenda plus resource
// links on the meeting doc (`outline` field - additive, admin-write-only
// under the existing onlineMeetings rules); the class reads it live through
// the normal meetings listener. The "now" marker is derived, never stored:
// the first unchecked item is the current one, so checking an item off is
// also how the professor advances the class.
const MAX_ITEMS = 20
const MAX_LINKS = 10

function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'link' }
}

export default function MeetingOutline({ open, meeting, isAdmin, onPatch, onClose }) {
  const [draft, setDraft] = useState('')
  const [minDraft, setMinDraft] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [addLinkOpen, setAddLinkOpen] = useState(false)
  // 30s heartbeat so the "N min left" pill on the current item stays honest
  // without re-rendering the room (only ticks while the panel is open).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!open) return undefined
    const t = setInterval(() => setTick(x => x + 1), 30000)
    return () => clearInterval(t)
  }, [open])
  if (!open) return null

  const outline = meeting?.outline || {}
  const items = Array.isArray(outline.items) ? outline.items : []
  const links = Array.isArray(outline.links) ? outline.links : []
  const nowId = (items.find(i => !i.done) || {}).id

  // Stamp nowAt whenever the CURRENT item changes (an item was checked off,
  // added first, or removed) - it anchors the per-item countdown.
  const save = next => {
    const nextItems = next.items || items
    const newNow = (nextItems.find(i => !i.done) || {}).id
    const stamp = newNow !== nowId ? { nowAt: Date.now() } : {}
    onPatch({ outline: { items, links, nowAt: outline.nowAt || 0, ...stamp, ...next } })
  }

  function addItem(e) {
    e.preventDefault()
    const text = draft.trim().slice(0, 120)
    if (!text || items.length >= MAX_ITEMS) return
    const min = Math.min(120, Math.max(0, parseInt(minDraft, 10) || 0))
    save({ items: [...items, { id: uuidv4(), text, done: false, ...(min ? { min } : {}) }] })
    setDraft('')
    setMinDraft('')
  }

  function minPill(it) {
    if (!it.min) return null
    if (it.id !== nowId || !outline.nowAt) return <span className="mr-otl-min">{it.min} min</span>
    const left = Math.round((it.min * 60000 - (Date.now() - outline.nowAt)) / 60000)
    if (left >= 0) return <span className="mr-otl-min live">{left} min left</span>
    return <span className="mr-otl-min over">{-left} min over</span>
  }

  function addLink(e) {
    e.preventDefault()
    const url = linkUrl.trim()
    if (!/^https?:\/\//i.test(url) || links.length >= MAX_LINKS) return
    const label = (linkLabel.trim() || hostLabel(url)).slice(0, 60)
    save({ links: [...links, { id: uuidv4(), label, url }] })
    setLinkLabel('')
    setLinkUrl('')
    setAddLinkOpen(false)
  }

  return (
    <div className="mr-people mr-otl" role="complementary" aria-label="Class outline">
      <div className="mr-people-head">
        <List size={16} aria-hidden="true" /> Class outline
        <button className="mr-people-x" onClick={onClose} aria-label="Close the class outline"><X size={16} /></button>
      </div>
      <div className="mr-otl-body">
        {items.length === 0 && (
          <p className="mr-otl-empty">
            {isAdmin
              ? 'Post a short agenda so the class (and anyone joining late) can see where you are.'
              : 'No outline posted for this class yet.'}
          </p>
        )}
        {items.map(it => (
          <div key={it.id} className={`mr-otl-item${it.done ? ' done' : ''}${it.id === nowId ? ' now' : ''}`}>
            <button
              className="mr-otl-tick"
              disabled={!isAdmin}
              onClick={() => save({ items: items.map(x => x.id === it.id ? { ...x, done: !x.done } : x) })}
              aria-label={it.done ? 'Mark as not done' : 'Mark as done'}
            >
              {it.done ? <CheckCircle size={16} /> : <Circle size={16} />}
            </button>
            <span className="mr-otl-text">{it.text}</span>
            {minPill(it)}
            {it.id === nowId && <em className="mr-otl-now">now</em>}
            {isAdmin && (
              <button
                className="mr-otl-del"
                onClick={() => save({ items: items.filter(x => x.id !== it.id) })}
                aria-label="Remove this item"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {links.length > 0 && <p className="mr-otl-sub">Resources</p>}
        <div className="mr-otl-links">
          {links.map(l => (
            <span key={l.id} className="mr-otl-chip">
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} aria-hidden="true" /> {l.label}
              </a>
              {isAdmin && (
                <button
                  onClick={() => save({ links: links.filter(x => x.id !== l.id) })}
                  aria-label={`Remove ${l.label}`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
      {isAdmin && (
        <div className="mr-otl-foot">
          <form className="mr-otl-add" onSubmit={addItem}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Add an agenda item…"
              maxLength={120}
              aria-label="New agenda item"
            />
            <input
              value={minDraft}
              onChange={e => setMinDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
              placeholder="min"
              inputMode="numeric"
              aria-label="Minutes for this item (optional)"
              style={{ flex: '0 0 52px', textAlign: 'center' }}
            />
            <button type="submit" disabled={!draft.trim()} aria-label="Add item"><Plus size={15} /></button>
          </form>
          {addLinkOpen ? (
            <form className="mr-otl-add" onSubmit={addLink}>
              <input
                value={linkLabel}
                onChange={e => setLinkLabel(e.target.value)}
                placeholder="Label (optional)"
                maxLength={60}
                aria-label="Link label"
                style={{ flex: '0 0 36%' }}
              />
              <input
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://…"
                aria-label="Link URL"
              />
              <button type="submit" disabled={!/^https?:\/\//i.test(linkUrl.trim())} aria-label="Add link"><Plus size={15} /></button>
            </form>
          ) : (
            <button className="mr-otl-linkbtn" onClick={() => setAddLinkOpen(true)}>
              <ExternalLink size={13} aria-hidden="true" /> Add a resource link
            </button>
          )}
        </div>
      )}
    </div>
  )
}
