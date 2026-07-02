import React, { lazy, Suspense, useEffect, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import { checkDriveVideoProcessed } from '@/utils/googleDrive'

// Layout-level host for the in-app classroom. Rendered ONCE in AdminLayout and
// StudentLayout (never inside a tab), so navigating between tabs while in a
// class keeps the call alive - the tabs only set meetingRoomId via
// useUI().openMeetingRoom(id). Minimizing swaps the full room for the floating
// mini player without unmounting the engine.
const MeetingRoom = lazy(() => import('@/components/meeting/MeetingRoom'))

// If Drive can be queried but a recording has sat in 'processing' this long,
// fail open to 'ready' - the file page works even while the preview finishes.
const PROCESSING_GIVE_UP_MS = 45 * 60000

export default function MeetingHost({ role, student }) {
  const { meetings, admin, endMeeting, generateMeetingRecap, markMeetingRecordingReady } = useData()
  const { meetingRoomId, meetingMinimized, closeMeetingRoom, setMeetingMinimized, toast } = useUI()

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
  const processingKey = role === 'admin'
    ? meetings.filter(m => m.recording?.status === 'processing' && m.recording?.driveId).map(m => m.id).join(',')
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
          if (dead || !rec || rec.status !== 'processing' || !rec.driveId) continue
          const done = await checkDriveVideoProcessed(rec.driveId)
          if (dead) return
          const gaveUp = done === false && Date.now() - (rec.at || 0) > PROCESSING_GIVE_UP_MS
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

  if (!meetingRoomId) return null
  const meeting = meetings.find(m => m.id === meetingRoomId) || null
  const self = role === 'admin'
    ? { uid: 'admin', name: admin?.name || 'Professor', role: 'admin' }
    : { uid: student?.id || '', name: student?.name || 'Student', role: 'student' }
  if (role === 'student' && !student) return null

  async function handleEndClass() {
    if (!meeting) return
    try {
      const m = meeting
      await endMeeting(m)
      toast('Class ended for everyone.', 'success')
      // Give everyone a few seconds to flush their final transcript buffers
      // (participants write them during teardown), then build the Smart
      // Recap. If this device closes first, Regenerate covers it later.
      if (m.provider === 'inapp') {
        setTimeout(async () => {
          try {
            const recap = await generateMeetingRecap({ ...m, endedAt: Date.now() })
            if (recap) toast('Class recap is ready - open it from Past sessions.', 'success')
          } catch { /* Regenerate remains available on the past meeting */ }
        }, 4500)
      }
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
