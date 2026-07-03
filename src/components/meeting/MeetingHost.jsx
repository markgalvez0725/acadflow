import React, { Suspense, useEffect, useRef, useState } from 'react'
import { lazyRetry } from '@/utils/lazyRetry'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { checkDriveVideoProcessed } from '@/utils/googleDrive'

// Layout-level host for the in-app classroom. Rendered ONCE in AdminLayout and
// StudentLayout (never inside a tab), so navigating between tabs while in a
// class keeps the call alive - the tabs only set meetingRoomId via
// useUI().openMeetingRoom(id). Minimizing swaps the full room for the floating
// mini player without unmounting the engine.
const MeetingRoom = lazyRetry(() => import('@/components/meeting/MeetingRoom'))
const ClassAttendanceModal = lazyRetry(() => import('@/components/meeting/ClassAttendanceModal'))

// If Drive can be queried but a recording has sat in 'processing' this long,
// fail open to 'ready' - the file page works even while the preview finishes.
const PROCESSING_GIVE_UP_MS = 45 * 60000

export default function MeetingHost({ role, student }) {
  const { meetings, admin, endMeeting, markMeetingRecordingReady, patchMeeting } = useData()
  const { meetingRoomId, meetingMinimized, closeMeetingRoom, setMeetingMinimized, toast } = useUI()
  // Ended class waiting for its attendance pass (professor only). Holds the
  // meeting id; the sheet opens once the room overlay has closed itself.
  const [attnId, setAttnId] = useState('')

  // Logging out (or the layout otherwise unmounting) must not leave a stale
  // room id behind for the next session.
  useEffect(() => () => closeMeetingRoom(), [closeMeetingRoom])

  // ── Recording status poller (professor only) ──────────────────────────────
  // A recording saves as 'processing' when its upload finishes; Drive then
  // needs a few minutes to process the video. While any recording is in that
  // state, ask Drive every 20s (silently - never a consent popup; skipped
  // when no token is available) and flip it to 'ready' + notify the professor
  // the moment the video becomes previewable. Because this host is mounted at
  // the layout, a recording left processing when the app closed is picked up
  // again on the next visit.
  const meetingsRef = useRef(meetings)
  meetingsRef.current = meetings
  // Only ENDED meetings: the early pointer exists while the class still runs,
  // and the video cannot finish processing before the upload finalizes.
  const processingKey = role === 'admin'
    ? meetings.filter(m => m.status === 'ended' && m.recording?.status === 'processing' && m.recording?.driveId).map(m => m.id).join(',')
    : ''
  useEffect(() => {
    if (!processingKey) return
    let dead = false
    let busy = false
    async function check() {
      if (busy) return
      busy = true
      try {
        for (const m of meetingsRef.current) {
          const rec = m.recording
          if (dead || m.status !== 'ended' || !rec || rec.status !== 'processing' || !rec.driveId) continue
          const done = await checkDriveVideoProcessed(rec.driveId)
          if (dead) return
          // The clock starts at whichever is later: the recording save or the
          // class end (the early pointer carries the record START time).
          const since = Math.max(rec.at || 0, m.endedAt || 0)
          const gaveUp = done === false && Date.now() - since > PROCESSING_GIVE_UP_MS
          if (done || gaveUp) {
            try { await markMeetingRecordingReady(m) } catch { /* retried next tick */ }
          }
        }
      } finally { busy = false }
    }
    check()
    const t = setInterval(check, 20000)
    return () => { dead = true; clearInterval(t) }
  }, [processingKey, markMeetingRecordingReady])

  // Attendance sheet for the class that just ended: rendered once the room
  // overlay is gone (it would stack under the room otherwise), and resolved
  // fresh from the meetings listener so the stamped joinLog is on it.
  const attnMeeting = role === 'admin' && attnId && !meetingRoomId
    ? meetings.find(m => m.id === attnId) || null
    : null
  const attnModal = attnMeeting ? (
    <Suspense fallback={null}>
      <ClassAttendanceModal meeting={attnMeeting} onClose={() => setAttnId('')} />
    </Suspense>
  ) : null

  if (!meetingRoomId) return attnModal
  const meeting = meetings.find(m => m.id === meetingRoomId) || null
  const self = role === 'admin'
    ? { uid: 'admin', name: admin?.name || 'Professor', role: 'admin' }
    : { uid: student?.id || '', name: student?.name || 'Student', role: 'student' }
  if (role === 'student' && !student) return null

  async function handleEndClass(joinLog) {
    if (!meeting) return
    try {
      // Stamp who joined (merged with any earlier stamp - the professor may
      // have rejoined mid-class) BEFORE ending, so the attendance sheet and
      // the ended row both have the log. Attendance still works by hand if
      // this write fails.
      if (Array.isArray(joinLog) && joinLog.length) {
        const merged = new Map((meeting.joinLog || []).map(e => [e.uid, e]))
        for (const e of joinLog) {
          const cur = merged.get(e.uid)
          if (!cur || (e.joinedAt || 0) < (cur.joinedAt || 0)) merged.set(e.uid, e)
        }
        try { await patchMeeting(meeting, { joinLog: [...merged.values()] }) } catch { /* hand-markable */ }
      }
      await endMeeting(meeting)
      toast('Class ended for everyone.', 'success')
      if (meeting.provider === 'inapp') setAttnId(meeting.id)
    } catch (e) {
      toast('Failed to end the class.', 'error')
    }
  }

  return (
    <Suspense fallback={null}>
      <MeetingRoom
        meeting={meeting}
        self={self}
        minimized={meetingMinimized}
        onMinimize={setMeetingMinimized}
        onClose={closeMeetingRoom}
        onEndClass={role === 'admin' ? handleEndClass : undefined}
      />
    </Suspense>
  )
}
