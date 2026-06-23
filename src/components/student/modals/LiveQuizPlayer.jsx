import React, { useEffect, useState, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useData } from '@/context/DataContext'
import { Check, X, Trophy, Clock, Hourglass } from 'lucide-react'
import { optionsFor, isCorrect, pointsFor, leaderboard } from '@/utils/liveQuiz'

const OPTION_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#8b5cf6', '#0ea5a4']

export default function LiveQuizPlayer({ sessionId, student, onClose }) {
  const { liveSessions, joinLiveSession, submitLiveAnswer } = useData()
  const session = liveSessions.find(s => s.id === sessionId)
  const joinedRef = useRef(false)

  // Join the lobby once.
  useEffect(() => {
    if (session && !joinedRef.current) {
      joinedRef.current = true
      joinLiveSession(sessionId, student.id, student.name || student.id).catch(() => {})
    }
  }, [session, sessionId, student, joinLiveSession])

  // Local clock for the per-question countdown.
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const active = session?.status === 'question'
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [session?.status, session?.questionStartedAt])

  if (!session) {
    return ReactDOM.createPortal(
      <div className="wrapped-overlay">
        <div className="lq-player lq-player--msg">
          <Hourglass size={36} />
          <div className="lq-player-msg">This game has ended.</div>
          <button className="wrapped-done" onClick={onClose}>Done</button>
        </div>
      </div>,
      document.body
    )
  }

  const me = (session.players || {})[student.id]
  const idx = session.currentIndex
  const q = idx >= 0 ? session.questions[idx] : null
  const opts = optionsFor(q)
  const myAnswer = me?.answers?.[idx]
  const elapsed = session.questionStartedAt ? Math.floor((now - session.questionStartedAt) / 1000) : 0
  const remaining = Math.max(0, session.perQuestionSeconds - elapsed)
  const board = leaderboard(session)
  const rank = board.findIndex(p => p.pid === student.id) + 1
  const myScore = board.find(p => p.pid === student.id)?.score || 0

  function choose(o) {
    if (myAnswer || remaining === 0) return
    const ms = Date.now() - (session.questionStartedAt || Date.now())
    const correct = isCorrect(q, o)
    const points = pointsFor(correct, ms, session.perQuestionSeconds)
    submitLiveAnswer(sessionId, student.id, idx, { choice: o, correct, ms, points }).catch(() => {})
  }

  return ReactDOM.createPortal(
    <div className="wrapped-overlay">
      <div className="lq-player">
        <button type="button" className="wrapped-close" style={{ position: 'absolute', top: 12, right: 12 }} onClick={onClose} aria-label="Leave">
          <X size={16} />
        </button>

        {/* Lobby */}
        {session.status === 'lobby' && (
          <div className="lq-player-body">
            <div className="lq-player-ic"><Check size={30} /></div>
            <div className="lq-player-title">You're in!</div>
            <div className="lq-player-sub">{session.quizTitle}{session.subject ? ` · ${session.subject}` : ''}</div>
            <div className="lq-player-msg">Waiting for your teacher to start…</div>
          </div>
        )}

        {/* Question */}
        {session.status === 'question' && q && (
          <div className="lq-player-body">
            <div className="lq-qmeta">
              <span>Q{idx + 1}/{session.questionCount}</span>
              <span className="lq-timer"><Clock size={14} /> {remaining}s</span>
            </div>
            <div className="lq-question">{q.question}</div>
            {myAnswer ? (
              <div className="lq-locked">
                <Check size={22} /> Answer locked in — hang tight!
              </div>
            ) : remaining === 0 ? (
              <div className="lq-locked lq-locked--out"><Clock size={22} /> Time's up!</div>
            ) : (
              <div className="lq-options">
                {opts.map((o, i) => (
                  <button
                    key={i}
                    type="button"
                    className="lq-opt lq-opt--tap"
                    style={{ background: OPTION_COLORS[i % OPTION_COLORS.length] }}
                    onClick={() => choose(o)}
                  >
                    <span className="lq-opt-letter">{String.fromCharCode(65 + i)}</span>{o}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reveal */}
        {session.status === 'reveal' && q && (
          <div className="lq-player-body">
            {myAnswer ? (
              <>
                <div className={`lq-player-ic ${myAnswer.correct ? 'is-correct' : 'is-wrong'}`}>
                  {myAnswer.correct ? <Check size={34} /> : <X size={34} />}
                </div>
                <div className="lq-player-title">{myAnswer.correct ? 'Correct!' : 'Not this time'}</div>
                <div className="lq-player-sub">
                  {myAnswer.correct ? `+${myAnswer.points} points` : `Answer: ${q.answer}`}
                </div>
              </>
            ) : (
              <>
                <div className="lq-player-ic is-wrong"><X size={34} /></div>
                <div className="lq-player-title">No answer</div>
                <div className="lq-player-sub">Correct answer: {q.answer}</div>
              </>
            )}
            {rank > 0 && <div className="lq-player-rank">Rank #{rank} · {myScore} pts</div>}
          </div>
        )}

        {/* Ended */}
        {session.status === 'ended' && (
          <div className="lq-player-body">
            <div className="lq-player-ic"><Trophy size={34} /></div>
            <div className="lq-player-title">{rank === 1 ? '🏆 You won!' : `You finished #${rank || '—'}`}</div>
            <div className="lq-player-sub">{myScore} points · {board.find(p => p.pid === student.id)?.correct || 0} correct</div>
            <button className="wrapped-done" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
