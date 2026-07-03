import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Radio,
  Users, AlertTriangle, Loader2, CheckCircle, Minimize2, Maximize2,
  PictureInPicture2, CircleDot, Square, Hand, Pin, PinOff, Volume2,
  MessageSquare, Smile, LogIn, LogOut, UserX,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import useMeetingRoom from '@/hooks/useMeetingRoom'
import { ROOM_CAP, rtcListenChat, rtcSendChat } from '@/firebase/rtc'
import { recordingSupported, createMeetingRecorder } from '@/utils/meetingRecorder'
import { isConfigured as driveConfigured, getConnection as driveConnection, connect as driveConnect, startResumableUpload } from '@/utils/googleDrive'
import { detectAudioShield } from '@/utils/audioShield'
import { createPipSource } from '@/utils/meetingPip'
import { playMeetingSound, preloadMeetingSounds } from '@/utils/meetingSounds'
import MeetingChat from '@/components/meeting/MeetingChat'
import MeetingPeople from '@/components/meeting/MeetingPeople'
import EmojiIcon from '@/components/primitives/EmojiIcon'

// Full-screen in-app classroom shared by the professor and student tabs,
// laid out Google Meet style: a stage the tile grid FILLS edge to edge
// (cells stretch, video covers; portrait phone feeds show sharp over a
// gradient backdrop instead of being crop-zoomed), one bottom bar, a floating
// self-view, an in-call chat panel, reactions, raise hand, and join/leave
// chimes. The call engine lives in useMeetingRoom.
//
// Persistence: this component is mounted by MeetingHost at the LAYOUT level,
// so the call survives tab navigation. `minimized` swaps the full room for a
// floating mini player (same mount, engine keeps running; hidden audio sinks
// keep every remote voice playing). The pop-out projects a small canvas
// compositor (utils/meetingPip.js) that always mirrors the scene; Chrome's
// auto picture-in-picture for capturing sites is wired via the Media Session
// 'enterpictureinpicture' action.
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

const TILE_GAP = 8
const TILE_MIN_W = 110
const MEET_REACTIONS = ['❤️', '👍', '🎉', '👏', '😂', '😮', '😢']

// Meet-style fill: pick the column count whose stretched cells give the
// video the most room (score = the 16:9 content width a cell can hold).
// Cells then FILL the stage - flex does the stretching, so a last row with
// fewer people simply gets wider tiles, exactly like Meet.
function planGrid(w, h, n) {
  let best = { cols: 1, content: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = (w - TILE_GAP * (cols - 1)) / cols
    const ch = (h - TILE_GAP * (rows - 1)) / rows
    const content = Math.min(cw, ch * (16 / 9))
    if (content > best.content) best = { cols, content }
  }
  return best
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += Math.max(1, size)) out.push(arr.slice(i, i + Math.max(1, size)))
  return out
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

