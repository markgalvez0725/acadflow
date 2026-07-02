import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Radio,
  Users, AlertTriangle, Loader2, CheckCircle,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import useMeetingRoom from '@/hooks/useMeetingRoom'
import { ROOM_CAP } from '@/firebase/rtc'

// Full-screen in-app classroom shared by the professor and student tabs,
// laid out Google Meet style: a centered stage of size-capped 16:9 tiles (no
// screen-filling cameras), a floating self-view PiP bottom-right, and one
// bottom bar (clock + class info | round controls | count + End class).
// When someone presents, their screen becomes the stage and everyone drops
// into a small filmstrip. The call engine lives in useMeetingRoom; this file
// is layout only.
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

function VideoTile({
  stream, name, role, micOn, camOn, muted, failed,
  isSelf, presenting, presentLabel, noVideo, noHint, className,
}) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  const showVideo = !noVideo && !!stream && camOn !== false
  return (
    <div className={`mr-tile${presenting ? ' mr-tile-presenting' : ''}${className ? ` ${className}` : ''}`}>
      {/* Keep the <video> mounted even when the camera is off - it still
          carries the audio. noVideo tiles (filmstrip copy of the presenter)
          skip it entirely so a peer's audio never plays twice. */}
      {!noVideo && (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className="mr-video"
          style={{ visibility: showVideo ? 'visible' : 'hidden' }}
        />
      )}
      {!showVideo && (
        <div className="mr-tile-avatar">
          <span className="mr-avatar-circle">{initials(name)}</span>
          {!noHint && !stream && !isSelf && !failed && <span className="mr-tile-hint">connecting…</span>}
          {!noHint && failed && <span className="mr-tile-hint mr-tile-bad"><AlertTriangle size={12} /> could not connect</span>}
        </div>
      )}
      <div className="mr-tile-name">
        <span>{presentLabel || (isSelf ? `${name} (you)` : name)}</span>
      </div>
      {role === 'admin' && <span className="mr-tile-prof">PROF</span>}
      {micOn === false && <span className="mr-mic-off"><MicOff size={13} /></span>}
    </div>
  )
}

export default function MeetingRoom({ meeting, self, onClose, onEndClass }) {
  const { db: dbRef } = useData()
  const db = dbRef?.current || null
  const {
    phase, errorMsg, peers, localStream, micOn, camOn, sharing, canShare,
    toggleMic, toggleCam, startShare, stopShare, leave, retry,
  } = useMeetingRoom({ db, roomId: meeting?.id, self })

  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  const pipRef = useRef(null)
  useEffect(() => {
    if (pipRef.current && pipRef.current.srcObject !== localStream) pipRef.current.srcObject = localStream || null
  }, [localStream, phase, sharing, camOn])

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

  // Feature the LATEST presenter when more than one person shares at once.
  const featuredPeer = useMemo(() => {
    const sharers = peers.filter(p => p.sharing)
    if (!sharers.length) return null
    return sharers.sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0))[0]
  }, [peers])

  const isAdmin = self?.role === 'admin'
  const ready = phase === 'ready' && !ended
  const count = peers.length + 1
  const timeStr = new Date(now).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  const body = (
    <div className="mr-overlay" role="dialog" aria-label="Live class room">
      <div className="mr-stage-wrap">
        {ended ? (
          <div className="mr-center">
            <CheckCircle size={34} style={{ color: '#81c995' }} />
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
            <AlertTriangle size={30} style={{ color: '#fdd663' }} />
            <b>Could not join</b>
            <span>{errorMsg}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm mr-retry-btn" onClick={retry}>Try again</button>
              <button className="btn btn-sm" onClick={handleLeave}>Close</button>
            </div>
          </div>
        ) : phase === 'full' ? (
          <div className="mr-center">
            <Users size={30} style={{ color: '#fdd663' }} />
            <b>The room is full</b>
            <span>In-app rooms hold up to {ROOM_CAP} people. Ask your professor to use a Meet link for bigger sessions.</span>
            <button className="btn btn-sm" onClick={handleLeave}>Close</button>
          </div>
        ) : featuredPeer ? (
          <>
            <div className="mr-present">
              <VideoTile
                key={`present-${featuredPeer.peerId}`}
                stream={featuredPeer.stream}
                name={featuredPeer.name}
                presentLabel={`${featuredPeer.name} is presenting`}
                camOn
                muted={false}
                failed={featuredPeer.connState === 'failed'}
              />
            </div>
            <div className="mr-strip">
              {peers.map(p => (
                <VideoTile
                  key={p.peerId}
                  stream={p === featuredPeer ? null : p.stream}
                  noVideo={p === featuredPeer}
                  noHint={p === featuredPeer}
                  presenting={p === featuredPeer}
                  name={p.name}
                  role={p.role}
                  micOn={p.micOn}
                  camOn={p.camOn}
                  muted={false}
                  failed={p.connState === 'failed'}
                />
              ))}
            </div>
          </>
        ) : peers.length ? (
          <div className="mr-stage">
            {peers.map(p => (
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
        ) : (
          <div className="mr-center">
            <Users size={30} style={{ color: '#9aa0a6' }} />
            <b>You're the only one here</b>
            <span>Waiting for others to join. Enrolled students see a Join button on their Online Classes tab.</span>
          </div>
        )}

        {/* Floating self-view: your camera never occupies a stage tile. */}
        {ready && (
          <div className="mr-pip">
            {sharing ? (
              <div className="mr-pip-present">
                <MonitorUp size={16} />
                <span>You're presenting</span>
              </div>
            ) : (
              <>
                <video
                  ref={pipRef}
                  autoPlay
                  playsInline
                  muted
                  className="mr-video"
                  style={{ transform: 'scaleX(-1)', visibility: camOn && localStream ? 'visible' : 'hidden' }}
                />
                {(!camOn || !localStream) && (
                  <div className="mr-tile-avatar">
                    <span className="mr-avatar-circle mr-avatar-sm">{initials(self?.name)}</span>
                  </div>
                )}
              </>
            )}
            <span className="mr-pip-label">You</span>
            {!micOn && <span className="mr-mic-off"><MicOff size={12} /></span>}
          </div>
        )}
      </div>

      <div className="mr-bar">
        <div className="mr-bar-left">
          <span className="mr-clock">{timeStr}</span>
          <span className="mr-sep">|</span>
          <span className="mr-meta">{meeting?.title || 'Live class'}{meeting?.subject ? ` · ${meeting.subject}` : ''}</span>
          {!ended && (
            <span className="mr-live-chip"><Radio size={11} /> {fmtElapsed(now - (meeting?.scheduledAt || now))}</span>
          )}
        </div>
        <div className="mr-bar-ctls">
          {ready && (
            <>
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
            </>
          )}
          <button className="mr-hang" onClick={handleLeave} title="Leave the class">
            <PhoneOff size={18} />
          </button>
        </div>
        <div className="mr-bar-right">
          <span className="mr-count"><Users size={14} /> {count}/{ROOM_CAP}</span>
          {isAdmin && !ended && (
            <button className="mr-endclass" onClick={handleEnd} disabled={ending} title="End the class for everyone">
              {ending ? 'Ending…' : 'End class'}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
