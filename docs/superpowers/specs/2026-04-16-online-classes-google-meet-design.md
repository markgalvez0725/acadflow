# Online Classes (Google Meet Integration) — Design Spec

**Date:** 2026-04-16
**Status:** Approved

---

## Overview

Add an "Online Classes" feature to AcadFlow that allows the teacher to manage per-class Google Meet links, schedule meeting sessions, start/end/cancel meetings, and notify students in real time — all within the existing Firebase/React architecture. No external APIs, OAuth, or new dependencies required.

---

## Scope

- New `onlineClasses` tab in the admin (teacher) portal
- New `onlineClasses` tab in the student portal
- New `onlineMeetings` Firestore collection + real-time listener
- Extended `classes` collection with a `meetLink` field per class
- Meeting notifications written to the existing `adminNotifs` collection
- All icons use lucide-react

---

## Data Model

### `onlineMeetings/{meetingId}` (new collection)

| Field | Type | Description |
|---|---|---|
| `id` | string (uuid) | Document ID |
| `classId` | string | Links to `classes` collection |
| `className` | string | Denormalized for display |
| `title` | string | Meeting title (e.g. "Algebra — Chapter 5 Review") |
| `description` | string | Optional description |
| `meetLink` | string | Google Meet URL for this class |
| `scheduledAt` | timestamp | Date + time of the meeting |
| `status` | `'scheduled' \| 'live' \| 'ended'` | Meeting lifecycle state |
| `createdAt` | timestamp | Creation timestamp |
| `endedAt` | timestamp \| null | Set when status = ended |

### `classes/{classId}` (existing, extended)

New field added:

| Field | Type | Description |
|---|---|---|
| `meetLink` | string | Permanent Google Meet URL for this class |

### `adminNotifs/{notifId}` (existing, extended)

Meeting notifications follow existing schema plus:

| Field | Type | Description |
|---|---|---|
| `type` | string | `meeting_scheduled \| meeting_live \| meeting_cancelled \| meeting_ended` |
| `classId` | string | Class this meeting belongs to |
| `className` | string | Denormalized class name |
| `meetingId` | string | Related meeting document ID |
| `meetLink` | string \| null | Meet URL (null for cancelled/ended) |
| `message` | string | Pre-formatted display string |
| `scheduledAt` | timestamp \| null | Meeting time (for scheduled notifications) |
| `read` | boolean | Defaults to `false` |

---

## Notification Messages

| Event | Message |
|---|---|
| `meeting_scheduled` | "📅 [ClassName]: Online class scheduled for [date] at [time]" |
| `meeting_live` | "🔴 [ClassName] is LIVE now! Join the meeting." |
| `meeting_cancelled` | "[ClassName]: Scheduled online class on [date] has been cancelled." |
| `meeting_ended` | "[ClassName]: Online class session has ended." |

---

## Admin Portal: Online Classes Tab

### Tab Registration

- New nav item in `AdminSidebar.jsx` under the **Communication** group
- Icon: `Video` (lucide-react)
- Lazy-loaded in `AdminLayout.jsx` as `OnlineClassesTab`
- Registered in `TAB_TITLES` as `onlineClasses`

### Tab Layout

**Section 1 — Class Meet Links Panel**
- Grid of class cards, one per class from the existing `classes` collection
- Each card: class name + Meet link input field
- Teacher pastes the permanent Google Meet URL for each class
- Save button per card → calls `saveMeetLink(classId, url)` → updates `classes/{classId}.meetLink`

**Section 2 — Schedule Meeting Form**
- Fields: class selector (dropdown), meeting title, date + time picker, optional description
- "Schedule Meeting" button (icon: `CalendarPlus`) → calls `fbScheduleMeeting()`:
  - Writes new `onlineMeetings` doc with `status: 'scheduled'`
  - Writes `meeting_scheduled` notification to `adminNotifs`

**Section 3 — Meetings List**
- Two sub-tabs: **Upcoming** and **Past**
- Each meeting row: class name, title, scheduled date/time (icon: `Clock`), status badge, action buttons
- Action buttons per status:

| Status | Button | Icon | Action |
|---|---|---|---|
| `scheduled` | Start | `ExternalLink` | `fbStartMeeting()` → status=live, opens Meet link in new tab, writes `meeting_live` notif |
| `scheduled` | Cancel | `Trash2` | `fbCancelMeeting()` → deletes doc, writes `meeting_cancelled` notif |
| `live` | End | `VideoOff` | `fbEndMeeting()` → status=ended, writes `meeting_ended` notif |
| `ended` | — | `CheckCircle` | Read-only, shown in Past tab |

