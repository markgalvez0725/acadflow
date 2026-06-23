import React, { useState } from 'react'
import { ChevronDown, HelpCircle } from 'lucide-react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'

/**
 * "About AcadFlow" FAQ — explains why the portal exists and how it works.
 * Opened from either login screen. Content lives in FAQ_ITEMS below so it's
 * easy to edit; the first item leads with the origin story.
 *
 * Props:
 *  - onClose {function}
 */
const FAQ_ITEMS = [
  {
    q: 'Why was AcadFlow created?',
    a: `AcadFlow began as a way to fix a daily frustration: a class's grades lived in one spreadsheet, attendance in another, announcements in a group chat, and quizzes somewhere else entirely. Nobody — teacher or student — had a single, calm place to see how the semester was actually going. I built AcadFlow to pull all of that into one real-time portal, so everyone can focus on learning instead of chasing scattered files.`,
  },
  {
    q: 'What problem does it solve?',
    a: `It replaces the patchwork of spreadsheets, paper logs, and group chats with one source of truth. Grades, attendance, activities, quizzes, announcements, online classes, and messages all update live — students always see their real standing, and teachers spend less time on busywork.`,
  },
  {
    q: 'Who is AcadFlow for?',
    a: `Two roles share the same portal. Teachers and staff (the admin side) manage classes, grades, attendance, and announcements; students see their own grades, attendance, deadlines, and messages. Everyone works from the same live data — just the slice that's relevant to them.`,
  },
  {
    q: 'Is my data private and secure?',
    a: `Yes. Passwords are never stored in plain text — they're hashed before saving, and sensitive configuration is encrypted. Students can only ever see their own records, and password recovery is coordinated with your teacher so no password is exposed along the way.`,
  },
  {
    q: 'Do I need to install anything?',
    a: `No. AcadFlow runs in any modern browser. It's also a Progressive Web App, so you can optionally "Add to Home Screen" on your phone for an app-like experience and push notifications for deadlines and announcements.`,
  },
  {
    q: 'How do I get an account?',
    a: `Students register themselves, but only against the class roster their teacher has already set up. You verify your identity with your student number, name, course, year, and section — so accounts stay tied to real, enrolled students. If your details don't match, ask your teacher to add or correct your record first.`,
  },
  {
    q: 'How much does it cost?',
    a: `AcadFlow is a focused, self-contained project — there are no ads, and nothing to buy to sign in and use the portal.`,
  },
]

export default function FaqModal({ onClose }) {
  const [open, setOpen] = useState(0)

  return (
    <Modal onClose={onClose} size="lg" zIndex={300}>
      <ModalHeader
        title="About AcadFlow"
        subtitle="Why this portal exists & how it works"
        onClose={onClose}
      />

      <div className="faq-intro">
        <div className="faq-intro-ic"><HelpCircle size={20} /></div>
        <p>A quick look at the idea behind AcadFlow. Tap any question to expand it.</p>
      </div>

      <div className="faq-list">
        {FAQ_ITEMS.map((item, i) => {
          const isOpen = open === i
          return (
            <div key={i} className={`faq-item${isOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="faq-q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? -1 : i)}
              >
                <span>{item.q}</span>
                <ChevronDown size={18} className="faq-chevron" aria-hidden="true" />
              </button>
              {isOpen && <div className="faq-a">{item.a}</div>}
            </div>
          )
        })}
      </div>

      <div className="faq-foot">
        <button type="button" className="btn btn-primary" onClick={onClose}>Got it</button>
      </div>
    </Modal>
  )
}
