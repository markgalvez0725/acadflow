import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '@/context/UIContext'
import { useData } from '@/context/DataContext'
import { useAuth } from '@/context/AuthContext'
import {
  Search, LayoutDashboard, BookOpen, CalendarCheck, ClipboardList, Bell,
  FileQuestion, Rss, CalendarDays, Video, ClipboardSignature, Users, GraduationCap,
  Sun, Moon, Snowflake, Download, CornerDownLeft, ArrowUp, ArrowDown, User, Building2, History, ListChecks, MessageSquare, MessageSquarePlus, ShieldCheck,
} from 'lucide-react'
import { courseShort } from '@/constants/courses'

// Tab catalogs mirror AdminLayout / StudentLayout nav (kept in sync manually).
const ADMIN_TABS = [
  { id: 'stream',        label: 'Stream',         Icon: Rss },
  { id: 'dashboard',     label: 'Dashboard',      Icon: LayoutDashboard },
  { id: 'classes',       label: 'Classes',        Icon: BookOpen },
  { id: 'students',      label: 'Students',       Icon: Users },
  { id: 'grades',        label: 'Grades',         Icon: GraduationCap },
  { id: 'integrity',     label: 'Grade Integrity', Icon: ShieldCheck },
  { id: 'attendance',    label: 'Attendance',     Icon: CalendarCheck },
  { id: 'activities',    label: 'Activities',     Icon: ClipboardList },
  { id: 'caseStudies',   label: 'Case Studies',   Icon: ListChecks },
  { id: 'quizzes',       label: 'Quizzes',        Icon: FileQuestion },
  { id: 'messages',      label: 'Messages',       Icon: MessageSquare },
  { id: 'notifications', label: 'Notifications',  Icon: Bell },
  { id: 'calendar',      label: 'Calendar',       Icon: CalendarDays },
  { id: 'onlineClasses', label: 'Online Classes', Icon: Video },
  { id: 'feedback',      label: 'Feedback Hub',   Icon: MessageSquarePlus },
  { id: 'audit',         label: 'Audit Log',      Icon: History },
]

const STUDENT_TABS = [
  { id: 'stream',        label: 'Stream',         Icon: Rss },
  { id: 'overview',      label: 'Overview',       Icon: LayoutDashboard },
  { id: 'grades',        label: 'Grades',         Icon: BookOpen },
  { id: 'attendance',    label: 'Attendance',     Icon: CalendarCheck },
  { id: 'activities',    label: 'Activities',     Icon: ClipboardList },
  { id: 'assignments',   label: 'Assignments',    Icon: ListChecks },
  { id: 'quizzes',       label: 'Quizzes',        Icon: FileQuestion },
  { id: 'notifications', label: 'Notifications',  Icon: Bell },
  { id: 'calendar',      label: 'Calendar',       Icon: CalendarDays },
  { id: 'onlineClasses', label: 'Online Classes', Icon: Video },
  { id: 'enrollment',    label: 'Enrollment',     Icon: ClipboardSignature },
  { id: 'feedback',      label: 'Feedback',       Icon: MessageSquarePlus },
]

// Subsequence fuzzy match → score (lower is better); null if no match.
function fuzzyScore(query, text) {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx !== -1) return idx // contiguous match, prefer earlier
  let ti = 0, score = 0, last = -1
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti)
    if (found === -1) return null
    score += found - last - 1
    last = found
    ti = found + 1
  }
  return 100 + score
}