---

## Student Portal: Online Classes Tab

### Tab Registration

- New nav item in student sidebar/nav
- Icon: `Video` (lucide-react)
- Lazy-loaded in `StudentLayout.jsx` as `OnlineClassesTab`

### Tab Layout

**Section 1 — Live Now Banner (conditional)**
- Only rendered when `liveMeetings` (derived from `meetings` filtered by `status === 'live'`) contains meetings for classes the student is enrolled in
- Per live meeting: pulsing `Radio` icon, "LIVE" badge, class name, meeting title, **"Join Meeting"** button (icon: `ExternalLink`) opening Meet link in new tab
- Multiple banners if multiple classes are live simultaneously

**Section 2 — Upcoming Meetings**
- All `scheduled` meetings for the student's enrolled classes, sorted by `scheduledAt` ascending
- Each row: class name, title, date/time (icon: `Clock`), optional description
- Read-only

**Section 3 — Past Sessions (collapsible)**
- All `ended` meetings for the student's enrolled classes
- Shows: title, class name, date only

### Student Filtering

Meetings are filtered client-side using `student.classes` array against `meeting.classId`. Only meetings belonging to the student's enrolled classes are shown.

---

## Notification Integration

### Student Notification Tab

- Existing `NotificationsTab` renders `adminNotifs` in real time (no changes needed to listener)
- Meeting notifications render with a `Video` icon prefix
- Each meeting notification has a **"View"** action button that calls `setStudentTab('onlineClasses')` from `UIContext`

### Live Detection

- `DataContext` exposes `liveMeetings` — derived from `meetings` where `status === 'live'`
- Purely reactive via existing Firestore real-time listener — no polling

---

## Firebase Listener & DataContext

### New listener: `onlineMeetings`

Added to `src/firebase/listeners.js`:
- `onSnapshot` on full `onlineMeetings` collection, ordered by `scheduledAt`
- Feeds into `DataContext` as `meetings` state array

### DataContext additions

```js
meetings: []                          // all onlineMeetings docs, real-time
liveMeetings: []                      // derived: meetings where status === 'live'
saveMeetLink(classId, url)            // updates classes/{classId}.meetLink
fbScheduleMeeting(meetingData)        // writes onlineMeetings + adminNotifs
fbStartMeeting(meetingId, meetLink)   // sets status=live + adminNotifs + opens tab
fbEndMeeting(meetingId)               // sets status=ended + adminNotifs
fbCancelMeeting(meetingId)            // deletes doc + adminNotifs
```

### New persistence helpers (`src/firebase/persistence.js`)

All four write helpers:
- `fbScheduleMeeting(db, meetingData)` — uses `uuidv4()` for ID, wrapped with `fbWithTimeout()`
- `fbStartMeeting(db, meetingId, meetLink)` — updates `status` to `'live'`, sets no `endedAt`
- `fbEndMeeting(db, meetingId)` — updates `status` to `'ended'`, sets `endedAt: serverTimestamp()`
- `fbCancelMeeting(db, meetingId)` — `deleteDoc`, consistent with `fbDeleteStudent` pattern

---

## New Files

| File | Description |
|---|---|
| `src/components/admin/tabs/OnlineClassesTab.jsx` | Admin Online Classes tab |
| `src/components/student/tabs/OnlineClassesTab.jsx` | Student Online Classes tab |

## Modified Files

| File | Change |
|---|---|
| `src/components/admin/AdminSidebar.jsx` | Add `onlineClasses` nav item |
| `src/components/admin/AdminLayout.jsx` | Register lazy tab + TAB_TITLES entry |
| `src/components/student/StudentLayout.jsx` | Register lazy tab + nav item |
| `src/firebase/listeners.js` | Add `onlineMeetings` snapshot listener |
| `src/firebase/persistence.js` | Add 4 meeting write helpers |
| `src/context/DataContext.jsx` | Add `meetings`, `liveMeetings`, and helper functions |
| `src/components/student/tabs/NotificationsTab.jsx` | Render meeting notification type with Video icon + View button |

---

## Out of Scope

- OAuth / Google Calendar API integration
- Push or email notifications
- Browser-based screen recording (MediaRecorder)
- Embedding Google Meet via iframe
- Per-session generated Meet links (links are per-class, permanent)
