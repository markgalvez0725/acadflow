import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Radio,
  Users, AlertTriangle, Loader2, CheckCircle, Minimize2, Maximize2,
  PictureInPicture2, CircleDot, Square,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import useMeetingRoom from '@/hooks/useMeetingRoom'
import { ROOM_CAP } from '@/firebase/rtc'
import { recordingSupported, createMeetingRecorder } from '@/utils/meetingRecorder'
import { isConfigured as driveConfigured, getConnection as driveConnection, connect as driveConnect, startResumableUpload } from '@/utils/googleDrive'
import { detectAudioShield } from '@/utils/audioShield'
import { createPipSource } from '@/utils/meetingPip'

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

// One avatar for every cam-off surface: the real profile photo when the
// person has one, initials otherwise.
function AvatarCircle({ photo, name, small }) {
  return (
    <span className={`mr-avatar-circle${small ? ' mr-avatar-sm' : ''}${photo ? ' mr-avatar-photo' : ''}`}>
      {photo ? <img src={photo} alt="" /> : initials(name)}
    </span>
  )
}

// Watch a <video> element's real frame shape (0 until metadata arrives; the
// 'resize' event fires again when a phone rotates mid-call).
function useVideoRatio(ref, stream) {
  const [ratio, setRatio] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const meas = () => { if (el.videoWidth && el.videoHeight) setRatio(el.videoWidth / el.videoHeight) }
    meas()
    el.addEventListener('loadedmetadata', meas)
    el.addEventListener('resize', meas)
    return () => {
      el.removeEventListener('loadedmetadata', meas)
      el.removeEventListener('resize', meas)
    }
  }, [ref, stream])
  return ratio
}

function VideoTile({
  stream, name, role, micOn, camOn, muted, failed, photo,
  isSelf, presenting, presentLabel, noVideo, noHint, className,
}) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  const showVideo = !noVideo && !!stream && camOn !== false
  // Tiles take the sender's REAL frame shape: a phone camera gets a portrait
  // tile (its whole frame visible) instead of being crop-zoomed into 16:9.
  // Landscape devices keep the classic 16:9 tile.
  const ratio = useVideoRatio(ref, stream)
  const portrait = showVideo && ratio > 0 && ratio < 1
  return (
    <div
      className={`mr-tile${presenting ? ' mr-tile-presenting' : ''}${className ? ` ${className}` : ''}`}
      style={portrait ? { aspectRatio: String(Math.max(ratio, 9 / 16)) } : undefined}
    >
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
          <AvatarCircle photo={photo} name={name} />
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
  // The mini player keeps its 16:9 card; a portrait feed letterboxes inside
  // it instead of being crop-zoomed.
  const ratio = useVideoRatio(ref, stream)
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      data-rv="1"
      className="mr-video"
      style={ratio > 0 && ratio < 1 ? { objectFit: 'contain' } : undefined}
      onClick={onClick}
    />
  )
}

