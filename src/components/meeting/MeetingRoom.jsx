import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Radio,
  Users, AlertTriangle, Loader2, CheckCircle, Minimize2, Maximize2,
  PictureInPicture2,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import useMeetingRoom from '@/hooks/useMeetingRoom'
import { ROOM_CAP } from '@/firebase/rtc'

// Full-screen in-app classroom shared by the professor and student tabs,
// laid out Google Meet style: a centered stage of size-capped 16:9 tiles (no
// screen-filling cameras), a floating self-view PiP bottom-right, and one
// bottom bar (clock + class info | round controls | count + End class).
// When someone presents, their screen becomes the stage and everyone drops
// into a small filmstrip. The call engine lives in useMeetingRoom.
//
// Persistence: this component is mounted by MeetingHost at the LAYOUT level,
// so the call survives tab navigation. `minimized` swaps the full room for a
// floating mini player (same mount, engine keeps running; hidden audio sinks
// keep every remote voice playing). A pop-out button (and a best-effort
// attempt when the browser tab is hidden) puts the class in the OS
// picture-in-picture window that stays on top across alt-tab.
//   meeting    - the live onlineMeetings doc (fresh object each render)
//   self       - { uid, name, role: 'admin' | 'student' }
//   minimized  - render as the floating mini player
//   onMinimize - (bool) toggle mini player mode
//   onClose    - always called when the user is out of the room
//   onEndClass - professor only: ends the meeting for everyone

function fmtElapsed(ms) {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just started'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} m`
}

