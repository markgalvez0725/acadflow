# Online Classes (Google Meet Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Online Classes tab to both admin and student portals, backed by a new `onlineMeetings` Firestore collection, allowing teachers to manage per-class Meet links, schedule/start/end/cancel sessions, and notify students in real time.

**Architecture:** All meeting data lives in a new `onlineMeetings` Firestore collection, listened to in real time via the existing `fbStartListening` pattern in `listeners.js`. Meeting lifecycle actions (schedule, start, end, cancel) write to Firestore via new persistence helpers in `persistence.js` and push notifications to `notifications/{studentId}` documents for all enrolled students. Student and admin portals each get a new `OnlineClassesTab` component registered as lazy-loaded tabs.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, Firebase Firestore (modular SDK v10), lucide-react, uuid v4

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/firebase/listeners.js` | Add `onlineMeetings` snapshot listener + callback |
| Modify | `src/firebase/persistence.js` | Add `fbScheduleMeeting`, `fbStartMeeting`, `fbEndMeeting`, `fbCancelMeeting`, `fbSaveMeetLink`, `fbPushMeetingNotifs` |
| Modify | `src/context/DataContext.jsx` | Add `meetings`, `liveMeetings` state + 5 helper functions |
| Create | `src/components/admin/tabs/OnlineClassesTab.jsx` | Admin tab: Meet link management, schedule form, meetings list |
| Modify | `src/components/admin/AdminSidebar.jsx` | Add `onlineClasses` nav item under Communication group |
| Modify | `src/components/admin/AdminLayout.jsx` | Register lazy tab + TAB_TITLES entry |
| Create | `src/components/student/tabs/OnlineClassesTab.jsx` | Student tab: Live Now banner, upcoming, past sessions |
| Modify | `src/components/student/StudentLayout.jsx` | Register lazy tab + NAV_ITEMS entry |
| Modify | `src/components/student/tabs/NotificationsTab.jsx` | Add `Video` icon and `onlineClasses` action for meeting notification types |

---

## Task 1: Add `onlineMeetings` Firestore listener

**Files:**
- Modify: `src/firebase/listeners.js`

- [ ] **Step 1: Add `onMeetingsUpdate` to `fbStartListening` callback parameter list**

In `src/firebase/listeners.js`, update the `fbStartListening` function signature and body. Add the new listener after the announcements listener (after line 177):

```js
// In the callbacks destructure at the top of fbStartListening:
onMeetingsUpdate,

// New listener block — add after the announcements listener block:
  // ── onlineMeetings collection ─────────────────────────────────────────
  if (onMeetingsUpdate) {
    const u9 = onSnapshot(
      collection(db, 'onlineMeetings'),
      snap => {
        const meetings = [];
        snap.forEach(d => meetings.push(d.data()));
        onMeetingsUpdate(meetings);
      },
      e => console.error('[Firebase] onlineMeetings listener error:', e.message)
    );
    _unsub.push(u9);
  }
```

- [ ] **Step 2: Add `onMeetingsUpdate` to JSDoc comment**

In the JSDoc block at the top of `fbStartListening` (around line 27), add:
```js
 *   onMeetingsUpdate: (meetings: any[]) => void,
```

- [ ] **Step 3: Add eager fetch for onlineMeetings in `_eagerFetchAll`**

In `_eagerFetchAll`, add `onMeetingsUpdate` to the parameter destructure and fetch:

```js
// Add to function signature destructure:
onMeetingsUpdate,

// Add to Promise.all array:
getDocs(collection(db, 'onlineMeetings')),

// Add result handling after the announcements block:
    if (onMeetingsUpdate) {
      const mtgs = [];
      // meetingsSnap is the 9th element in the destructured array
      meetingsSnap.forEach(d => mtgs.push(d.data()));
      onMeetingsUpdate(mtgs);
    }
```

The full destructured array in `_eagerFetchAll` becomes:

```js
const [studentsSnap, classesSnap, messagesSnap, activitiesSnap, notifsSnap, settingsSnap, quizzesSnap, announcementsSnap, meetingsSnap] = await Promise.race([...])
```

- [ ] **Step 4: Commit**

```bash
git add src/firebase/listeners.js
git commit -m "feat: add onlineMeetings real-time listener"
```

---

## Task 2: Add persistence helpers for meetings

**Files:**
- Modify: `src/firebase/persistence.js`

- [ ] **Step 1: Add `fbSaveMeetLink` helper**

At the end of `src/firebase/persistence.js`, add:

```js
// ── Online Meetings ────────────────────────────────────────────────────────

