import React, { useState, useEffect, useRef } from 'react'
import { X, Send } from 'lucide-react'

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

// Meet-style "In-call messages" side panel. Deliberately LIGHT inside the
// dark room (matching Google Meet); messages are ephemeral - they live under
// rtcRooms/{id}/chat and the End-class purge deletes them, which is exactly
// what the privacy note promises. The professor's send-lock toggle rides
// their participant doc; students then see a disabled input.
//   messages   - [{ id, at, uid, name, role, text }]
//   selfUid    - to label own rows "You"
//   isAdmin    - shows the lock toggle
//   locked     - chat currently locked to professor-only
//   photoOf    - ({ uid, role }) -> profile photo URL or null
//   onToggleLock(next) / onSend(text) / onClose()
export default function MeetingChat({ open, messages, selfUid, isAdmin, locked, photoOf, onToggleLock, onSend, onClose }) {
  const [text, setText] = useState('')
  const listRef = useRef(null)

  // Stick to the newest message whenever one arrives while open.
  useEffect(() => {
    const el = listRef.current
    if (open && el) el.scrollTop = el.scrollHeight
  }, [open, messages.length])

  if (!open) return null
  const canSend = isAdmin || !locked

  function submit(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t || !canSend) return
    onSend(t)
    setText('')
  }

  const timeStr = at => new Date(at || 0).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  return (
    <aside className="mr-chat" aria-label="In-call messages">
      <div className="mr-chat-head">
        <span>In-call messages</span>
        <button className="mr-chat-x" onClick={onClose} aria-label="Close chat"><X size={16} /></button>
      </div>
      {isAdmin && (
        <label className="mr-chat-lock">
          <span>Let everyone send messages</span>
          <input
            type="checkbox"
            checked={!locked}
            onChange={e => onToggleLock(!e.target.checked)}
          />
          <span className={`mr-chat-toggle${locked ? '' : ' mr-chat-toggle-on'}`} aria-hidden="true" />
        </label>
      )}
      <div className="mr-chat-note">
        Messages can only be seen by people in the call and are deleted when the call ends.
      </div>
      <div className="mr-chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="mr-chat-empty">No messages yet. Say hi to the class.</div>
        )}
        {messages.map(m => {
          const photo = photoOf ? photoOf({ uid: m.uid, role: m.role }) : null
          return (
            <div key={m.id} className="mr-chat-msg">
              <span className="mr-chat-av" aria-hidden="true">
                {photo ? <img src={photo} alt="" /> : initials(m.name)}
              </span>
              <div className="mr-chat-body">
                <div className="mr-chat-meta">
                  <b>{m.uid === selfUid ? 'You' : m.name}</b>
                  {m.role === 'admin' && <span className="mr-chat-prof">PROF</span>}
                  <span>{timeStr(m.at)}</span>
                </div>
                <div className="mr-chat-text">{m.text}</div>
              </div>
            </div>
          )
        })}
      </div>
      {/* Inline chrome-kill on the input: the app's base input/focus styles
          must never draw a box inside the pill - the PILL is the field. */}
      <form className="mr-chat-input" onSubmit={submit}>
        <input
          type="text"
          value={text}
          maxLength={500}
          disabled={!canSend}
          placeholder={canSend ? 'Send a message to everyone' : 'The professor turned off messages'}
          onChange={e => setText(e.target.value)}
          style={{ border: 'none', outline: 'none', background: 'transparent', borderRadius: 999, appearance: 'none' }}
        />
        <button type="submit" disabled={!canSend || !text.trim()} aria-label="Send message">
          <Send size={16} />
        </button>
      </form>
    </aside>
  )
}