function VideoTile({
  stream, name, role, micOn, camOn, muted, failed, photo, speaking,
  hand, onHandClick, onPin, pinned, peerId,
  quality, reconnecting, retryN, onMute, onRemove, onLongPress,
  isSelf, presenting, presentLabel, noVideo, noHint, className,
}) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  // Long press (phones have no hover): 500ms still-press opens the actions
  // sheet; any real movement or release cancels. Right-click maps to the
  // same sheet so desktops get it too.
  const lp = useRef({ t: null, x: 0, y: 0 })
  useEffect(() => () => clearTimeout(lp.current.t), [])
  function lpStart(e) {
    if (!onLongPress) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    clearTimeout(lp.current.t)
    lp.current.x = e.clientX
    lp.current.y = e.clientY
    lp.current.t = setTimeout(onLongPress, 500)
  }
  function lpMove(e) {
    if (!lp.current.t) return
    if (Math.abs(e.clientX - lp.current.x) > 12 || Math.abs(e.clientY - lp.current.y) > 12) clearTimeout(lp.current.t)
  }
  function lpEnd() { clearTimeout(lp.current.t) }
  const showVideo = !noVideo && !!stream && camOn !== false
  // EVERY video FITS its landscape tile: the whole frame renders contained
  // over the tile's static gradient backdrop. Portrait phones, 4:3 webcams,
  // and screen shares alike - nothing is ever crop-zoomed, and every tile
  // keeps the grid's uniform shape. (This backdrop used to be a live blurred
  // echo of the stream: a second video composited per tile per frame behind
  // a 22px GPU blur. The gradient costs nothing after first paint, which
  // weak student devices feel during a share.)
  return (
    <div
      className={
        'mr-tile'
        + (presenting ? ' mr-tile-presenting' : '')
        + (speaking && !presenting ? ' mr-tile-speaking' : '')
        + (hand ? ' mr-tile-hand' : '')
        + (className ? ` ${className}` : '')
      }
      data-peer={peerId || undefined}
      onPointerDown={onLongPress ? lpStart : undefined}
      onPointerMove={onLongPress ? lpMove : undefined}
      onPointerUp={onLongPress ? lpEnd : undefined}
      onPointerLeave={onLongPress ? lpEnd : undefined}
      onPointerCancel={onLongPress ? lpEnd : undefined}
      onContextMenu={onLongPress ? e => { e.preventDefault(); onLongPress() } : undefined}
    >
      {/* Keep the <video> mounted even when the camera is off - it still
          carries the audio. noVideo tiles (filmstrip copy of the presenter)
          skip it entirely so a peer's audio never plays twice. data-rv marks
          remote videos as pop-out fallbacks. */}
      {!noVideo && (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          data-rv={muted ? undefined : '1'}
          className="mr-video mr-video-fit"
          style={{ visibility: showVideo ? 'visible' : 'hidden' }}
        />
      )}
      {!showVideo && (
        <div className="mr-tile-avatar">
          <AvatarCircle photo={photo} name={name} />
          {!noHint && !stream && !isSelf && !failed && !reconnecting && <span className="mr-tile-hint">connecting…</span>}
          {!noHint && failed && !reconnecting && <span className="mr-tile-hint mr-tile-bad"><AlertTriangle size={12} /> could not connect</span>}
        </div>
      )}
      {reconnecting && !noHint && (
        <span className="mr-reconn">
          <Loader2 size={12} className="animate-spin" />
          Reconnecting{retryN > 0 ? ` · retry ${Math.min(retryN, 6)} of 6` : '…'}
        </span>
      )}
      {quality && !noHint && <span className={`mr-qdot mr-qdot-${quality} mr-qdot-tile`} title={quality === 'good' ? 'Connection is good' : quality === 'weak' ? 'Connection is a little weak' : 'Connection is struggling'} />}
      <div className="mr-tile-top">
        {role === 'admin' && <span className="mr-tile-prof">PROF</span>}
        {hand && (
          <button
            className="mr-hand-badge"
            onClick={onHandClick || undefined}
            disabled={!onHandClick}
            title={onHandClick ? 'Lower this hand' : 'Hand raised'}
          >
            <Hand size={13} />
          </button>
        )}
      </div>
      {(onPin || onMute || onRemove) && (
        <div className="mr-tile-acts">
          {onMute && (
            <button onClick={onMute} title="Mute this student">
              <MicOff size={14} />
            </button>
          )}
          {onRemove && (
            <button onClick={onRemove} className="mr-act-danger" title="Remove from class">
              <UserX size={14} />
            </button>
          )}
          {onPin && (
            <button onClick={onPin} title={pinned ? 'Unpin' : 'Pin to your screen'}>
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
        </div>
      )}
      <div className="mr-tile-name">
        {speaking && <Volume2 size={11} />}
        <span>{presentLabel || (isSelf ? `${name} (you)` : name)}</span>
      </div>
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
  // The mini player fits the whole frame too - never crop-zoomed.
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      data-rv="1"
      className="mr-video"
      style={{ objectFit: 'contain' }}
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
    screenStream, setRecordingFlag, setHand, lowerHand, sendReaction, setChatLock,
    toggleMic, toggleCam, startShare, stopShare, leave, retry,
    netDown, selfQuality, forcedMuteAt,
    muteStudent, muteAllStudents, removeStudent, getJoinLog,
  } = useMeetingRoom({ db, roomId: meeting?.id, self })

  const [ending, setEnding] = useState(false)
  // Host-control surfaces: the People panel, the long-press tile sheet, and
  // the remove confirmation (rendered inside the room - the app's dialog
  // portal would land under this overlay).
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [sheetPeer, setSheetPeer] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)

  // The professor muted this device - say so, and say the way back.
  useEffect(() => {
    if (forcedMuteAt) toast('The professor muted your microphone. Unmute when you need to speak.')
  }, [forcedMuteAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  // Brave's fingerprint shield ("farbling") measurably corrupts Web Audio
  // data: the recording mix comes out with voices skewed quiet or missing.
  // Page code cannot bypass it, so when it is DETECTED (a written buffer
  // reads back altered) the room shows the one-time per-site fix.
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
  const mainRef = useRef(null)
  const pipRef = useRef(null)
  const pipSrcRef = useRef(null)
  const isAdmin = self?.role === 'admin'

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

  // Measure the stage so the grid can decide how many tiles fit (the +K
  // overflow) - the room never scrolls.
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
  // audio mix (everyone + own mic) whenever the room changes. The recording
  // follows the TRUE presenter, never a local pin.
  const sharerPeer = useMemo(() => {
    const sharers = peers.filter(p => p.sharing)
    if (!sharers.length) return null
    return sharers.sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0))[0]
  }, [peers])
  useEffect(() => {
    const rec = recRef.current
    if (!rec || recState !== 'on') return
    const featured = sharerPeer?.stream
      ? { stream: sharerPeer.stream, label: `${sharerPeer.name} is presenting` }
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
  }, [recState, peers, localStream, screenStream, sharing, camOn, sharerPeer, self])

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
  // Registering the Media Session 'enterpictureinpicture' action is what
  // makes Chrome/Edge AUTO-pop the class out when the user switches tabs or
  // apps: pages capturing camera/microphone qualify for automatic
  // picture-in-picture once the handler exists (no gesture needed there).
  useEffect(() => {
    if (!ready || !canPip) return
    const src = createPipSource()
    if (!src) return
    pipSrcRef.current = src
    document.body.appendChild(src.video)
    src.start()
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
        const v = pipSrcRef.current?.video
        if (v && v.requestPictureInPicture) v.requestPictureInPicture().catch(() => { /* not allowed */ })
      })
    } catch { /* action unsupported in this browser */ }
    return () => {
      pipSrcRef.current = null
      try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null) } catch { /* noop */ }
      if (document.pictureInPictureElement === src.video) {
        document.exitPictureInPicture().catch(() => { /* already gone */ })
      }
      src.destroy()
      src.video.remove()
    }
  }, [ready, canPip])

  // Alt-tab fallback for browsers without auto-PiP: try on tab hide; engines
  // that require a fresh gesture reject silently - the manual pop-out button
  // is the guaranteed path there.
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
    playMeetingSound('leave')
    leave()
    onClose()
  }

  async function handleEnd() {
    if (!onEndClass || ending) return
    setEnding(true)
    // The join log rides along so the host can stamp it onto the meeting doc
    // and open the attendance sheet right after the room closes.
    try { await onEndClass(getJoinLog()) } finally { setEnding(false) }
  }

  // ── Pin (local spotlight), featured selection ───────────────────────────
  const [pinnedId, setPinnedId] = useState('')
  useEffect(() => {
    if (pinnedId && !peers.some(p => p.peerId === pinnedId)) setPinnedId('')
  }, [peers, pinnedId])
  const pinnedPeer = peers.find(p => p.peerId === pinnedId) || null
  const featuredPeer = pinnedPeer || sharerPeer
  const togglePin = p => setPinnedId(cur => (cur === p.peerId ? '' : p.peerId))

  // ── Raise hand ───────────────────────────────────────────────────────────
  const [myHand, setMyHand] = useState(false)
  useEffect(() => { if (!ready) setMyHand(false) }, [ready])
  function toggleHand() {
    const next = !myHand
    setMyHand(next)
    setHand(next)
    if (next) playMeetingSound('hand')
  }
  const hands = useMemo(() => peers.filter(p => p.hand).sort((a, b) => (a.hand || 0) - (b.hand || 0)), [peers])
  const handCount = hands.length + (myHand ? 1 : 0)
  const handTitle = [...hands.map(p => p.name), ...(myHand ? ['You'] : [])].join(', ')

  // ── Reactions ────────────────────────────────────────────────────────────
  const [reactOpen, setReactOpen] = useState(false)
  const [floats, setFloats] = useState([]) // { key, e, name, left, top }
  const floatSeq = useRef(0)
  function spawnFloat(anchorId, emoji, name) {
    const host = mainRef.current
    if (!host) return
    const hostRect = host.getBoundingClientRect()
    const el = host.querySelector(`[data-peer="${anchorId}"]`)
    let left = 24 + Math.random() * 60
    let top = hostRect.height - 140
    if (el) {
      const r = el.getBoundingClientRect()
      left = r.left - hostRect.left + r.width * (0.55 + Math.random() * 0.25)
      top = r.top - hostRect.top + r.height * 0.4
    }
    const key = ++floatSeq.current
    setFloats(f => [...f.slice(-11), { key, e: emoji, name, left, top }])
    setTimeout(() => setFloats(f => f.filter(x => x.key !== key)), 2600)
  }
  function react(emoji) {
    sendReaction(emoji)
    spawnFloat('self', emoji, 'You')
  }

  // ── In-room event snackbars (join / leave / hand) ────────────────────────
  const [snacks, setSnacks] = useState([]) // { id, kind, text, peerId }
  const snackSeq = useRef(0)
  function pushSnack(kind, text, peerId) {
    const id = ++snackSeq.current
    setSnacks(s => [...s.slice(-2), { id, kind, text, peerId }])
    setTimeout(() => setSnacks(s => s.filter(x => x.id !== id)), 4200)
  }
  function lowerFromSnack(snack) {
    lowerHand(snack.peerId)
    setSnacks(s => s.filter(x => x.id !== snack.id))
  }

  // ── Roster diff: chimes, snackbars, reaction floats ─────────────────────
  // The first publish after joining is the baseline (no chime storm for the
  // roster that was already there); my own arrival plays one join chime.
  const prevPeersRef = useRef(null)
  useEffect(() => {
    if (!ready) { prevPeersRef.current = null; return }
    const cur = new Map(peers.map(p => [p.peerId, p]))
    const prev = prevPeersRef.current
    prevPeersRef.current = cur
    if (!prev) {
      preloadMeetingSounds()
      playMeetingSound('join')
      return
    }
    for (const [id, p] of cur) {
      if (!prev.has(id)) {
        playMeetingSound('join')
        pushSnack('join', `${p.name} joined`)
        continue
      }
      const old = prev.get(id)
      if (p.hand && old.hand !== p.hand) {
        playMeetingSound('hand')
        pushSnack('hand', `${p.name} raised a hand`, p.peerId)
      }
      if (p.react?.at && old.react?.at !== p.react.at) {
        spawnFloat(p.peerId, p.react.e, p.name)
      }
    }
    for (const [id, p] of prev) {
      if (!cur.has(id)) {
        playMeetingSound('leave')
        pushSnack('leave', `${p.name} left`)
      }
    }
  }, [peers, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Speaking detection (purple ring) ─────────────────────────────────────
  // One shared AudioContext taps up to 24 audio streams; a 260ms sweep marks
  // whoever's waveform peaks above the floor. State updates only on change.
  const peersRef = useRef(peers); peersRef.current = peers
  const localRef = useRef(localStream); localRef.current = localStream
  const micOnRef = useRef(micOn); micOnRef.current = micOn
  const minimizedRef = useRef(minimized); minimizedRef.current = minimized
  const [speakSig, setSpeakSig] = useState('')
  useEffect(() => {
    if (!ready) { setSpeakSig(''); return }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    let ac
    try { ac = new AC() } catch { return }
    const taps = new Map() // key -> { src, an, buf, stream }
    function tapOf(key, stream) {
      let t = taps.get(key)
      if (t && t.stream === stream) return t
      if (t) { try { t.src.disconnect() } catch { /* gone */ } taps.delete(key) }
      if (!stream || !stream.getAudioTracks().length) return null
      try {
        const src = ac.createMediaStreamSource(stream)
        const an = ac.createAnalyser()
        an.fftSize = 512
        src.connect(an)
        t = { src, an, buf: new Uint8Array(an.fftSize), stream }
        taps.set(key, t)
        return t
      } catch { return null }
    }
    const iv = setInterval(() => {
      // No surface shows the speaking ring while the room is minimized or
      // the tab is hidden - skip the analyser sweep entirely (it is pure
      // battery on phones, and main-thread time everywhere else).
      if (minimizedRef.current || document.visibilityState === 'hidden') return
      if (ac.state === 'suspended') ac.resume().catch(() => { /* stays quiet */ })
      const speaking = []
      const seen = new Set()
      const consider = [
        { key: 'self', stream: localRef.current, on: micOnRef.current },
        ...peersRef.current.slice(0, 24).map(p => ({ key: p.peerId, stream: p.stream, on: p.micOn !== false })),
      ]
      for (const c of consider) {
        seen.add(c.key)
        if (!c.on) continue
        const t = tapOf(c.key, c.stream)
        if (!t) continue
        t.an.getByteTimeDomainData(t.buf)
        let peak = 0
        for (let i = 0; i < t.buf.length; i += 4) {
          const d = Math.abs(t.buf[i] - 128)
          if (d > peak) peak = d
        }
        if (peak > 11) speaking.push(c.key)
      }
      for (const key of [...taps.keys()]) {
        if (!seen.has(key)) { try { taps.get(key).src.disconnect() } catch { /* gone */ } taps.delete(key) }
      }
      const sig = speaking.sort().join(',')
      setSpeakSig(prev => (prev === sig ? prev : sig))
    }, 260)
    return () => {
      clearInterval(iv)
      for (const [, t] of taps) { try { t.src.disconnect() } catch { /* gone */ } }
      ac.close().catch(() => { /* noop */ })
    }
  }, [ready])
  const speaking = useMemo(() => new Set(speakSig ? speakSig.split(',') : []), [speakSig])

  // ── In-call chat ─────────────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState([])
  const [myLock, setMyLock] = useState(false) // professor's own toggle state
  const lastReadRef = useRef(0)
  useEffect(() => {
    if (!db || !meeting?.id) return
    const unsub = rtcListenChat(db, meeting.id, setChatMsgs)
    return () => { unsub(); setChatMsgs([]) }
  }, [db, meeting?.id])
  useEffect(() => {
    if (chatOpen) lastReadRef.current = Date.now()
  }, [chatOpen, chatMsgs.length])
  const chatLocked = isAdmin ? myLock : !!peers.find(p => p.role === 'admin')?.chatLock
  const unread = chatOpen ? 0 : chatMsgs.filter(m => (m.at || 0) > lastReadRef.current && m.uid !== self?.uid).length
  function sendChat(text) {
    rtcSendChat(db, meeting.id, { uid: self?.uid, name: self?.name, role: self?.role, text })
      .catch(() => toast('Message failed to send.', 'error'))
  }
  function toggleChatLock(next) {
    setMyLock(next)
    setChatLock(next)
  }

  const count = peers.length + 1

  // What the SMALL surfaces (mini player, pop-out) should show, mirroring the
  // stage: the featured person (pin or presenter) when they have visible
  // video, else any live camera. When nobody has visible video the featured
  // FACE is the professor (or the first peer) as an avatar card.
  const focusPeer = (featuredPeer && featuredPeer.stream && (featuredPeer.sharing || featuredPeer.camOn !== false))
    ? featuredPeer
    : peers.find(p => p.stream && p.camOn !== false) || null
  const facePeer = focusPeer || peers.find(p => p.role === 'admin') || peers[0] || null

  // Keep the pop-out compositor fed with the current scene every render.
  useEffect(() => {
    const src = pipSrcRef.current
    if (!src) return
    src.setScene({
      stream: focusPeer?.stream || null,
      label: featuredPeer && featuredPeer.sharing ? `${featuredPeer.name} is presenting`
        : facePeer ? facePeer.name
        : 'Waiting for others…',
      sub: `${count} in class`,
      photo: photoFor(facePeer || self),
      initials: initials((facePeer || self)?.name),
      live: !ended,
    })
  })
  const timeStr = new Date(now).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  // Stage plan: how many tiles fit before the tail collapses into "+K others"
  // (their audio keeps playing through hidden sinks), and the column count.
  const { stagePeers, hiddenPeers, stageCols } = useMemo(() => {
    const n = peers.length
    if (!n) return { stagePeers: [], hiddenPeers: [], stageCols: 1 }
    if (!stageBox.w || !stageBox.h) {
      return { stagePeers: peers, hiddenPeers: [], stageCols: Math.ceil(Math.sqrt(n)) }
    }
    let shown = n
    let plan = planGrid(stageBox.w, stageBox.h, n)
    while (shown > 1 && plan.content < TILE_MIN_W) {
      shown -= 1
      plan = planGrid(stageBox.w, stageBox.h, shown + 1) // +1 = the "+K others" tile
    }
    return { stagePeers: peers.slice(0, shown), hiddenPeers: peers.slice(shown), stageCols: plan.cols }
  }, [peers, stageBox])

  // Filmstrip (presenting/pinned): featured + up to 7 more; the rest roll
  // into a "+K" chip so the strip never scrolls either.
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
      : phase === 'removed' ? 'Removed from class'
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
          {featuredPeer && featuredPeer.sharing && ready && <span className="mr-mini-tag"><MonitorUp size={10} /> {featuredPeer.name}</span>}
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
  const tileProps = p => {
    // A down link shows the amber self-healing state while the engine still
    // has retries left; "could not connect" is reserved for links that spent
    // them all (usually a NAT pair that genuinely cannot meet without TURN).
    const linkDown = p.connState === 'failed' || p.connState === 'disconnected'
    const gaveUp = (p.retry || 0) > 6
    const student = p.role !== 'admin'
    return {
      stream: p.stream,
      name: p.name,
      role: p.role,
      photo: photoFor(p),
      micOn: p.micOn,
      camOn: p.camOn,
      muted: false,
      failed: linkDown && gaveUp,
      reconnecting: (linkDown || (p.retry || 0) > 0) && !gaveUp,
      retryN: p.retry || 0,
      quality: p.quality || 'good',
      speaking: speaking.has(p.peerId),
      hand: !!p.hand,
      onHandClick: isAdmin ? () => lowerHand(p.peerId) : undefined,
      onPin: () => togglePin(p),
      pinned: pinnedId === p.peerId,
      onMute: isAdmin && student && p.micOn !== false ? () => muteStudent(p.peerId) : undefined,
      onRemove: isAdmin && student ? () => setConfirmRemove(p) : undefined,
      onLongPress: isAdmin && student ? () => setSheetPeer(p) : undefined,
      peerId: p.peerId,
    }
  }

  const stageCells = [
    ...stagePeers.map(p => <VideoTile key={p.peerId} {...tileProps(p)} />),
    ...(hiddenPeers.length > 0 ? [(
      <div key="more" className="mr-tile mr-tile-more">
        <div className="mr-tile-avatar">
          <span className="mr-more-count">+{hiddenPeers.length}</span>
          <span className="mr-tile-hint">others in class</span>
        </div>
      </div>
    )] : []),
  ]
  const stageRows = chunk(stageCells, stageCols)

  const body = (
    <div className="mr-overlay" ref={rootRef} role="dialog" aria-label="Live class room">
      <div className="mr-stage-wrap">
        <div className="mr-main" ref={mainRef}>
          {netDown && !ended && phase === 'ready' && (
            <div className="mr-net-banner" role="alert">
              <Loader2 size={14} className="animate-spin" />
              <span>Connection lost · rejoining the class, hang tight. No need to refresh.</span>
            </div>
          )}
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
          ) : phase === 'removed' ? (
            <div className="mr-center">
              <UserX size={30} style={{ color: '#fdd663' }} />
              <b>Removed from class</b>
              <span>The professor removed you from this class session. If you think this was a mistake, message your professor.</span>
              <button className="btn btn-sm" onClick={handleLeave}>Close</button>
            </div>
          ) : featuredPeer ? (
            <>
              <div className="mr-present">
                <VideoTile
                  key={`present-${featuredPeer.peerId}`}
                  {...tileProps(featuredPeer)}
                  presentLabel={featuredPeer.sharing ? `${featuredPeer.name} is presenting` : undefined}
                  camOn={featuredPeer.sharing ? true : featuredPeer.camOn}
                />
              </div>
              <div className="mr-strip">
                {stripPeers.map(p => (
                  <VideoTile
                    key={p.peerId}
                    {...tileProps(p)}
                    stream={p === featuredPeer ? null : p.stream}
                    noVideo={p === featuredPeer}
                    noHint={p === featuredPeer}
                    presenting={p === featuredPeer}
                    peerId={p === featuredPeer ? undefined : p.peerId}
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
                {stageRows.map((row, i) => (
                  <div key={i} className="mr-row">{row}</div>
                ))}
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

          {/* Floating reactions rising off tiles. */}
          {floats.map(f => (
            <span key={f.key} className="mr-float" style={{ left: f.left, top: f.top }}>
              <EmojiIcon emoji={f.e} size={26} />
              <i>{f.name}</i>
            </span>
          ))}

          {/* Event snackbars: joins, leaves, raised hands. */}
          {!ended && snacks.length > 0 && (
            <div className="mr-snacks">
              {snacks.map(s => (
                <div key={s.id} className="mr-snack">
                  {s.kind === 'hand' ? <Hand size={14} style={{ color: '#fbbc04' }} />
                    : s.kind === 'leave' ? <LogOut size={14} style={{ color: '#9aa0a6' }} />
                    : <LogIn size={14} style={{ color: '#81c995' }} />}
                  <span>{s.text}</span>
                  {s.kind === 'hand' && isAdmin && s.peerId && (
                    <button onClick={() => lowerFromSnack(s)}>Lower</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Long-press actions for a student tile (phones have no hover). */}
          {sheetPeer && !ended && (
            <div className="mr-sheet-scrim" onClick={() => setSheetPeer(null)}>
              <div className="mr-sheet" role="menu" aria-label={`Actions for ${sheetPeer.name}`} onClick={e => e.stopPropagation()}>
                <div className="mr-sheet-title">{sheetPeer.name}</div>
                {peers.find(p => p.peerId === sheetPeer.peerId)?.micOn !== false && (
                  <button onClick={() => { muteStudent(sheetPeer.peerId); setSheetPeer(null) }}>
                    <MicOff size={16} /> Mute microphone
                  </button>
                )}
                <button className="mr-sheet-danger" onClick={() => { setConfirmRemove(sheetPeer); setSheetPeer(null) }}>
                  <UserX size={16} /> Remove from class
                </button>
                <button onClick={() => { togglePin(sheetPeer); setSheetPeer(null) }}>
                  {pinnedId === sheetPeer.peerId ? <PinOff size={16} /> : <Pin size={16} />}
                  {pinnedId === sheetPeer.peerId ? 'Unpin' : 'Pin to your screen'}
                </button>
                <button className="mr-sheet-cancel" onClick={() => setSheetPeer(null)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Remove confirmation - rendered in-room (the app's dialog portal
              would stack under this overlay). */}
          {confirmRemove && !ended && (
            <div className="mr-sheet-scrim" onClick={() => setConfirmRemove(null)}>
              <div className="mr-confirm" role="alertdialog" aria-label="Remove from class" onClick={e => e.stopPropagation()}>
                <b>Remove {confirmRemove.name}?</b>
                <span>They leave the class immediately and cannot rejoin this session.</span>
                <div className="mr-confirm-btns">
                  <button onClick={() => setConfirmRemove(null)}>Cancel</button>
                  <button
                    className="mr-confirm-danger"
                    onClick={() => {
                      removeStudent(confirmRemove.peerId)
                      toast(`${confirmRemove.name} was removed from the class.`, 'success')
                      setConfirmRemove(null)
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Reactions bar (toggled by the smiley control). */}
          {ready && reactOpen && (
            <div className="mr-react-bar">
              {MEET_REACTIONS.map(e => (
                <button key={e} onClick={() => react(e)} title="Send to everyone">
                  <EmojiIcon emoji={e} size={22} />
                </button>
              ))}
            </div>
          )}

          {/* Floating self-view: your camera never occupies a stage tile. On a
              phone the card itself goes portrait to match the camera frame. */}
          {ready && (
            <div
              className={`mr-pip${speaking.has('self') ? ' mr-tile-speaking' : ''}`}
              data-peer="self"
              style={!sharing && camOn && localStream && selfRatio > 0
                ? (selfRatio < 1
                  ? { width: 'auto', height: 150, aspectRatio: String(Math.max(selfRatio, 9 / 16)) }
                  : { aspectRatio: String(Math.min(selfRatio, 16 / 9)) })
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
              {myHand && <span className="mr-hand-badge mr-hand-badge-self"><Hand size={12} /></span>}
              <span className={`mr-qdot mr-qdot-${selfQuality} mr-qdot-tile`} title={selfQuality === 'good' ? 'Your connection is good' : selfQuality === 'weak' ? 'Your connection is a little weak' : 'Your connection is struggling'} />
              <span className="mr-pip-label">You</span>
              {!micOn && <span className="mr-mic-off"><MicOff size={12} /></span>}
            </div>
          )}
        </div>

        <MeetingChat
          open={chatOpen && !ended}
          messages={chatMsgs}
          selfUid={self?.uid}
          isAdmin={isAdmin}
          locked={chatLocked}
          photoOf={photoFor}
          onToggleLock={toggleChatLock}
          onSend={sendChat}
          onClose={() => setChatOpen(false)}
        />
        <MeetingPeople
          open={peopleOpen && !ended && ready}
          peers={peers}
          self={self}
          micOn={micOn}
          isAdmin={isAdmin}
          photoOf={photoFor}
          onMute={p => muteStudent(p.peerId)}
          onMuteAll={() => { muteAllStudents(); toast('Muted all students. They can unmute when they need to speak.', 'success') }}
          onRemove={p => setConfirmRemove(p)}
          onLowerHand={p => lowerHand(p.peerId)}
          onClose={() => setPeopleOpen(false)}
        />
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
              {/* Present is ALWAYS visible (students share too). NO phone or
                  tablet browser can capture the screen (Chrome intentionally
                  hides getDisplayMedia on Android, iOS never had it - only
                  native apps can), so phones get a dimmed button with an
                  explanation instead of a mysteriously missing one. */}
              <button
                className={`mr-ctl${sharing ? ' mr-ctl-on' : ''}${canShare ? '' : ' mr-ctl-dim'}`}
                onClick={sharing ? stopShare : canShare ? startShare : () => toast('Phones and tablets cannot share their screen from the browser - no mobile browser allows it. To present, join the class from a computer using Chrome, Edge, or Safari.', 'error', 6000)}
                title={sharing ? 'Stop presenting' : canShare ? 'Present your screen' : 'Presenting needs a computer - phone browsers cannot capture the screen'}
              >
                <MonitorUp size={18} />
              </button>
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
              <button className={`mr-ctl${myHand ? ' mr-ctl-hand' : ''}`} onClick={toggleHand} title={myHand ? 'Lower your hand' : 'Raise your hand'}>
                <Hand size={18} />
              </button>
              <button className={`mr-ctl${reactOpen ? ' mr-ctl-accent' : ''}`} onClick={() => setReactOpen(o => !o)} title="Send a reaction">
                <Smile size={18} />
              </button>
              <button
                className={`mr-ctl${chatOpen ? ' mr-ctl-accent' : ''}`}
                onClick={() => setChatOpen(o => { const n = !o; if (n) setPeopleOpen(false); return n })}
                title="In-call messages"
              >
                <MessageSquare size={18} />
                {unread > 0 && <span className="mr-ctl-badge">{unread > 9 ? '9+' : unread}</span>}
              </button>
              <button
                className={`mr-ctl${peopleOpen ? ' mr-ctl-accent' : ''}`}
                onClick={() => setPeopleOpen(o => { const n = !o; if (n) setChatOpen(false); return n })}
                title="People in this class"
              >
                <Users size={18} />
              </button>
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
          {handCount > 0 && (
            <span className="mr-hand-chip" title={handTitle}><Hand size={13} /> {handCount}</span>
          )}
          <button
            type="button"
            className="mr-count"
            onClick={() => setPeopleOpen(o => { const n = !o; if (n) setChatOpen(false); return n })}
            title="People in this class"
          >
            <Users size={14} /> {count}/{ROOM_CAP}
          </button>
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
