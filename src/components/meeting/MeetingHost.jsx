import React, { lazy, Suspense, useEffect } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'

// Layout-level host for the in-app classroom. Rendered ONCE in AdminLayout and
// StudentLayout (never inside a tab), so navigating between tabs while in a
// class keeps the call alive - the tabs only set meetingRoomId via
// useUI().openMeetingRoom(id). Minimizing swaps the full room for the floating
// mini player without unmounting the engine.
const MeetingRoom = lazy(() => import('@/components/meeting/MeetingRoom'))

export default function MeetingHost({ role, student }) {
  const { meetings, admin, endMeeting, generateMeetingRecap } = useData()
  const { meetingRoomId, meetingMinimized, closeMeetingRoom, setMeetingMinimized, toast } = useUI()

  // Logging out (or the layout otherwise unmounting) must not leave a stale
  // room id behind for the next session.
  useEffect(() => () => closeMeetingRoom(), [closeMeetingRoom])

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
