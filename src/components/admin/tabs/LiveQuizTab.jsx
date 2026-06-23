import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import PageHeader from '@/components/ds/PageHeader'
import { Radio, Play, Users, Trophy, ChevronRight, X, Check } from 'lucide-react'
import {
  playableQuestions, optionsFor, leaderboard, answeredCount, optionTallies, isCorrect,
} from '@/utils/liveQuiz'

const OPTION_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#8b5cf6', '#0ea5a4']

// Renders the join PIN as a QR via the qrcodejs CDN global. Students scan it to
// join hands-free; the printed PIN below remains the fallback.
function LiveQR({ pin }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !window.QRCode || !pin) return
    ref.current.innerHTML = ''
    try {
      new window.QRCode(ref.current, { text: String(pin), width: 132, height: 132, colorDark: '#0b1220', colorLight: '#ffffff' })
    } catch (e) { /* QR optional — PIN is the fallback */ }
  }, [pin])
  return <div ref={ref} className="lq-qr" aria-label="Join QR code" />
}

function useNow(active) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [active])
  return now
}

export default function LiveQuizTab() {
  const { quizzes, liveSessions, createLiveSession, setLiveState, deleteLiveSession } = useData()
  const { toast } = useUI()
  const [perQ, setPerQ] = useState(20)
  const [starting, setStarting] = useState(false)

  // A teacher hosts one game at a time — the most recent session is "the" game.
  const session = useMemo(
    () => [...liveSessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null,
    [liveSessions]
  )

  const hostable = useMemo(
    () => quizzes
      .map(q => ({ quiz: q, playable: playableQuestions(q.questions) }))
      .filter(x => x.playable.length > 0),
    [quizzes]
  )

  async function start(quiz, questions) {
    setStarting(true)
    try {
      await createLiveSession({ quiz, questions, perQuestionSeconds: perQ })
      toast('Live game created — share the PIN!', 'success')
    } catch (e) {
      toast('Could not start: ' + (e?.message || 'unknown error'), 'error')
    } finally {
      setStarting(false)
    }
  }

  if (session) return <HostView session={session} setLiveState={setLiveState} deleteLiveSession={deleteLiveSession} toast={toast} />

  return (
    <div>
      <PageHeader
        crumb={<><Radio size={13} /> Live Quiz</>}
        title="Live Quiz"
        subtitle="Host a Kahoot-style game — students join with a PIN and compete in real time"
      />

      <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 600 }}>Seconds per question</span>
        <select className="lq-secs" value={perQ} onChange={e => setPerQ(Number(e.target.value))}>
          {[10, 15, 20, 30, 45, 60].map(s => <option key={s} value={s}>{s}s</option>)}
        </select>
      </div>

      {!hostable.length ? (
        <div className="empty">
          <div className="empty-icon"><Radio size={40} /></div>
          No quizzes with tappable questions yet. Live mode supports multiple-choice and true/false questions — create one in the Quizzes tab.
        </div>
      ) : (
        <div className="res-list">
          {hostable.map(({ quiz, playable }) => (
            <div key={quiz.id} className="res-item">
              <span className="res-ic" aria-hidden="true"><Radio size={18} /></span>
              <div className="res-main">
                <div className="res-title">{quiz.title}</div>
                <div className="res-meta">
                  {quiz.subject && <span className="badge badge-blue">{quiz.subject}</span>}
                  <span className="res-desc">{playable.length} playable question{playable.length === 1 ? '' : 's'}</span>
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={starting} onClick={() => start(quiz, playable)}>
                <Play size={15} /> Start live
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HostView({ session, setLiveState, deleteLiveSession, toast }) {
  const id = session.id
  const players = Object.values(session.players || {})
  const board = leaderboard(session)
  const idx = session.currentIndex
  const q = idx >= 0 ? session.questions[idx] : null
  const opts = optionsFor(q)
  const tallies = optionTallies(session, q)
  const answered = answeredCount(session)
  const isLast = idx >= session.questionCount - 1

  const now = useNow(session.status === 'question')
  const elapsed = session.questionStartedAt ? Math.floor((now - session.questionStartedAt) / 1000) : 0
  const remaining = Math.max(0, session.perQuestionSeconds - elapsed)

  // Auto-reveal once the timer runs out so the host isn't forced to click.
  useEffect(() => {
    if (session.status === 'question' && session.questionStartedAt && remaining === 0) {
      setLiveState(id, { status: 'reveal' }).catch(() => {})
    }
  }, [session.status, remaining, id])

  const startGame = () => setLiveState(id, { status: 'question', currentIndex: 0, questionStartedAt: Date.now() })
  const reveal    = () => setLiveState(id, { status: 'reveal' })
  const next      = () => setLiveState(id, { status: 'question', currentIndex: idx + 1, questionStartedAt: Date.now() })
  const finish    = () => setLiveState(id, { status: 'ended' })
  const close     = () => deleteLiveSession(id).then(() => toast('Game closed.', 'info'))

  return (
    <div className="lq-host">
      {/* ── Lobby ── */}
      {session.status === 'lobby' && (
        <div className="lq-stage">
          <div className="lq-eyebrow">{session.quizTitle}{session.subject ? ` · ${session.subject}` : ''}</div>
          <div className="lq-pin-wrap">
            <div className="lq-pin-label">Scan to join — or enter the PIN</div>
            <LiveQR pin={session.pin} />
            <div className="lq-pin">{session.pin}</div>
          </div>
          <div className="lq-players-count"><Users size={16} /> {players.length} joined</div>
          <div className="lq-players">
            {players.map((p, i) => <span key={i} className="lq-chip">{p.name}</span>)}
            {!players.length && <span className="res-desc">Waiting for players to join…</span>}
          </div>
          <div className="lq-controls">
            <button className="btn" onClick={close}><X size={16} /> Cancel</button>
            <button className="btn btn-primary" disabled={!players.length} onClick={startGame}>
              <Play size={16} /> Start game
            </button>
          </div>
        </div>
      )}

      {/* ── Question ── */}
      {session.status === 'question' && q && (
        <div className="lq-stage">
          <div className="lq-qmeta">
            <span>Question {idx + 1} of {session.questionCount}</span>
            <span className="lq-timer">{remaining}s</span>
            <span><Users size={14} /> {answered}/{players.length} answered</span>
          </div>
          <div className="lq-question">{q.question}</div>
          <div className="lq-options lq-options--host">
            {opts.map((o, i) => (
              <div key={i} className="lq-opt" style={{ background: OPTION_COLORS[i % OPTION_COLORS.length] }}>
                <span className="lq-opt-letter">{String.fromCharCode(65 + i)}</span>{o}
              </div>
            ))}
          </div>
          <div className="lq-controls">
            <button className="btn btn-primary" onClick={reveal}>Reveal answer <ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* ── Reveal ── */}
      {session.status === 'reveal' && q && (
        <div className="lq-stage">
          <div className="lq-qmeta"><span>Question {idx + 1} of {session.questionCount}</span></div>
          <div className="lq-question">{q.question}</div>
          <div className="lq-options lq-options--host">
            {opts.map((o, i) => {
              const correct = isCorrect(q, o)
              const max = Math.max(1, ...tallies)
              return (
                <div key={i} className={`lq-opt lq-opt--reveal${correct ? ' is-correct' : ''}`} style={{ background: correct ? 'var(--green)' : 'var(--surface3)', color: correct ? '#fff' : 'var(--ink2)' }}>
                  <span className="lq-opt-letter">{String.fromCharCode(65 + i)}</span>
                  <span style={{ flex: 1 }}>{o}</span>
                  {correct && <Check size={16} />}
                  <span className="lq-tally"><span className="lq-tally-bar" style={{ width: `${(tallies[i] / max) * 100}%` }} />{tallies[i]}</span>
                </div>
              )
            })}
          </div>
          <Leaderboard board={board} compact />
          <div className="lq-controls">
            {isLast
              ? <button className="btn btn-primary" onClick={finish}><Trophy size={16} /> Finish & show results</button>
              : <button className="btn btn-primary" onClick={next}>Next question <ChevronRight size={16} /></button>}
          </div>
        </div>
      )}

      {/* ── Ended ── */}
      {session.status === 'ended' && (
        <div className="lq-stage">
          <div className="lq-eyebrow"><Trophy size={14} /> Final results · {session.quizTitle}</div>
          <Leaderboard board={board} />
          <div className="lq-controls">
            <button className="btn btn-primary" onClick={close}>Close game</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Leaderboard({ board, compact }) {
  const top = compact ? board.slice(0, 5) : board
  if (!board.length) return <div className="res-desc" style={{ textAlign: 'center' }}>No scores yet.</div>
  return (
    <div className="lq-board">
      {top.map((p, i) => (
        <div key={p.pid} className={`lq-row${i === 0 ? ' is-first' : ''}`}>
          <span className="lq-rank">{i + 1}</span>
          <span className="lq-name">{p.name}</span>
          <span className="lq-correct">{p.correct} correct</span>
          <span className="lq-score">{p.score}</span>
        </div>
      ))}
    </div>
  )
}
