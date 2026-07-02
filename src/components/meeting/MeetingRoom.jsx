import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Radio,
  Users, AlertTriangle, Loader2, CheckCircle,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import useMeetingRoom from '@/hooks/useMeetingRoom'
import { ROOM_CAP } from '@/firebase/rtc'

// Full-screen in-app classroom shared by the professor and student tabs.
// The call itself lives in useMeetingRoom; this renders tiles + controls and
// watches meeting.status so everyone's overlay closes when the class ends.
//   meeting    - the live onlineMeetings doc (parent passes the fresh object
//                from useData().meetings each render)
//   self       - { uid, name, role: 'admin' | 'student' }
//   onClose    - always called when the user is out of the room
//   onEndClass - professor only: ends the meeting for everyone

function fmtElapsed(ms) {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just started'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} m`
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

function VideoTile({ stream, name, role, micOn, camOn, mirrored, muted, failed, featured, isSelf, sharing }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  const showVideo = !!stream && camOn !== false
  return (
    <div className={`mr-tile${featured ? ' mr-tile-featured' : ''}`}>
      {/* Keep the <video> mounted even when the camera is off - it still carries the audio. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className="mr-video"
        style={{
          transform: mirrored ? 'scaleX(-1)' : undefined,
          visibility: showVideo ? 'visible' : 'hidden',
        }}
      />
      {!showVideo && (
        <div className="mr-tile-avatar">
          <span className="mr-avatar-circle">{initials(name)}</span>
          {!stream && !isSelf && !failed && <span className="mr-tile-hint">connecting…</span>}
          {failed && <span className="mr-tile-hint mr-tile-bad"><AlertTriangle size={12} /> could not connect</span>}
        </div>
      )}
      <div className="mr-tile-name">
        {micOn === false && <MicOff size={12} />}
        {sharing && <MonitorUp size={12} />}
        <span>{isSelf ? `${name} (you)` : name}</span>
        {role === 'admin' && <span className="mr-tile-prof">PROF</span>}
      </div>
    </div>
  )
}

export default function MeetingRoom({ meeting, self, onClose, onEndClass }) {
  const { db: dbRef } = useData()
  const db = dbRef?.current || null
  const {
    phase, errorMsg, peers, localStream, micOn, camOn, sharing, canShare,
    toggleMic, toggleCam, startShare, stopShare, leave,
  } = useMeetingRoom({ db, roomId: meeting?.id, self })

  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const ended = meeting?.status === 'ended' || !meeting
  // When the professor ends the class, everyone's engine tears down and the
  // overlay announces it briefly before closing itself.
  useEffect(() => {
    if (!ended) return
    leave()
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [ended]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleLeave() {
    leave()
    onClose()
  }

  async function handleEnd() {
    if (!onEndClass || ending) return
    setEnding(true)
    try { await onEndClass() } finally { setEnding(false) }
  }

  const featuredPeer = useMemo(() => peers.find(p => p.sharing), [peers])
  const isAdmin = self?.role === 'admin'
  const count = peers.length + 1

  const body = (
    <div className="mr-overlay" role="dialog" aria-label="Live class room">
      <div className="mr-head">
        <div className="mr-head-t">
          <span className="mr-live"><Radio size={13} /> LIVE · {fmtElapsed(now - (meeting?.scheduledAt || now))}</span>
          <div className="mr-head-title">
            <b>{meeting?.title || 'Live class'}</b>
            <span>{meeting?.className}{meeting?.subject ? ` · ${meeting.subject}` : ''}</span>
          </div>
        </div>
        <div className="mr-head-actions">
          <span className="mr-count"><Users size={14} /> {count} / {ROOM_CAP}</span>
          {isAdmin && (
            <button className="btn btn-sm mr-end-btn" onClick={handleEnd} disabled={ending} title="End the class for everyone">
              <PhoneOff size={13} style={{ marginRight: 5 }} /> {ending ? 'Ending…' : 'End class'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm mr-leave-link" onClick={handleLeave}>Leave</button>
        </div>
      </div>

      {ended ? (
        <div className="mr-center">
          <CheckCircle size={34} style={{ color: 'var(--green, #22c55e)' }} />
          <b>Class ended</b>
          <span>Thanks for attending.</span>
        </div>
      ) : phase === 'connecting' ? (
        <div className="mr-center">
          <Loader2 size={30} className="animate-spin" />
          <b>Joining the room…</b>
          <span>Your browser will ask for camera and microphone access.</span>
        </div>
      ) : phase === 'error' ? (
        <div className="mr-center">
          <AlertTriangle size={30} style={{ color: 'var(--gold-var, #ca8a04)' }} />
          <b>Could not join</b>
          <span>{errorMsg}</span>
          <button className="btn btn-sm" onClick={handleLeave}>Close</button>
        </div>
      ) : phase === 'full' ? (
        <div className="mr-center">
          <Users size={30} style={{ color: 'var(--gold-var, #ca8a04)' }} />
          <b>The room is full</b>
          <span>In-app rooms hold up to {ROOM_CAP} people. Ask your professor to use a Meet link for bigger sessions.</span>
          <button className="btn btn-sm" onClick={handleLeave}>Close</button>
        </div>
      ) : (
        <>
          <div className="mr-grid">
            {featuredPeer && (
              <VideoTile
                key={`f-${featuredPeer.peerId}`}
                stream={featuredPeer.stream}
                name={featuredPeer.name}
                role={featuredPeer.role}
                micOn={featuredPeer.micOn}
                camOn
                sharing
                featured
                muted={false}
                failed={featuredPeer.connState === 'failed'}
              />
            )}
            <VideoTile
              stream={localStream}
              name={self?.name || 'You'}
              role={self?.role}
              micOn={micOn}
              camOn={camOn}
              mirrored={!sharing}
              muted
              isSelf
              sharing={sharing}
            />
            {peers.filter(p => p !== featuredPeer).map(p => (
              <VideoTile
                key={p.peerId}
                stream={p.stream}
                name={p.name}
                role={p.role}
                micOn={p.micOn}
                camOn={p.camOn}
                muted={false}
                failed={p.connState === 'failed'}
              />
            ))}
          </div>

          <div className="mr-controls">
            <button className={`mr-ctl${micOn ? '' : ' mr-ctl-off'}`} onClick={toggleMic} title={micOn ? 'Mute microphone' : 'Unmute microphone'}>
              {micOn ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
            <button className={`mr-ctl${camOn ? '' : ' mr-ctl-off'}`} onClick={toggleCam} title={camOn ? 'Turn camera off' : 'Turn camera on'}>
              {camOn ? <Video size={18} /> : <VideoOff size={18} />}
            </button>
            {canShare && (
              <button className={`mr-ctl${sharing ? ' mr-ctl-on' : ''}`} onClick={sharing ? stopShare : startShare} title={sharing ? 'Stop presenting' : 'Present your screen'}>
                <MonitorUp size={18} />
              </button>
            )}
            <button className="mr-ctl mr-ctl-hang" onClick={handleLeave} title="Leave the class">
              <PhoneOff size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  )

  return createPortal(body, document.body)
}
