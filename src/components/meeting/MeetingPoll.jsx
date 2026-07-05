import React, { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { X, BarChart2 } from 'lucide-react'
import { rtcListenPoll, rtcSetPoll, rtcVotePoll, rtcClosePoll } from '@/firebase/rtc'

// Quick poll: one live question per room (rtcRooms/{id}/polls/current). The
// professor overwrites the doc to ask; students tap to vote (they can change
// their answer until the poll ends); everyone watches the same live counts.
// Votes are keyed by uid but no name is ever rendered - anonymous to the
// class by design. Polls auto-end after 60s so they never linger over the
// stage; a finished card stays until dismissed, a NEW poll replaces it.
const POLL_SECONDS = 60
const PRESETS = [
  { label: 'Yes / No', opts: ['Yes', 'No'] },
  { label: 'True / False', opts: ['True', 'False'] },
  { label: 'A / B / C / D', opts: ['A', 'B', 'C', 'D'] },
]

export default function MeetingPoll({ db, roomId, self, isAdmin, composerOpen, onCloseComposer, toast }) {
  const [poll, setPoll] = useState(null)
  const [hiddenId, setHiddenId] = useState('')
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState(['Yes', 'No', '', ''])
  const [busy, setBusy] = useState(false)
  // 1s heartbeat only while a live poll is on screen (countdown + auto-end).
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!db || !roomId) return undefined
    return rtcListenPoll(db, roomId, setPoll)
  }, [db, roomId])

  const now = Date.now()
  const ended = !!poll && (poll.closed || (poll.endsAt || 0) <= now)
  const visible = !!poll && poll.id !== hiddenId

  useEffect(() => {
    if (!visible || ended) return undefined
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [visible, ended])

  async function ask(useOpts) {
    const list = useOpts.map(o => o.trim()).filter(Boolean)
    if (list.length < 2 || busy) return
    setBusy(true)
    try {
      await rtcSetPoll(db, roomId, {
        id: uuidv4(),
        q: q.trim() || 'Quick check',
        opts: list,
        endsAt: Date.now() + POLL_SECONDS * 1000,
      })
      setQ('')
      setHiddenId('')
      onCloseComposer()
    } catch {
      toast('Could not start the poll. Check your connection.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const votes = poll?.votes || {}
  const myVote = self?.uid !== undefined ? votes[self.uid] : undefined
  const counts = (poll?.opts || []).map((_, i) => Object.values(votes).filter(v => v === i).length)
  const answered = Object.keys(votes).length
  const secsLeft = poll ? Math.max(0, Math.ceil(((poll.endsAt || 0) - now) / 1000)) : 0

  function vote(i) {
    if (isAdmin || ended || !self?.uid) return
    rtcVotePoll(db, roomId, self.uid, i).catch(() => toast('Vote did not send. Tap again.', 'error'))
  }

  return (
    <>
      {isAdmin && composerOpen && (
        <div className="mr-poll mr-poll-compose" role="dialog" aria-label="Start a poll">
          <div className="mr-poll-head">
            <BarChart2 size={15} aria-hidden="true" />
            <b>Ask the class</b>
            <button className="mr-diag-x" onClick={onCloseComposer} aria-label="Close the poll composer"><X size={15} /></button>
          </div>
          <input
            className="mr-poll-q"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Did that make sense?"
            maxLength={140}
            aria-label="Poll question"
          />
          <div className="mr-poll-presets">
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => setOpts([...p.opts, '', '', '', ''].slice(0, 4))}>{p.label}</button>
            ))}
          </div>
          <div className="mr-poll-optin">
            {opts.map((o, i) => (
              <input
                key={i}
                value={o}
                onChange={e => setOpts(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                placeholder={i < 2 ? `Option ${i + 1}` : `Option ${i + 1} (optional)`}
                maxLength={40}
                aria-label={`Poll option ${i + 1}`}
              />
            ))}
          </div>
          <button className="mr-poll-go" disabled={busy || opts.filter(o => o.trim()).length < 2} onClick={() => ask(opts)}>
            {busy ? 'Starting…' : `Start poll · ends in ${POLL_SECONDS}s`}
          </button>
        </div>
      )}
      {visible && (
        <div className="mr-poll" role="group" aria-label="Class poll">
          <div className="mr-poll-head">
            <BarChart2 size={15} aria-hidden="true" />
            <b>{poll.q}</b>
            {ended
              ? <button className="mr-diag-x" onClick={() => setHiddenId(poll.id)} aria-label="Dismiss the poll"><X size={15} /></button>
              : isAdmin
                ? <button className="mr-poll-end" onClick={() => rtcClosePoll(db, roomId).catch(() => {})}>End</button>
                : <span className="mr-poll-secs">{secsLeft}s</span>}
          </div>
          <div className="mr-poll-opts">
            {(poll.opts || []).map((o, i) => {
              const pct = answered ? Math.round((counts[i] / answered) * 100) : 0
              return (
                <button
                  key={i}
                  className={`mr-poll-opt${myVote === i ? ' mine' : ''}`}
                  disabled={isAdmin || ended}
                  onClick={() => vote(i)}
                >
                  <span className="mr-poll-fill" style={{ width: `${pct}%` }} aria-hidden="true" />
                  <span className="mr-poll-lab">{o}</span>
                  <b>{counts[i]}</b>
                </button>
              )
            })}
          </div>
          <span className="mr-poll-foot">
            {ended
              ? `Final · ${answered} answered`
              : isAdmin
                ? `${answered} answered · live`
                : myVote !== undefined ? 'Answered - you can change it until time runs out.' : 'Tap an answer. Only totals are shown.'}
          </span>
        </div>
      )}
    </>
  )
}