export default function MeetingRoom({ meeting, self, minimized, onMinimize, onClose, onEndClass }) {
  const { db: dbRef, saveMeetingRecording, students, admin } = useData()
  const { toast } = useUI()
  const db = dbRef?.current || null
  const {
    phase, errorMsg, peers, localStream, micOn, camOn, sharing, canShare,
    screenStream, setRecordingFlag,
    toggleMic, toggleCam, startShare, stopShare, leave, retry,
  } = useMeetingRoom({ db, roomId: meeting?.id, self })

  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  // Brave's fingerprint shield ("farbling") measurably corrupts Web Audio
  // data: the recording mix comes out with voices skewed quiet or missing,
  // and the transcriber hears degraded samples. Page code cannot bypass it,
  // so when it is DETECTED (a written buffer reads back altered) the room
  // shows the one-time per-site fix. Recording re-warns via toast each time.
  const [shieldWarn, setShieldWarn] = useState(false) // false | 'brave' | 'generic'
  useEffect(() => {
    let dead = false
    detectAudioShield().then(({ brave, farbled }) => {
      if (dead || !farbled) return
      try { if (localStorage.getItem('acadflow_shield_warn') === '1') return } catch { /* still show it */ }
      setShieldWarn(brave ? 'brave' : 'generic')
    })
    return () => { dead = true }
  }, [])
  function dismissShieldWarn() {
    setShieldWarn(false)
    try { localStorage.setItem('acadflow_shield_warn', '1') } catch { /* session only */ }
  }

  const rootRef = useRef(null)
  const pipRef = useRef(null)
  const pipSrcRef = useRef(null)

  // Resolve every participant's profile photo locally from the roster
  // (professor = portal/admin photo, students by id). Photos are NEVER
  // written into the rtcRooms participant docs - a data-URL photo would ride
  // along with every heartbeat snapshot.
  const photoFor = useMemo(() => {
    const byId = new Map((students || []).map(s => [s.id, s.photo || null]))
    return p => (p ? (p.role === 'admin' ? admin?.photo || null : byId.get(p.uid) || null) : null)
  }, [students, admin?.photo])

  // Own camera frame shape, read off the capture track (the self-view element
  // unmounts across minimize/share, so the element itself can't be watched).
  // Phones report portrait dimensions; rotation re-sizes the track.
  const [selfRatio, setSelfRatio] = useState(0)
  useEffect(() => {
    function meas() {
      const t = localStream && localStream.getVideoTracks ? localStream.getVideoTracks()[0] : null
      const s = t && t.getSettings ? t.getSettings() : null
      setSelfRatio(s && s.width && s.height ? s.width / s.height : 0)
    }
    meas()
    const late = setTimeout(meas, 1200) // some browsers fill settings a beat late
    const onTurn = () => setTimeout(meas, 600) // dimensions swap after rotation
    window.addEventListener('orientationchange', onTurn)
    return () => {
      clearTimeout(late)
      window.removeEventListener('orientationchange', onTurn)
    }
  }, [localStream])

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

  // ── Recording (professor only): 720p compositor streaming into Drive ────
  const [recState, setRecState] = useState('idle') // idle | starting | on | saving
  const recRef = useRef(null) // { recorder, uploader, meeting, startAt }
  const isAdmin = self?.role === 'admin'

  async function startRecording() {
    if (recState !== 'idle' || !meeting || recRef.current) return
    if (!recordingSupported()) { toast('Recording is not supported in this browser.', 'error'); return }
    if (!driveConfigured()) { toast('Google Drive is not configured for this deployment.', 'error'); return }
    setRecState('starting')
    try {
      if (!driveConnection().connected) await driveConnect() // one-time consent popup
      const dt = new Date()
      const stamp = `${dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })} ${dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`
      // The recorder picks the container at creation (MP4/H.264 where the
      // browser can, WebM otherwise) - the Drive file name and MIME follow it.
      let uploader = null
      const recorder = createMeetingRecorder({
        onChunk: blob => { if (uploader) uploader.append(blob) },
        onError: () => { toast('Recording hit an error and was stopped.', 'error'); stopRecording(true) },
      })
      // Keep letters/numbers/space/dot/dash/parens; everything else (slashes,
      // colons, quotes...) becomes '-' so the Drive filename is always safe.
      const fname = `${meeting.className || 'Class'} - ${meeting.title || 'Online class'} - ${stamp}.${recorder.fileExt}`
        .replace(/[^\p{L}\p{N} ().-]/gu, '-')
      uploader = startResumableUpload({
        name: fname,
        mimeType: recorder.fileMime,
        folderPath: [meeting.className || 'General', 'Recordings'],
      })
      recorder.start()
      recRef.current = { recorder, uploader, meeting, startAt: Date.now() }
      // Persist the Drive pointer the moment the file exists (long before the
      // class ends): even if this tab dies mid-class, the past-session row
      // still shows the recording and the status poller resolves it later.
      uploader.ready.then(info => {
        if (recRef.current && recRef.current.uploader === uploader) {
          saveMeetingRecording(meeting, { ...info, at: Date.now(), status: 'processing' })
        }
      })
      setRecState('on')
      setRecordingFlag(true)
      toast('Recording - it streams into your Google Drive as the class runs.', 'success')
      detectAudioShield().then(({ brave, farbled }) => {
        if (!farbled) return
        toast(
          brave
            ? 'Brave Shields is distorting the recorded audio. Turn "Block fingerprinting" off for this site (lion icon), reload, then record.'
            : 'This browser\'s fingerprint protection is distorting the recorded audio. Allow this site in your privacy settings, then reload.',
          'error', 9000,
        )
      })
    } catch (e) {
      setRecState('idle')
      toast(e?.message || 'Could not start the recording.', 'error')
    }
  }

  async function stopRecording(silent) {
    const rec = recRef.current
    if (!rec) return
    recRef.current = null
    setRecState('saving')
    setRecordingFlag(false)
    try {
      await rec.recorder.stop() // resolves after the final chunk is handed over
      const out = await rec.uploader.finish()
      // Saved as 'processing': Drive still has to process the video before it
      // can be previewed. The MeetingHost poller flips it to 'ready' and only
      // THEN notifies the professor - never a "ready" ping for a file that
      // does not play yet.
      await saveMeetingRecording(rec.meeting, {
        link: out.link,
        driveId: out.driveId,
        bytes: out.bytes,
        durationMin: Math.max(1, Math.round((Date.now() - rec.startAt) / 60000)),
        at: Date.now(),
        status: 'processing',
      })
      if (!silent) toast('Recording saved. Drive is processing the video - you will get a notification when it is ready to view.', 'success')
    } catch (e) {
      if (!silent) toast('The recording upload failed. Check your Drive connection.', 'error')
    } finally {
      setRecState('idle')
    }
  }

  // Feed the compositor the current scene (presenter > tile grid) and the
  // audio mix (everyone + own mic) whenever the room changes.
  const featuredPeerForRec = peers.find(p => p.sharing) || null
  useEffect(() => {
    const rec = recRef.current
    if (!rec || recState !== 'on') return
    const featured = featuredPeerForRec?.stream
      ? { stream: featuredPeerForRec.stream, label: `${featuredPeerForRec.name} is presenting` }
      : (sharing && screenStream)
        ? { stream: screenStream, label: `${self?.name || 'Professor'} is presenting` }
        : null
    rec.recorder.setScene({
      featured,
      tiles: [
        { key: 'self', stream: localStream, name: self?.name || 'You', camOn: camOn && !sharing },
        ...peers.map(p => ({ key: p.peerId, stream: p.stream, name: p.name, camOn: p.camOn !== false && !p.sharing })),
      ],
      audioStreams: [localStream, ...peers.map(p => p.stream)].filter(Boolean),
    })
  }, [recState, peers, localStream, screenStream, sharing, camOn, featuredPeerForRec, self])

  // Never leak a recorder: finalize on unmount (logout, hard close).
  useEffect(() => () => { stopRecording(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ended = meeting?.status === 'ended' || !meeting
  // When the professor ends the class, everyone's engine tears down and the
  // overlay announces it briefly before closing itself. The recording (if
  // any) finalizes FIRST so its tail isn't lost with the streams.
  useEffect(() => {
    if (!ended) return
    stopRecording(false)
    leave()
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [ended]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = phase === 'ready' && !ended
  const canPip = typeof document !== 'undefined' && !!document.pictureInPictureEnabled

  function popOut() {
    // Project the compositor - it always shows the room's current scene
    // (video OR avatar card), never the black frame a cam-off remote video
    // produces. Raw remote video only as a last-ditch fallback.
    const src = pipSrcRef.current
    const v = src && src.video.readyState >= 1 ? src.video : rootRef.current?.querySelector('video[data-rv]')
    if (v && v.requestPictureInPicture) {
      v.requestPictureInPicture().catch(() => { /* needs a fresh gesture or unsupported */ })
    }
  }

  // The pop-out source lives on document.body (it must survive the swap
  // between the full room and the mini player) for as long as the call is up.
  useEffect(() => {
    if (!ready || !canPip) return
    const src = createPipSource()
    if (!src) return
    pipSrcRef.current = src
    document.body.appendChild(src.video)
    src.start()
    return () => {
      pipSrcRef.current = null
      if (document.pictureInPictureElement === src.video) {
        document.exitPictureInPicture().catch(() => { /* already gone */ })
      }
      src.destroy()
      src.video.remove()
    }
  }, [ready, canPip])

  // Alt-tab away: try to pop the class into the always-on-top PiP window.
  // Browsers that require a user gesture reject silently - the manual pop-out
  // button is the guaranteed path there.
  useEffect(() => {
    if (!ready || !canPip) return
    function onVis() {
      if (document.visibilityState !== 'hidden') return
      if (document.pictureInPictureElement) return
      popOut()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [ready, canPip]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // What the SMALL surfaces (mini player, pop-out) should show, mirroring the
  // stage: the presenter, else any live camera. When nobody has visible video
  // the featured FACE is the professor (or the first peer) as an avatar card,
  // never a black cam-off <video>.
  const focusPeer = featuredPeer || peers.find(p => p.stream && p.camOn !== false) || null
  const facePeer = focusPeer || peers.find(p => p.role === 'admin') || peers[0] || null

  const count = peers.length + 1

  // Keep the pop-out compositor fed with the current scene every render.
  useEffect(() => {
    const src = pipSrcRef.current
    if (!src) return
    src.setScene({
      stream: focusPeer?.stream || null,
      label: featuredPeer ? `${featuredPeer.name} is presenting`
        : facePeer ? facePeer.name
        : 'Waiting for others…',
      sub: `${count} in class`,
      photo: photoFor(facePeer || self),
      initials: initials((facePeer || self)?.name),
      live: !ended,
    })
  })
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
    const statusText = ended ? 'Class ended'
      : phase === 'connecting' ? 'Joining…'
      : phase === 'error' ? 'Could not join'
      : phase === 'full' ? 'Room is full'
      : null
    const expand = () => onMinimize?.(false)
    const mini = (
      <div className="mr-mini" ref={rootRef} role="dialog" aria-label="Live class mini player">
        <div className="mr-mini-video" onClick={expand} title="Expand the class">
          {ready && focusPeer?.stream ? (
            <MiniVideo stream={focusPeer.stream} />
          ) : (
            <div className="mr-mini-empty">
              {statusText
                ? <span>{statusText}</span>
                : <>
                    <AvatarCircle photo={photoFor(facePeer || self)} name={(facePeer || self)?.name} small />
                    <span>{facePeer ? facePeer.name : 'Waiting for others…'}</span>
                  </>}
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
        {shieldWarn && !ended && (
          <div className="mr-shield-warn" role="alert">
            <AlertTriangle size={15} />
            <span>
              {shieldWarn === 'brave'
                ? 'Brave Shields is altering meeting audio, so recordings can lose voices. Click the lion icon in the address bar, open Advanced controls, turn "Block fingerprinting" off for this site, then reload.'
                : 'This browser\'s fingerprint protection is altering meeting audio, so recordings can lose voices. Allow this site in your privacy settings, then reload.'}
            </span>
            <button onClick={dismissShieldWarn}>Got it</button>
          </div>
        )}
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
                photo={photoFor(featuredPeer)}
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
                  photo={photoFor(p)}
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
              {/* Cells share the ROW HEIGHT; each tile's width follows its own
                  aspect (16:9 laptops, portrait phones), so mixed devices sit
                  side by side without cropping anyone. */}
              {stagePeers.map(p => (
                <div key={p.peerId} className="mr-cell" style={{ height: Math.round(tileW * 9 / 16) }}>
                  <VideoTile
                    stream={p.stream}
                    name={p.name}
                    role={p.role}
                    photo={photoFor(p)}
                    micOn={p.micOn}
                    camOn={p.camOn}
                    muted={false}
                    failed={p.connState === 'failed'}
                  />
                </div>
              ))}
              {hiddenPeers.length > 0 && (
                <div className="mr-tile mr-tile-more" style={{ height: Math.round(tileW * 9 / 16), width: 'auto' }}>
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

        {/* Floating self-view: your camera never occupies a stage tile. On a
            phone the card itself goes portrait to match the camera frame. */}
        {ready && (
          <div
            className="mr-pip"
            style={!sharing && camOn && localStream && selfRatio > 0 && selfRatio < 1
              ? { width: 'auto', height: 150, aspectRatio: String(Math.max(selfRatio, 9 / 16)) }
              : undefined}
          >
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
                    <AvatarCircle photo={photoFor(self)} name={self?.name} small />
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
          {!ended && (recState === 'on' || peers.some(p => p.recording)) && (
            <span className="mr-rec-pill" title="This class is being recorded"><span className="mr-rec-dot" /> REC</span>
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
              {isAdmin && recordingSupported() && (
                <button
                  className={`mr-ctl${recState === 'on' ? ' mr-ctl-rec' : ''}`}
                  disabled={recState === 'starting' || recState === 'saving'}
                  onClick={recState === 'on' ? () => stopRecording(false) : startRecording}
                  title={recState === 'on' ? 'Stop recording' : recState === 'saving' ? 'Saving the recording to Drive…' : 'Record the class to your Google Drive (720p)'}
                >
                  {recState === 'saving' || recState === 'starting'
                    ? <Loader2 size={17} className="animate-spin" />
                    : recState === 'on' ? <Square size={16} /> : <CircleDot size={18} />}
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
