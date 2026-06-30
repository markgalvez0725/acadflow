import React, { useState } from 'react'
import { ChevronDown, HelpCircle } from 'lucide-react'
import Modal, { ModalHeader } from '@/components/primitives/Modal'

/**
 * "About AcadFlow" FAQ - explains why the portal exists and how it works.
 * Opened from either login screen. Content lives in FAQ_ITEMS below so it's
 * easy to edit; the first item leads with the origin story.
 *
 * Props:
 *  - onClose {function}
 */
const FAQ_ITEMS = [
  {
    q: 'Why was AcadFlow created?',
    a: `AcadFlow began as a way to fix a daily frustration: a class's grades lived in one spreadsheet, attendance in another, announcements in a group chat, and quizzes somewhere else entirely. Nobody - professor or student - had a single, calm place to see how the semester was actually going. I built AcadFlow to pull all of that into one real-time portal, so everyone can focus on learning instead of chasing scattered files.`,
  },
  {
    q: 'What problem does it solve?',
    a: `It replaces the patchwork of spreadsheets, paper logs, and group chats with one source of truth. Grades, attendance, activities, quizzes, announcements, online classes, and messages all update live - students always see their real standing, and professors spend less time on busywork. Because everything syncs in real time, there's no refreshing or re-sending: a grade or announcement posted on one device shows up everywhere within seconds.`,
  },
  {
    q: 'Who is AcadFlow for?',
    a: `Two roles share the same portal. Professors and staff (the admin side) manage classes, grades, attendance, and announcements; students see their own grades, attendance, deadlines, and messages. Everyone works from the same live data - just the slice that's relevant to them.`,
  },
  {
    q: 'Is my data private and secure?',
    a: `Yes. Passwords are never stored in plain text - they're hashed before saving, and sensitive configuration is encrypted. The app is served only over a secure (HTTPS) connection. Students can only ever see their own records. Your profile photo is checked privately on your own device and matched against your enrolled Face ID, so the picture on an account is provably the real student and can't be faked. On your own device you can also enable a PIN or fingerprint/Face ID quick-unlock for faster, private sign-ins.`,
  },
  {
    q: 'How do I get the verified badge?',
    a: `The first time you sign in, AcadFlow guides you step by step in Settings - it opens automatically and walks you through three things: setting a password only you know, enrolling Face ID, and adding a clear profile photo. Your photo is verified right on your device and matched to the face you just enrolled, so it has to be really you. Once all the steps are done, a verified badge appears next to your name and your grades, quizzes, and activities unlock. The on-screen guide tells you exactly what to do at each step.`,
  },
  {
    q: 'What if I forget my password?',
    a: `On the login screen, choose "Reset with Face ID." After a quick liveness check your device scans your face, the server confirms it matches the face you enrolled, and then you set a brand-new password yourself - no professor needed and no temporary password is ever shown. If you haven't set up Face ID yet, your professor can still reset your password for you.`,
  },
  {
    q: 'How do I install AcadFlow as an app?',
    a: `You don't have to - AcadFlow runs in any modern browser. But because it's a Progressive Web App, you can add it to your device for an app-like experience with its own icon, a full-screen view, and push notifications for deadlines and announcements:

• iPhone / iPad (Safari): tap the Share button, then "Add to Home Screen."
• Android (Chrome): tap the ⋮ menu, then "Install app" (or "Add to Home Screen").
• Desktop (Chrome / Edge): click the install icon in the address bar, or open the ⋮ menu and choose "Install AcadFlow."

Once installed, just open it like any other app - your login and data stay exactly the same.`,
  },
  {
    q: 'How do I get an account?',
    a: `Your professor sets up your account from the class roster and gives you a default password. Sign in with your student number and that password, then a short guided setup in Settings helps you set your own password and finish verifying your account (see "How do I get the verified badge?"). If you can't sign in, ask your professor to add or correct your record.`,
  },
  {
    q: 'How much does it cost?',
    a: `Nothing. AcadFlow is a focused, self-contained project - there are no ads, no subscriptions, and nothing to buy to sign in and use the portal.`,
  },
]

export default function FaqModal({ onClose }) {
  const [open, setOpen] = useState(0)

  return (
    <Modal onClose={onClose} size="lg" zIndex={300} sheetOnMobile
      header={<ModalHeader flush icon={<HelpCircle size={18} />} title="About AcadFlow" subtitle="Why this portal exists & how it works" />}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Got it</button>}
    >
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

    </Modal>
  )
}
