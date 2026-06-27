import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '@/context/UIContext'
import { LayoutDashboard, BookOpen, FileQuestion, Library, X, GraduationCap } from 'lucide-react'

// First-run walkthrough for students. Shows once per device (localStorage),
// explains where the core areas live, and can jump the student to a tab.
// Respects prefers-reduced-motion (animations are disabled globally for it).

function seenKey(studentId) { return `onboarding_seen:${studentId}` }

const STEPS = [
  {
    Icon: GraduationCap, color: 'var(--accent)',
    title: 'Welcome to AcadFlow',
    body: 'A quick 30-second tour of where everything lives. You can skip anytime.',
  },
  {
    Icon: LayoutDashboard, color: 'var(--accent)', tab: 'overview',
    title: 'Home - your day at a glance',
    body: 'The top strip shows classes today, what’s due soon, open quizzes, and announcements. Tap any chip to jump straight there.',
  },
  {
    Icon: BookOpen, color: 'var(--green)', tab: 'grades',
    title: 'Grades & subjects',
    body: 'Track your GWA and per-subject standing. Each subject keeps its own color across the app so it’s easy to scan.',
  },
  {
    Icon: FileQuestion, color: 'var(--purple)', tab: 'quizzes',
    title: 'Quizzes & assignments',
    body: 'Take quizzes (your answers autosave if you close mid-way), review them with explanations, and track every task in Assignments.',
  },
  {
    Icon: Library, color: 'var(--accent)', tab: 'resources',
    title: 'Resources & messages',
    body: 'Find modules, slides, and links in the Resource Hub - and message your professor anytime from the chat bubble.',
  },
]

export default function OnboardingTour({ student, onClose }) {
  const { setStudentTab } = useUI()
  const [i, setI] = useState(0)
  const step = STEPS[i]
  const last = i === STEPS.length - 1

  function finish() {
    try { localStorage.setItem(seenKey(student.id), String(Date.now())) } catch (e) { /* ignore */ }
    onClose()
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' && !last) setI(n => n + 1)
      else if (e.key === 'ArrowLeft' && i > 0) setI(n => n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, last])

  return createPortal(
    <div className="onb-overlay" role="dialog" aria-modal="true" aria-label="Getting started">
      <div className="onb-card">
        <button className="onb-skip" onClick={finish} aria-label="Skip tour"><X size={16} /></button>
        <div className="onb-ic" style={{ color: step.color, background: `color-mix(in srgb, ${step.color} 12%, transparent)` }}>
          <step.Icon size={28} />
        </div>
        <h3 className="onb-title">{step.title}</h3>
        <p className="onb-body">{step.body}</p>

        <div className="onb-dots" aria-hidden="true">
          {STEPS.map((_, n) => <span key={n} className={`onb-dot${n === i ? ' active' : ''}`} />)}
        </div>

        <div className="onb-actions">
          {step.tab && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setStudentTab(step.tab); finish() }}
            >
              Take me there
            </button>
          )}
          <div style={{ flex: 1 }} />
          {i > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setI(n => n - 1)}>Back</button>}
          {last
            ? <button className="btn btn-primary btn-sm" onClick={finish}>Got it</button>
            : <button className="btn btn-primary btn-sm" onClick={() => setI(n => n + 1)}>Next</button>}
        </div>
      </div>
    </div>,
    document.body
  )
}