// Best 16:9 tile width so `n` tiles fit a w x h stage with NO scrolling,
// capped so a near-empty room never turns into a wall-sized camera.
const TILE_GAP = 10
const TILE_MAX_W = 420
const TILE_MIN_W = 110
function fitTiles(w, h, n) {
  let best = null
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const availW = (w - TILE_GAP * (cols - 1)) / cols
    const availH = (h - TILE_GAP * (rows - 1)) / rows
    const tw = Math.min(availW, availH * (16 / 9), TILE_MAX_W)
    if (!best || tw > best) best = tw
  }
  return Math.max(1, Math.floor(best || Math.min(w, TILE_MAX_W)))
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
          skip it entirely so a peer's audio never plays twice. data-rv marks
          remote videos as pop-out (picture-in-picture) candidates. */}
      {!noVideo && (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          data-rv={muted ? undefined : '1'}
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

// Invisible element that keeps a remote peer's AUDIO playing while the room
// is minimized (the mini player shows at most one muted video).
function AudioSink({ stream }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  return <audio ref={ref} autoPlay />
}

function MiniVideo({ stream, onClick }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted data-rv="1" className="mr-video" onClick={onClick} />
}

export default function MeetingRoom({ meeting, self, minimized, onMinimize, onClose, onEndClass }) {
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

  const rootRef = useRef(null)
  const pipRef = useRef(null)

  // Measure the stage so tiles are COMPUTED to fit - the room never scrolls.
  const [stageEl, setStageEl] = useState(null)
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!stageEl || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect
      if (r) setStageBox({ w: r.width, h: r.height })
    })
    ro.observe(stageEl)
    return () => ro.disconnect()
  }, [stageEl])

  // The page behind the room must not scroll either.
  useEffect(() => {
    if (minimized) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [minimized])
  useEffect(() => {
    if (pipRef.current && pipRef.current.srcObject !== localStream) pipRef.current.srcObject = localStream || null
  }, [localStream, phase, sharing, camOn, minimized])

  const ended = meeting?.status === 'ended' || !meeting
  // When the professor ends the class, everyone's engine tears down and the
  // overlay announces it briefly before closing itself.
  useEffect(() => {
    if (!ended) return
    leave()
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [ended]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = phase === 'ready' && !ended
  const canPip = typeof document !== 'undefined' && !!document.pictureInPictureEnabled

  function popOut() {
    const v = rootRef.current?.querySelector('video[data-rv]')
    if (v) v.requestPictureInPicture().catch(() => { /* needs a fresh gesture or unsupported */ })
  }

  // Alt-tab away: try to pop the class into the always-on-top PiP window.
  // Browsers that require a user gesture reject silently - the manual pop-out
  // button is the guaranteed path there.
  useEffect(() => {
    if (!ready) return
    function onVis() {
      if (document.visibilityState !== 'hidden') return
      if (document.pictureInPictureElement) return
      popOut()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [ready])

  // Leaving the room closes any pop-out window we created.
  useEffect(() => () => {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => { /* noop */ })
  }, [])

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
  const count = peers.length + 1
  const timeStr = new Date(now).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  // Stage layout: how many tiles fit without scrolling, and how wide. When a
  // room is too crowded, the tail collapses into one "+K others" tile (their
  // audio keeps playing through hidden sinks).
  const { stagePeers, hiddenPeers, tileW } = useMemo(() => {
    const n = peers.length
    if (!n) return { stagePeers: [], hiddenPeers: [], tileW: 320 }
    if (!stageBox.w || !stageBox.h) return { stagePeers: peers, hiddenPeers: [], tileW: 320 }
    let shown = n
    let w = fitTiles(stageBox.w, stageBox.h, n)
    while (shown > 1 && w < TILE_MIN_W) {
      shown -= 1
      w = fitTiles(stageBox.w, stageBox.h, shown + 1) // +1 = the "+K others" tile
    }
    return { stagePeers: peers.slice(0, shown), hiddenPeers: peers.slice(shown), tileW: w }
  }, [peers, stageBox])

  // Filmstrip (presenting): presenter + up to 7 more; the rest roll into a
  // "+K" chip so the strip never scrolls either.
  const STRIP_MAX = 8
  const { stripPeers, stripHidden } = useMemo(() => {
    if (!featuredPeer) return { stripPeers: [], stripHidden: [] }
    const others = peers.filter(p => p !== featuredPeer)
    const shown = [featuredPeer, ...others.slice(0, STRIP_MAX - 1)]
    return { stripPeers: shown, stripHidden: others.slice(STRIP_MAX - 1) }
  }, [peers, featuredPeer])

  // ── Mini player (minimized) ─────────────────────────────────────────────
  if (minimized) {
    const focus = featuredPeer || peers.find(p => p.stream && p.camOn !== false) || peers.find(p => p.stream) || null
    const statusText = ended ? 'Class ended'
      : phase === 'connecting' ? 'Joining…'
      : phase === 'error' ? 'Could not join'
      : phase === 'full' ? 'Room is full'
      : null
    const expand = () => onMinimize?.(false)
    const mini = (
      <div className="mr-mini" ref={rootRef} role="dialog" aria-label="Live class mini player">
        <div className="mr-mini-video" onClick={expand} title="Expand the class">
          {ready && focus?.stream ? (
            <MiniVideo stream={focus.stream} />
          ) : (
            <div className="mr-mini-empty">
              {statusText
                ? <span>{statusText}</span>
                : <><span className="mr-avatar-circle mr-avatar-sm">{initials(focus?.name || self?.name)}</span><span>{focus ? focus.name : 'Waiting for others…'}</span></>}
            </div>
          )}
          {!ended && <span className="mr-mini-live"><Radio size={10} /> LIVE</span>}
          {featuredPeer && ready && <span className="mr-mini-tag"><MonitorUp size={10} /> {featuredPeer.name}</span>}
        </div>
        <div className="mr-mini-foot">
          <div className="mr-mini-info">
            <b title={meeting?.title || 'Live class'}>{meeting?.title || 'Live class'}</b>
            <span>{ready ? `${count} in class` : (statusText || '')}</span>
          </div>
          {ready && (
            <button className={`mr-mini-btn${micOn ? '' : ' mr-mini-btn-off'}`} onClick={toggleMic} title={micOn ? 'Mute microphone' : 'Unmute microphone'}>
              {micOn ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
          )}
          <button className="mr-mini-btn" onClick={expand} title="Expand the class">
            <Maximize2 size={14} />
          </button>
          <button className="mr-mini-btn mr-mini-btn-hang" onClick={handleLeave} title="Leave the class">
            <PhoneOff size={14} />
          </button>
        </div>
        {/* Hidden audio sinks: every remote voice keeps playing while minimized. */}
        <div style={{ display: 'none' }}>
          {peers.map(p => p.stream ? <AudioSink key={p.peerId} stream={p.stream} /> : null)}
        </div>
      </div>
    )
    return createPortal(mini, document.body)
  }

  // ── Full room ───────────────────────────────────────────────────────────
  const body = (
    <div className="mr-overlay" ref={rootRef} role="dialog" aria-label="Live class room">
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
            <span>In-app rooms hold up to {ROOM_CAP} people including the professor. Try again once someone leaves.</span>
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
              {stripPeers.map(p => (
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
              {stripHidden.length > 0 && (
                <div className="mr-tile mr-tile-more">
                  <div className="mr-tile-avatar">
                    <span className="mr-more-count">+{stripHidden.length}</span>
                  </div>
                </div>
              )}
            </div>
            {/* Off-strip voices keep playing. */}
            <div style={{ display: 'none' }}>
              {stripHidden.map(p => p.stream ? <AudioSink key={p.peerId} stream={p.stream} /> : null)}
            </div>
          </>
        ) : peers.length ? (
          <>
            <div className="mr-stage" ref={setStageEl}>
              {stagePeers.map(p => (
                <div key={p.peerId} style={{ width: tileW }}>
                  <VideoTile
                    stream={p.stream}
                    name={p.name}
                    role={p.role}
                    micOn={p.micOn}
                    camOn={p.camOn}
                    muted={false}
                    failed={p.connState === 'failed'}
                  />
                </div>
              ))}
              {hiddenPeers.length > 0 && (
                <div className="mr-tile mr-tile-more" style={{ width: tileW }}>
                  <div className="mr-tile-avatar">
                    <span className="mr-more-count">+{hiddenPeers.length}</span>
                    <span className="mr-tile-hint">others in class</span>
                  </div>
                </div>
              )}
            </div>
            {/* Off-stage voices keep playing. */}
            <div style={{ display: 'none' }}>
              {hiddenPeers.map(p => p.stream ? <AudioSink key={p.peerId} stream={p.stream} /> : null)}
            </div>
          </>
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
          {ready && canPip && (
            <button className="mr-ctl mr-ctl-sm" onClick={popOut} title="Pop out a floating player (stays on top when you switch apps)">
              <PictureInPicture2 size={16} />
            </button>
          )}
          {ready && (
            <button className="mr-ctl mr-ctl-sm" onClick={() => onMinimize?.(true)} title="Minimize - the class keeps running while you use AcadFlow">
              <Minimize2 size={16} />
            </button>
          )}
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