/**
 * Save a Google Meet link to a class document inside portal/classes.
 * Classes are stored as portal/classes.list (array), so we read-modify-write.
 */
export async function fbSaveMeetLink(db, classId, meetLink) {
  if (!db || !classId) return;
  const { doc: fbDoc, getDoc, setDoc } = await import('firebase/firestore');
  const ref = fbDoc(db, 'portal', 'classes');
  const snap = await fbWithTimeout(getDoc(ref));
  if (!snap.exists()) return;
  const list = snap.data()?.list || [];
  const updated = list.map(c => c.id === classId ? { ...c, meetLink } : c);
  await fbWithTimeout(setDoc(ref, { list: updated }));
}
```

- [ ] **Step 2: Add `fbScheduleMeeting` helper**

```js
export async function fbScheduleMeeting(db, meetingData) {
  if (!db) return;
  const { doc: fbDoc, setDoc, serverTimestamp } = await import('firebase/firestore');
  const id = uuidv4();
  const meeting = {
    id,
    classId: meetingData.classId,
    className: meetingData.className,
    title: meetingData.title,
    description: meetingData.description || '',
    meetLink: meetingData.meetLink || '',
    scheduledAt: meetingData.scheduledAt, // JS timestamp (ms)
    status: 'scheduled',
    createdAt: Date.now(),
    endedAt: null,
  };
  await fbWithTimeout(setDoc(fbDoc(db, 'onlineMeetings', id), meeting));
  return meeting;
}
```

- [ ] **Step 3: Add `fbStartMeeting` helper**

```js
export async function fbStartMeeting(db, meetingId) {
  if (!db || !meetingId) return;
  const { doc: fbDoc, updateDoc } = await import('firebase/firestore');
  await fbWithTimeout(updateDoc(fbDoc(db, 'onlineMeetings', meetingId), {
    status: 'live',
  }));
}
```

- [ ] **Step 4: Add `fbEndMeeting` helper**

```js
export async function fbEndMeeting(db, meetingId) {
  if (!db || !meetingId) return;
  const { doc: fbDoc, updateDoc } = await import('firebase/firestore');
  await fbWithTimeout(updateDoc(fbDoc(db, 'onlineMeetings', meetingId), {
    status: 'ended',
    endedAt: Date.now(),
  }));
}
```

- [ ] **Step 5: Add `fbCancelMeeting` helper**

```js
export async function fbCancelMeeting(db, meetingId) {
  if (!db || !meetingId) return;
  const { doc: fbDoc, deleteDoc } = await import('firebase/firestore');
  await fbWithTimeout(deleteDoc(fbDoc(db, 'onlineMeetings', meetingId)));
}
```

- [ ] **Step 6: Add `fbPushMeetingNotifs` helper**

This writes a notification document to `notifications/{studentId}` for each enrolled student, following the same pattern as `fbPushAnnouncementNotifs`:

```js
export async function fbPushMeetingNotifs(db, meeting, students, type) {
  if (!db || !meeting || !students?.length) return;
  const enrolled = students.filter(s => {
    const ids = s.classIds?.length ? s.classIds : (s.classId ? [s.classId] : []);
    return ids.includes(meeting.classId);
  });
  if (!enrolled.length) return;

  const { doc: fbDoc, getDoc, setDoc } = await import('firebase/firestore');

  const messages = {
    meeting_scheduled: `${meeting.className}: Online class scheduled for ${new Date(meeting.scheduledAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} at ${new Date(meeting.scheduledAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`,
    meeting_live: `${meeting.className} is LIVE now! Join the meeting.`,
    meeting_cancelled: `${meeting.className}: Scheduled online class on ${new Date(meeting.scheduledAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} has been cancelled.`,
    meeting_ended: `${meeting.className}: Online class session has ended.`,
  };

  const notif = {
    id: `n_${uuidv4()}`,
    type,
    read: false,
    ts: Date.now(),
    title: messages[type] || `${meeting.className}: Meeting update`,
    body: meeting.title,
    link: 'onlineClasses',
    meetingId: meeting.id,
    meetLink: meeting.meetLink || null,
    classId: meeting.classId,
    className: meeting.className,
    scheduledAt: meeting.scheduledAt || null,
  };

  for (let i = 0; i < enrolled.length; i += BATCH) {
    await Promise.all(enrolled.slice(i, i + BATCH).map(async s => {
      try {
        const ref = fbDoc(db, 'notifications', s.id);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? (snap.data().items || []) : [];
        await setDoc(ref, { items: [notif, ...existing] }, { merge: false });
      } catch (e) {
        console.warn('[FB] fbPushMeetingNotifs student:', s.id, e.message);
      }
    }));
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/firebase/persistence.js
git commit -m "feat: add meeting persistence helpers (schedule, start, end, cancel, notify)"
```

---

## Task 3: Wire meetings into DataContext

**Files:**
- Modify: `src/context/DataContext.jsx`

- [ ] **Step 1: Add import for new persistence helpers**

At the top of `src/context/DataContext.jsx`, update the persistence import line (currently line 4) to include the new helpers:

```js
import {
  persistStudentsSync, persistClassesSync, persistAdmin, loadAdminFromStorage,
  fbDeleteStudent, fbSaveAnnouncement, fbDeleteAnnouncement, fbPushAnnouncementNotifs,
  fbAddAnnouncementComment, fbAddCommentReply,
  fbSaveMeetLink, fbScheduleMeeting, fbStartMeeting, fbEndMeeting, fbCancelMeeting, fbPushMeetingNotifs,
} from '@/firebase/persistence'
```

- [ ] **Step 2: Add `meetings` state**

After the `announcements` state declaration (around line 18), add:

```js
const [meetings, setMeetings] = useState([])
```

- [ ] **Step 3: Pass `onMeetingsUpdate` to `fbStartListening` in `_bootstrap`**

In the `fbStartListening` call inside `_bootstrap` (around line 75), add:

```js
onMeetingsUpdate: setMeetings,
```

- [ ] **Step 4: Pass `onMeetingsUpdate` to `fbStartListening` in `reinitFirebase`**

In the `fbStartListening` call inside `reinitFirebase` (around line 113), add:

```js
onMeetingsUpdate: setMeetings,
```

- [ ] **Step 5: Add `saveMeetLink` helper**

After the `deleteAnnouncement` callback (around line 184), add:

```js
  const saveMeetLink = useCallback(async (classId, meetLink) => {
    setClasses(prev => prev.map(c => c.id === classId ? { ...c, meetLink } : c))
    await fbSaveMeetLink(dbRef.current, classId, meetLink)
  }, [])
```

- [ ] **Step 6: Add `scheduleMeeting` helper**

```js
  const scheduleMeeting = useCallback(async (meetingData) => {
    const meeting = await fbScheduleMeeting(dbRef.current, meetingData)
    if (meeting) await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_scheduled')
  }, [students])
```

- [ ] **Step 7: Add `startMeeting` helper**

```js
  const startMeeting = useCallback(async (meeting) => {
    await fbStartMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_live')
  }, [students])
```

- [ ] **Step 8: Add `endMeeting` helper**

```js
  const endMeeting = useCallback(async (meeting) => {
    await fbEndMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_ended')
  }, [students])
```

- [ ] **Step 9: Add `cancelMeeting` helper**

```js
  const cancelMeeting = useCallback(async (meeting) => {
    await fbCancelMeeting(dbRef.current, meeting.id)
    await fbPushMeetingNotifs(dbRef.current, meeting, students, 'meeting_cancelled')
  }, [students])
```

- [ ] **Step 10: Add `meetings`, `liveMeetings`, and helpers to context value**

In the `DataContext.Provider` value object (around line 233), add:

```js
      meetings, setMeetings,
      liveMeetings: meetings.filter(m => m.status === 'live'),
      saveMeetLink, scheduleMeeting, startMeeting, endMeeting, cancelMeeting,
```

- [ ] **Step 11: Commit**

```bash
git add src/context/DataContext.jsx
git commit -m "feat: wire meetings state and helpers into DataContext"
```

---

## Task 4: Build admin OnlineClassesTab

**Files:**
- Create: `src/components/admin/tabs/OnlineClassesTab.jsx`

- [ ] **Step 1: Create the file with Meet Links panel (Section 1)**

Create `src/components/admin/tabs/OnlineClassesTab.jsx`:

```jsx
import React, { useState } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { Video, CalendarPlus, Clock, ExternalLink, VideoOff, Trash2, CheckCircle, Save } from 'lucide-react'

export default function OnlineClassesTab() {
  const { classes, meetings, saveMeetLink, scheduleMeeting, startMeeting, endMeeting, cancelMeeting } = useData()
  const { toast } = useUI()

  // ── Section 1: Meet Links ─────────────────────────────────────────────
  const [linkDrafts, setLinkDrafts] = useState({})

  function getLinkDraft(classId, fallback) {
    return linkDrafts[classId] !== undefined ? linkDrafts[classId] : (fallback || '')
  }

  async function handleSaveLink(cls) {
    const url = getLinkDraft(cls.id, cls.meetLink)
    if (!url.trim()) return
    try {
      await saveMeetLink(cls.id, url.trim())
      toast('Meet link saved.', 'success')
    } catch (e) {
      toast('Failed to save Meet link.', 'error')
    }
  }

  // ── Section 2: Schedule Form ──────────────────────────────────────────
  const [form, setForm] = useState({ classId: '', title: '', scheduledAt: '', description: '' })
  const [scheduling, setScheduling] = useState(false)

  async function handleSchedule(e) {
    e.preventDefault()
    if (!form.classId || !form.title || !form.scheduledAt) return
    const cls = classes.find(c => c.id === form.classId)
    if (!cls) return
    setScheduling(true)
    try {
      await scheduleMeeting({
        classId: cls.id,
        className: cls.name,
        title: form.title.trim(),
        description: form.description.trim(),
        meetLink: cls.meetLink || '',
        scheduledAt: new Date(form.scheduledAt).getTime(),
      })
      toast('Meeting scheduled. Students have been notified.', 'success')
      setForm({ classId: '', title: '', scheduledAt: '', description: '' })
    } catch (e) {
      toast('Failed to schedule meeting.', 'error')
    } finally {
      setScheduling(false)
    }
  }

  // ── Section 3: Meetings List ──────────────────────────────────────────
  const [listTab, setListTab] = useState('upcoming')
  const now = Date.now()
  const upcoming = meetings
    .filter(m => m.status === 'scheduled' || m.status === 'live')
    .sort((a, b) => a.scheduledAt - b.scheduledAt)
  const past = meetings
    .filter(m => m.status === 'ended')
    .sort((a, b) => b.scheduledAt - a.scheduledAt)

  async function handleStart(m) {
    try {
      await startMeeting(m)
      window.open(m.meetLink, '_blank', 'noopener,noreferrer')
      toast('Meeting is now live. Students have been notified.', 'success')
    } catch (e) {
      toast('Failed to start meeting.', 'error')
    }
  }

  async function handleEnd(m) {
    try {
      await endMeeting(m)
      toast('Meeting ended.', 'success')
    } catch (e) {
      toast('Failed to end meeting.', 'error')
    }
  }

  async function handleCancel(m) {
    try {
      await cancelMeeting(m)
      toast('Meeting cancelled. Students have been notified.', 'success')
    } catch (e) {
      toast('Failed to cancel meeting.', 'error')
    }
  }

  const activeClasses = classes.filter(c => !c.archived)

  return (
    <div className="online-classes-tab" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Section 1 — Class Meet Links */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={18} /> Class Meet Links
          </div>
        </div>
        {activeClasses.length === 0 && (
          <div className="empty"><div className="empty-icon"><Video size={36} /></div>No classes found. Add classes first.</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {activeClasses.map(cls => (
            <div key={cls.id} className="card" style={{ padding: '14px 16px' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{cls.name}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  style={{ flex: 1, fontSize: 12 }}
                  placeholder="Paste Google Meet URL..."
                  value={getLinkDraft(cls.id, cls.meetLink)}
                  onChange={e => setLinkDrafts(prev => ({ ...prev, [cls.id]: e.target.value }))}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleSaveLink(cls)}
                  title="Save Meet link"
                >
                  <Save size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2 — Schedule Meeting Form */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarPlus size={18} /> Schedule a Meeting
          </div>
        </div>
        <form onSubmit={handleSchedule} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Class</label>
              <select
                className="input"
                value={form.classId}
                onChange={e => setForm(f => ({ ...f, classId: e.target.value }))}
                required
              >
                <option value="">Select class...</option>
                {activeClasses.map(cls => (
                  <option key={cls.id} value={cls.id}>{cls.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Date & Time</label>
              <input
                className="input"
                type="datetime-local"
                value={form.scheduledAt}
                onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                required
              />
            </div>
          </div>
          <div>
            <label className="label">Meeting Title</label>
            <input
              className="input"
              placeholder="e.g. Chapter 5 Review"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input"
              placeholder="Topics to be covered..."
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{ resize: 'vertical' }}
            />
          </div>
          <div>
            <button className="btn btn-primary" type="submit" disabled={scheduling}>
              <CalendarPlus size={15} style={{ marginRight: 6 }} />
              {scheduling ? 'Scheduling...' : 'Schedule Meeting'}
            </button>
          </div>
        </form>
      </section>

      {/* Section 3 — Meetings List */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title">Meetings</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn btn-sm ${listTab === 'upcoming' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setListTab('upcoming')}
            >Upcoming</button>
            <button
              className={`btn btn-sm ${listTab === 'past' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setListTab('past')}
            >Past</button>
          </div>
        </div>

        {listTab === 'upcoming' && (
          upcoming.length === 0
            ? <div className="empty"><div className="empty-icon"><CalendarPlus size={36} /></div>No upcoming meetings.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {upcoming.map(m => <MeetingRow key={m.id} m={m} onStart={handleStart} onEnd={handleEnd} onCancel={handleCancel} />)}
              </div>
        )}

        {listTab === 'past' && (
          past.length === 0
            ? <div className="empty"><div className="empty-icon"><CheckCircle size={36} /></div>No past meetings.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {past.map(m => <MeetingRow key={m.id} m={m} />)}
              </div>
        )}
      </section>
    </div>
  )
}

function MeetingRow({ m, onStart, onEnd, onCancel }) {
  const dt = new Date(m.scheduledAt)
  const dateStr = dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{m.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>{m.className}</div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={12} /> {dateStr} at {timeStr}
        </div>
        {m.description && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 4 }}>{m.description}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <StatusBadge status={m.status} />
        {m.status === 'scheduled' && onStart && (
          <button className="btn btn-primary btn-sm" onClick={() => onStart(m)} title="Start meeting">
            <ExternalLink size={14} style={{ marginRight: 4 }} /> Start
          </button>
        )}
        {m.status === 'scheduled' && onCancel && (
          <button className="btn btn-ghost btn-sm" onClick={() => onCancel(m)} title="Cancel meeting">
            <Trash2 size={14} />
          </button>
        )}
        {m.status === 'live' && onEnd && (
          <button className="btn btn-sm" style={{ background: 'var(--red, #ef4444)', color: '#fff' }} onClick={() => onEnd(m)} title="End meeting">
            <VideoOff size={14} style={{ marginRight: 4 }} /> End
          </button>
        )}
        {m.status === 'ended' && <CheckCircle size={16} style={{ color: 'var(--green, #22c55e)' }} />}
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    scheduled: { label: 'Scheduled', color: 'var(--accent, #0ea5e9)' },
    live:      { label: 'LIVE',      color: 'var(--red, #ef4444)' },
    ended:     { label: 'Ended',     color: 'var(--ink3, #94a3b8)' },
  }
  const s = map[status] || map.ended
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
      background: s.color + '22', color: s.color, letterSpacing: '0.03em',
    }}>
      {s.label}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/admin/tabs/OnlineClassesTab.jsx
git commit -m "feat: add admin OnlineClassesTab component"
```

---

## Task 5: Register admin tab in sidebar and layout

**Files:**
- Modify: `src/components/admin/AdminSidebar.jsx`
- Modify: `src/components/admin/AdminLayout.jsx`

- [ ] **Step 1: Add `Video` to AdminSidebar imports and add nav item**

In `src/components/admin/AdminSidebar.jsx`, update the lucide-react import (line 5) to include `Video`:

```js
import { LayoutDashboard, School, Users, BookOpen, CalendarCheck, Bell, ClipboardList, Settings, LogOut, FileQuestion, Rss, CalendarDays, Video } from 'lucide-react'
```

In `NAV_GROUPS`, add the new item to the **Communication** group:

```js
  {
    label: 'Communication',
    items: [
      { id: 'notifications',  label: 'Notifications',  badgeId: 'notif', Icon: Bell },
      { id: 'activities',     label: 'Activities',     badgeId: 'act',   Icon: ClipboardList },
      { id: 'onlineClasses',  label: 'Online Classes', Icon: Video },
    ],
  },
```

- [ ] **Step 2: Register tab in AdminLayout**

In `src/components/admin/AdminLayout.jsx`:

Add the lazy import after the existing `CalendarTab` import (around line 24):
```js
const OnlineClassesTab = lazy(() => import('./tabs/OnlineClassesTab'))
```

Add to `TAB_TITLES` (around line 29):
```js
  onlineClasses: ['Online Classes', 'Schedule and manage Google Meet sessions for your classes'],
```

Find the section that renders tabs (the big `{adminTab === 'stream' && ...}` block) and add:
```jsx
              {adminTab === 'onlineClasses' && (
                <TabErrorBoundary>
                  <Suspense fallback={<SkeletonRows />}>
                    <OnlineClassesTab />
                  </Suspense>
                </TabErrorBoundary>
              )}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminSidebar.jsx src/components/admin/AdminLayout.jsx
git commit -m "feat: register OnlineClassesTab in admin sidebar and layout"
```

---

## Task 6: Build student OnlineClassesTab

**Files:**
- Create: `src/components/student/tabs/OnlineClassesTab.jsx`

- [ ] **Step 1: Create the file**

Create `src/components/student/tabs/OnlineClassesTab.jsx`:

```jsx
import React, { useState } from 'react'
import { useData } from '@/context/DataContext'
import { Video, Radio, ExternalLink, Clock, ChevronDown, ChevronUp } from 'lucide-react'

export default function OnlineClassesTab({ student }) {
  const { meetings } = useData()

  const studentClassIds = student
    ? (student.classIds?.length ? student.classIds : (student.classId ? [student.classId] : []))
    : []

  const myMeetings = meetings.filter(m => studentClassIds.includes(m.classId))

  const liveMeetings = myMeetings.filter(m => m.status === 'live')
  const upcoming = myMeetings
    .filter(m => m.status === 'scheduled')
    .sort((a, b) => a.scheduledAt - b.scheduledAt)
  const past = myMeetings
    .filter(m => m.status === 'ended')
    .sort((a, b) => b.scheduledAt - a.scheduledAt)

  const [pastOpen, setPastOpen] = useState(false)

  if (!student) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* Live Now Banners */}
      {liveMeetings.map(m => (
        <div key={m.id} style={{
          background: 'linear-gradient(135deg, #ef444422, #ef444408)',
          border: '1.5px solid #ef4444',
          borderRadius: 12,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Radio size={22} style={{ color: '#ef4444', animation: 'pulse 1.5s infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#ef4444', letterSpacing: '0.08em' }}>LIVE</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{m.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{m.className}</div>
          </div>
          <a
            href={m.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
            style={{ flexShrink: 0 }}
          >
            <ExternalLink size={14} style={{ marginRight: 6 }} /> Join Meeting
          </a>
        </div>
      ))}

      {/* Upcoming Meetings */}
      <section>
        <div className="sec-hdr mb-3">
          <div className="sec-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={17} /> Upcoming Classes
          </div>
        </div>
        {upcoming.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Video size={36} /></div>
            No upcoming online classes scheduled.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {upcoming.map(m => {
              const dt = new Date(m.scheduledAt)
              const dateStr = dt.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
              const timeStr = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
              return (
                <div key={m.id} className="card" style={{ padding: '12px 16px' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 4 }}>{m.className}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} /> {dateStr} at {timeStr}
                  </div>
                  {m.description && (
                    <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                      {m.description}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Past Sessions */}
      {past.length > 0 && (
        <section>
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink2)', fontWeight: 600, fontSize: 14 }}
            onClick={() => setPastOpen(o => !o)}
          >
            {pastOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Past Sessions ({past.length})
          </button>
          {pastOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {past.map(m => {
                const dt = new Date(m.scheduledAt)
                const dateStr = dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                return (
                  <div key={m.id} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--surface2)', fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{m.title}</span>
                    <span style={{ color: 'var(--ink3)', marginLeft: 10 }}>{m.className}</span>
                    <span style={{ color: 'var(--ink3)', marginLeft: 10 }}>· {dateStr}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/student/tabs/OnlineClassesTab.jsx
git commit -m "feat: add student OnlineClassesTab component"
```

---

## Task 7: Register student tab in StudentLayout

**Files:**
- Modify: `src/components/student/StudentLayout.jsx`

- [ ] **Step 1: Add lazy import**

In `src/components/student/StudentLayout.jsx`, add after the `CalendarTab` lazy import (around line 22):

```js
const OnlineClassesTab = lazy(() => import('./tabs/OnlineClassesTab'))
```

- [ ] **Step 2: Add `Video` to lucide-react import**

Update the lucide import (line 12) to include `Video`:

```js
import { LayoutDashboard, BookOpen, CalendarCheck, ClipboardList, Bell, FileQuestion, Rss, CalendarDays, Video } from 'lucide-react'
```

- [ ] **Step 3: Add to NAV_ITEMS**

In the `NAV_ITEMS` array, add after the `calendar` item:

```js
  { id: 'onlineClasses', label: 'Online Classes', Icon: Video },
```

- [ ] **Step 4: Add tab render**

In the tab-rendering section of `StudentLayout`, find where each tab is rendered conditionally (where `studentTab === 'calendar'` is handled) and add:

```jsx
              {studentTab === 'onlineClasses' && (
                <TabErrorBoundary>
                  <Suspense fallback={<SkeletonRows />}>
                    <OnlineClassesTab student={student} />
                  </Suspense>
                </TabErrorBoundary>
              )}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/student/StudentLayout.jsx
git commit -m "feat: register OnlineClassesTab in student layout"
```

---

## Task 8: Update student NotificationsTab for meeting types

**Files:**
- Modify: `src/components/student/tabs/NotificationsTab.jsx`

- [ ] **Step 1: Add `Video` to lucide-react import**

In `src/components/student/tabs/NotificationsTab.jsx`, update the import (line 6) to include `Video`:

```js
import { Mail, Upload, CheckCircle, BookOpen, MessageSquare, Bell, Trash2, Megaphone, Video } from 'lucide-react'
```

- [ ] **Step 2: Add meeting types to `ICONS` map**

In the `ICONS` object (around line 11), add:

```js
  meeting_scheduled: <Video size={16} />,
  meeting_live:      <Video size={16} />,
  meeting_cancelled: <Video size={16} />,
  meeting_ended:     <Video size={16} />,
```

- [ ] **Step 3: Add meeting types to `TYPE_TO_TAB` map**

In the `TYPE_TO_TAB` object (around line 27), add:

```js
  meeting_scheduled: { label: '→ View Online Classes', tab: 'onlineClasses' },
  meeting_live:      { label: '→ Join Meeting',        tab: 'onlineClasses' },
  meeting_cancelled: { label: '→ View Online Classes', tab: 'onlineClasses' },
  meeting_ended:     { label: '→ View Online Classes', tab: 'onlineClasses' },
```

- [ ] **Step 4: Commit**

```bash
git add src/components/student/tabs/NotificationsTab.jsx
git commit -m "feat: add meeting notification types to student NotificationsTab"
```

---

## Task 9: Smoke test end-to-end

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

Expected: Server starts at `http://localhost:5173` with no compilation errors.

- [ ] **Step 2: Test admin flow**

1. Log in as admin
2. Navigate to **Online Classes** tab — verify it appears in sidebar under Communication
3. Paste a Google Meet URL for one class — click Save — verify toast "Meet link saved."
4. Fill out Schedule Meeting form — click Schedule — verify toast "Meeting scheduled. Students have been notified."
5. Find the meeting in Upcoming list — verify status badge shows "Scheduled"
6. Click **Start** — verify: status changes to "LIVE", Meet link opens in new tab, toast "Meeting is now live."
7. Click **End** — verify: meeting moves to Past tab, status "Ended"

- [ ] **Step 3: Test student flow**

1. Log in as a student enrolled in the class used above
2. Navigate to **Online Classes** tab — verify it appears in student nav
3. Verify the scheduled meeting appears in Upcoming list with correct date/time
4. Navigate to **Notifications** tab — verify meeting notifications appear with Video icon and "→ View Online Classes" action
5. Click a meeting notification — verify it navigates to the Online Classes tab
6. When a meeting is set to live by admin, verify the Live Now banner appears

- [ ] **Step 4: Verify empty states**

1. Student with no enrolled classes — Online Classes tab shows empty state
2. Admin with no classes — Meet Links panel shows "No classes found" message
3. Admin with no meetings — Upcoming/Past show empty state messages

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete Online Classes Google Meet integration"
```