export default function CommandPalette() {
  const { sessionRole, currentStudent } = useAuth()
  const { theme, toggleTheme, adminTab, setAdminTab, studentTab, setStudentTab, toast, openStudentProfile, navigateToTarget } = useUI()
  const { students = [], classes = [], activities = [], quizzes = [] } = useData()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [deferredInstall, setDeferredInstall] = useState(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const isAdmin = sessionRole === 'admin'

  // Capture the PWA install prompt so we can surface it as a command.
  useEffect(() => {
    function onBIP(e) { e.preventDefault(); setDeferredInstall(e) }
    window.addEventListener('beforeinstallprompt', onBIP)
    return () => window.removeEventListener('beforeinstallprompt', onBIP)
  }, [])

  // Global Ctrl/Cmd-K toggle.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    function onOpenEvent() { setOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('acadflow:open-command', onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('acadflow:open-command', onOpenEvent)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQuery(''); setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const go = useCallback((tab) => {
    if (isAdmin) setAdminTab(tab); else setStudentTab(tab)
    setOpen(false)
  }, [isAdmin, setAdminTab, setStudentTab])

  // Build the full command list for the current role.
  const commands = useMemo(() => {
    const tabs = (isAdmin ? ADMIN_TABS : STUDENT_TABS).map((t) => ({
      id: 'tab:' + t.id,
      label: t.label,
      section: 'Navigate',
      keywords: 'go open ' + t.label,
      Icon: t.Icon,
      run: () => go(t.id),
    }))

    const actions = [
      {
        id: 'theme',
        // Cycles light → dark → frost; the label/icon preview the NEXT theme.
        // (The old data-glass "Turn on frosted glass" toggle was removed: the
        // frost THEME replaced it, and flipping data-glass under frost broke
        // the glass styling.)
        label: theme === 'light' ? 'Switch to dark theme'
             : theme === 'dark'  ? 'Switch to frosted glass theme'
             :                     'Switch to light theme',
        section: 'Actions',
        keywords: 'theme dark light frost frosted glass plum mode appearance',
        Icon: theme === 'light' ? Moon : theme === 'dark' ? Snowflake : Sun,
        run: () => { toggleTheme(); setOpen(false) },
      },
    ]
    if (deferredInstall) {
      actions.push({
        id: 'install',
        label: 'Install AcadFlow app',
        section: 'Actions',
        keywords: 'install pwa app home screen',
        Icon: Download,
        run: async () => {
          setOpen(false)
          try { deferredInstall.prompt(); await deferredInstall.userChoice; setDeferredInstall(null) }
          catch {}
        },
      })
    }

    // Admin-only: jump to a student or class record.
    const entities = []
    if (isAdmin) {
      students.slice(0, 400).forEach((s) => {
        entities.push({
          id: 'student:' + s.id,
          label: s.name || s.id,
          hint: [s.snum || s.id, courseShort(s.course)].filter(Boolean).join(' · '),
          section: 'Students',
          keywords: `${s.name || ''} ${s.snum || ''} ${s.id} ${s.course || ''} ${courseShort(s.course)}`,
          Icon: User,
          run: () => { openStudentProfile?.(s.id); setOpen(false) },
        })
      })
      classes.filter((c) => !c.archived).forEach((c) => {
        entities.push({
          id: 'class:' + c.id,
          label: `${courseShort(c.name)}${c.section ? ' · ' + c.section : ''}`,
          hint: (c.subjects || []).slice(0, 3).join(', '),
          section: 'Classes',
          keywords: `${c.name} ${courseShort(c.name)} ${c.section || ''} ${(c.subjects || []).join(' ')}`,
          Icon: Building2,
          run: () => { navigateToTarget({ side: 'admin', tab: 'classes', type: 'class', id: c.id }); setOpen(false) },
        })
      })
      activities.slice(0, 300).forEach((a) => {
        const c = classes.find((x) => x.id === a.classId)
        entities.push({
          id: 'activity:' + a.id,
          label: a.title,
          hint: [a.subject, c?.name].filter(Boolean).join(' · '),
          section: 'Activities',
          keywords: `${a.title} ${a.subject || ''} activity assignment`,
          Icon: ClipboardList,
          run: () => { navigateToTarget({ side: 'admin', tab: 'activities', type: 'activity', id: a.id }); setOpen(false) },
        })
      })
      quizzes.slice(0, 200).forEach((qz) => {
        entities.push({
          id: 'quiz:' + qz.id,
          label: qz.title,
          hint: qz.subject || '',
          section: 'Quizzes',
          keywords: `${qz.title} ${qz.subject || ''} quiz exam`,
          Icon: FileQuestion,
          run: () => { navigateToTarget({ side: 'admin', tab: 'quizzes', type: 'quiz', id: qz.id }); setOpen(false) },
        })
      })
    }

    // Student-only: search your own subjects (→ grades) and activities.
    if (!isAdmin && currentStudent) {
      const me = students.find((s) => s.id === currentStudent.id)
      if (me) {
        const myClassIds = me.classIds?.length ? me.classIds : (me.classId ? [me.classId] : [])
        const mySubjects = [...new Set(myClassIds.flatMap((id) => classes.find((c) => c.id === id)?.subjects || []))]
        mySubjects.forEach((sub) => {
          entities.push({
            id: 'subject:' + sub,
            label: sub,
            hint: 'View grade',
            section: 'My Grades',
            keywords: `${sub} grade subject`,
            Icon: GraduationCap,
            run: () => { setStudentTab('grades'); setOpen(false) },
          })
        })
        activities.filter((a) => myClassIds.includes(a.classId)).slice(0, 200).forEach((a) => {
          entities.push({
            id: 'sact:' + a.id,
            label: a.title,
            hint: a.subject || '',
            section: 'My Activities',
            keywords: `${a.title} ${a.subject || ''} activity assignment`,
            Icon: ClipboardList,
            run: () => { setStudentTab('activities'); setOpen(false) },
          })
        })
      }
    }

    return [...tabs, ...actions, ...entities]
  }, [isAdmin, theme, deferredInstall, students, classes, activities, quizzes, currentStudent, go, toggleTheme, setAdminTab, setStudentTab, toast, openStudentProfile, navigateToTarget])

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Default view: navigation + actions only (skip the long entity list).
      return commands.filter((c) => c.section === 'Navigate' || c.section === 'Actions')
    }
    return commands
      .map((c) => ({ c, score: fuzzyScore(query.trim(), c.label + ' ' + (c.keywords || '')) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((x) => x.c)
  }, [commands, query])

  useEffect(() => { setActive(0) }, [query])

  // Keep active item in view.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, filtered])

  function onListKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run() }
  }

  if (!open || !sessionRole) return null

  // Group for rendering.
  let lastSection = null

  return createPortal(
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'var(--overlay-scrim, rgba(8,12,22,.5))', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '12vh 16px 16px', animation: 'cp-fade .14s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onListKey}
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--glass-bg, var(--surface))',
          backdropFilter: 'blur(22px) saturate(170%)',
          WebkitBackdropFilter: 'blur(22px) saturate(170%)',
          border: '1px solid var(--glass-border, var(--border2))', borderRadius: 18,
          boxShadow: '0 1px 0 rgba(255,255,255,.4) inset, 0 24px 70px rgba(8,12,22,.45)', overflow: 'hidden',
          animation: 'cp-pop .16s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={18} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAdmin ? 'Search tabs, students, classes, activities…' : 'Search tabs, subjects, activities…'}
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none',
              background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px',
              fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-body)',
            }}
          />
          <kbd style={kbdStyle}>esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: '48vh', overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink3)', fontSize: 13 }}>
              No matches for “{query}”.
            </div>
          )}
          {filtered.map((c, i) => {
            const showSection = c.section !== lastSection
            lastSection = c.section
            const isActive = i === active
            return (
              <React.Fragment key={c.id}>
                {showSection && (
                  <div style={{ padding: '8px 12px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
                    {c.section}
                  </div>
                )}
                <button
                  data-active={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => c.run()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, width: '100%',
                    padding: '9px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    borderRadius: 10, background: isActive ? 'var(--accent-l)' : 'transparent',
                    color: 'var(--ink)', fontSize: 14, fontFamily: 'var(--font-body)',
                  }}
                >
                  <span style={{ color: isActive ? 'var(--accent)' : 'var(--ink2)', display: 'flex', flexShrink: 0 }}>
                    <c.Icon size={17} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isActive ? 600 : 500 }}>
                      {c.label}
                    </span>
                    {c.hint && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.hint}
                      </span>
                    )}
                  </span>
                  {isActive && <CornerDownLeft size={14} style={{ color: 'var(--ink3)', flexShrink: 0 }} />}
                </button>
              </React.Fragment>
            )
          })}
        </div>

        {/* Footer hint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--ink3)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><CornerDownLeft size={11} /> select</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <kbd style={kbdStyle}>⌘</kbd><kbd style={kbdStyle}>K</kbd>
          </span>
        </div>
      </div>

      <style>{`
        @keyframes cp-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cp-pop { from { opacity: 0; transform: translateY(-8px) scale(.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>,
    document.body
  )
}

const kbdStyle = {
  fontFamily: 'var(--font-mono)', fontSize: 10, lineHeight: '14px',
  padding: '1px 5px', borderRadius: 5, background: 'var(--surface2)',
  border: '1px solid var(--border)', color: 'var(--ink3)',
}
