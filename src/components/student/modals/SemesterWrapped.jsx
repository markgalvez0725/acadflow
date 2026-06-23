import React, { useState, useMemo, useEffect } from 'react'
import ReactDOM from 'react-dom'
import {
  Sparkles, TrendingUp, CalendarCheck, ClipboardList,
  FileQuestion, Award, Trophy, X, ChevronLeft,
} from 'lucide-react'

// "AcadFlow Wrapped" — an Instagram-story-style recap of the student's
// semester, built entirely from the derived stat pack in
// @/utils/semesterWrapped. Tap the card to advance; Back/Esc to go back/close.

const GRADS = [
  'linear-gradient(150deg,#6366f1,#8b5cf6)',
  'linear-gradient(150deg,#3b6fe0,#1f3a6e)',
  'linear-gradient(150deg,#0ea5a4,#0f766e)',
  'linear-gradient(150deg,#f59e0b,#b45309)',
  'linear-gradient(150deg,#ec4899,#9d174d)',
  'linear-gradient(150deg,#22c55e,#15803d)',
  'linear-gradient(150deg,#8b5cf6,#5b21b6)',
]

const PERSONA_ICONS = {
  comeback: TrendingUp, present: CalendarCheck, ace: Trophy,
  punctual: ClipboardList, steady: Award, quiz: FileQuestion, journey: Sparkles,
}

function standingFor(gwa) {
  if (gwa >= 90) return 'Outstanding standing'
  if (gwa >= 85) return 'Good standing'
  if (gwa >= 75) return 'Passing — keep pushing'
  return 'A tough one — next term is yours'
}

export default function SemesterWrapped({ data, onClose }) {
  // Build only the slides that have real data behind them.
  const slides = useMemo(() => {
    const w = data
    const out = []
    out.push({
      icon: Sparkles,
      eyebrow: w.semesterLabel,
      title: 'Your semester, wrapped',
      label: `${w.subjectCount} subject${w.subjectCount === 1 ? '' : 's'} · let's look back`,
    })
    if (w.gwa != null) out.push({ big: w.gwa.toFixed(1), label: 'Your GWA', blurb: standingFor(w.gwa) })
    if (w.bestSubject) out.push({
      icon: Trophy, eyebrow: 'Your strongest subject',
      title: w.bestSubject.sub, label: `${Math.round(w.bestSubject.grade)} final grade`,
    })
    if (w.mostImproved) out.push({
      icon: TrendingUp, eyebrow: 'Biggest glow-up',
      title: w.mostImproved.sub, label: `+${w.mostImproved.delta} points from midterms to finals`,
    })
    if (w.attRate != null) out.push({
      big: `${Math.round(w.attRate)}%`, label: 'Attendance',
      blurb: `${w.presentDays} day${w.presentDays === 1 ? '' : 's'} present${w.perfectSubjects ? ` · ${w.perfectSubjects} perfect-attendance subject${w.perfectSubjects === 1 ? '' : 's'}` : ''}`,
    })
    if (w.actSubmitted > 0) out.push({
      icon: ClipboardList, big: String(w.actSubmitted), label: `Task${w.actSubmitted === 1 ? '' : 's'} submitted`,
      blurb: w.onTimeRate != null ? `${w.onTimeRate}% turned in on time` : null,
    })
    if (w.qzTaken > 0) out.push({
      icon: FileQuestion, big: String(w.qzTaken), label: `Quiz${w.qzTaken === 1 ? '' : 'zes'} taken`,
      blurb: w.qzAvg != null ? `${w.qzAvg}% average score` : null,
    })
    const PIcon = PERSONA_ICONS[w.persona.key] || Sparkles
    out.push({ icon: PIcon, eyebrow: 'Your semester vibe', title: w.persona.title, blurb: w.persona.blurb })
    out.push({ recap: true, title: "That's a wrap!" })
    return out
  }, [data])

  const [idx, setIdx] = useState(0)
  const last = slides.length - 1
  const next = () => setIdx(i => Math.min(last, i + 1))
  const prev = () => setIdx(i => Math.max(0, i - 1))

  // Esc to close; lock body scroll while open.
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose?.()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow }
  }, [onClose, last])

  const slide = slides[idx]
  const bg = GRADS[idx % GRADS.length]
  const Icon = slide.icon
  const w = data

  return ReactDOM.createPortal(
    <div className="wrapped-overlay" role="dialog" aria-modal="true" aria-label="Your semester in review">
      <div
        className="wrapped-card"
        style={{ background: bg }}
        onClick={() => { if (idx < last) next() }}
      >
        <div className="wrapped-grid" aria-hidden="true" />

        <div className="wrapped-progress">
          {slides.map((_, i) => (
            <span key={i} className={i <= idx ? 'done' : ''}><i /></span>
          ))}
        </div>

        <div className="wrapped-top">
          <button
            type="button" className="wrapped-close"
            onClick={e => { e.stopPropagation(); onClose?.() }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="wrapped-body" key={idx}>
          {slide.recap ? (
            <>
              <div className="wrapped-ic"><Sparkles size={30} /></div>
              <div className="wrapped-title">{slide.title}</div>
              <div className="wrapped-recap">
                {w.gwa != null && <div className="wrapped-recap-item"><div className="wrapped-recap-v">{w.gwa.toFixed(1)}</div><div className="wrapped-recap-l">GWA</div></div>}
                {w.attRate != null && <div className="wrapped-recap-item"><div className="wrapped-recap-v">{Math.round(w.attRate)}%</div><div className="wrapped-recap-l">Attendance</div></div>}
                {w.actSubmitted > 0 && <div className="wrapped-recap-item"><div className="wrapped-recap-v">{w.actSubmitted}</div><div className="wrapped-recap-l">Tasks submitted</div></div>}
                {w.qzTaken > 0 && <div className="wrapped-recap-item"><div className="wrapped-recap-v">{w.qzTaken}</div><div className="wrapped-recap-l">Quizzes taken</div></div>}
                {w.bestSubject && <div className="wrapped-recap-item"><div className="wrapped-recap-v" style={{ fontSize: 16 }}>{w.bestSubject.sub}</div><div className="wrapped-recap-l">Top subject</div></div>}
                <div className="wrapped-recap-item"><div className="wrapped-recap-v" style={{ fontSize: 16 }}>{w.persona.title}</div><div className="wrapped-recap-l">Your vibe</div></div>
              </div>
              <button type="button" className="wrapped-done" onClick={e => { e.stopPropagation(); onClose?.() }}>Done</button>
            </>
          ) : (
            <>
              {Icon && <div className="wrapped-ic"><Icon size={30} /></div>}
              {slide.eyebrow && <div className="wrapped-eyebrow">{slide.eyebrow}</div>}
              {slide.big && <div className="wrapped-big">{slide.big}</div>}
              {slide.title && <div className="wrapped-title">{slide.title}</div>}
              {slide.label && <div className="wrapped-label">{slide.label}</div>}
              {slide.blurb && <div className="wrapped-blurb">{slide.blurb}</div>}
            </>
          )}
        </div>

        {idx > 0 && (
          <div className="wrapped-foot">
            <button
              type="button" className="wrapped-back"
              onClick={e => { e.stopPropagation(); prev() }}
              aria-label="Previous"
            >
              <ChevronLeft size={16} /> Back
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
