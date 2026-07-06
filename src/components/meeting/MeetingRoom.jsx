import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Radio,
  Users, AlertTriangle, Loader2, CheckCircle, Minimize2, Maximize2,
  PictureInPicture2, CircleDot, Square, Hand, Pin, PinOff, Volume2,
  MessageSquare, Smile, LogIn, LogOut, UserX, MoreHorizontal, Pencil,
  List, Zap, Activity, X, BarChart2, Shuffle, Clock, HelpCircle, Star, Layers,
} from 'lucide-react'
import { useData } from '@/context/DataContext'
import { teleMeet } from '@/utils/telemetry'
import { useUI } from '@/context/UIContext'
import useMeetingRoom from '@/hooks/useMeetingRoom'
import {
  ROOM_CAP, rtcListenChat, rtcSendChat,
  rtcListenQuestions, rtcAskQuestion, rtcPlusQuestion, rtcAnswerQuestion, rtcDeleteQuestion,
} from '@/firebase/rtc'
import { recordingSupported, createMeetingRecorder } from '@/utils/meetingRecorder'
import { isConfigured as driveConfigured, getConnection as driveConnection, connect as driveConnect, startResumableUpload } from '@/utils/googleDrive'
import { detectAudioShield } from '@/utils/audioShield'
import { createPipSource } from '@/utils/meetingPip'
import { playMeetingSound, preloadMeetingSounds } from '@/utils/meetingSounds'
import MeetingChat from '@/components/meeting/MeetingChat'
import MeetingPeople from '@/components/meeting/MeetingPeople'
import MeetingOutline from '@/components/meeting/MeetingOutline'
import MeetingPoll from '@/components/meeting/MeetingPoll'
import MeetingQuestions from '@/components/meeting/MeetingQuestions'
import PreJoinPanel from '@/components/meeting/PreJoinPanel'
import Whiteboard from '@/components/meeting/Whiteboard'
import EmojiIcon from '@/components/primitives/EmojiIcon'
import { getLateThreshold, setLateThreshold, LATE_THR_DEFAULT } from '@/utils/attendance'
import { createTranscriptRecorder, transcriptCaptureSupported } from '@/utils/transcriptRecorder'
import { saveSegment, saveMeta } from '@/utils/transcriptAudio'
import { courseShort } from '@/constants/courses'

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

// Floating self-view preferences: which corner it sits in and whether it is
// folded into the little reopen handle. Per device, survives across classes.
const SELF_VIEW_KEY = 'acadflow_selfview'
function loadSelfView() {
  try {
    const v = JSON.parse(localStorage.getItem(SELF_VIEW_KEY) || '{}')
    return {
      hidden: v.hidden === true,
      corner: ['tl', 'tr', 'bl', 'br'].includes(v.corner) ? v.corner : 'br',
    }
  } catch {
    return { hidden: false, corner: 'br' }
  }
}
// Mini player position: which viewport corner the minimized card docks to.
// Per device, survives across classes and reloads.
const MINI_POS_KEY = 'acadflow_minipos'
function loadMiniCorner() {
  try {
    const v = localStorage.getItem(MINI_POS_KEY)
    return ['tl', 'tr', 'bl', 'br'].includes(v) ? v : 'br'
  } catch {
    return 'br'
  }
}

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
          Reconnecting…
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
  const { db: dbRef, saveMeetingRecording, patchMeeting, students, classes, admin } = useData()
  const { toast } = useUI()
  const db = dbRef?.current || null
  const {
    phase, errorMsg, peers, localStream, micOn, camOn, sharing, boardSharing, canShare,
    screenStream, setRecordingFlag, setHand, lowerHand, sendReaction, setChatLock,
    toggleMic, toggleCam, startShare, startBoardShare, stopShare, leave, retry, confirmJoin,
    netDown, selfQuality, forcedMuteAt, joinLogLive, reconnectNow,
    dataSaver, setDataSaver, getDiagnostics,
    muteStudent, muteAllStudents, removeStudent, getJoinLog,
  } = useMeetingRoom({ db, roomId: meeting?.id, self })

  const [ending, setEnding] = useState(false)
  // Host-control surfaces: the People panel, the long-press tile sheet, and
  // the remove confirmation (rendered inside the room - the app's dialog
  // portal would land under this overlay).
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [sheetPeer, setSheetPeer] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  // Class outline panel (mutually exclusive with chat/people, like they are
  // with each other) and the connection-details card behind the self dot.
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [otlSeen, setOtlSeen] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)
  const [diag, setDiag] = useState(null)
  const [pollComposer, setPollComposer] = useState(false)
  // Question queue panel + shared class timer composer.
  const [qqOpen, setQqOpen] = useState(false)
  const [questions, setQuestions] = useState([])
  const [timerOpen, setTimerOpen] = useState(false)
  const [timerMin, setTimerMin] = useState('')
  const [timerLabel, setTimerLabel] = useState('')
  // Class tools popup: one bar button holding the professor's teaching tools
  // (whiteboard, poll, timer, picker, record) so the bar stays scannable.
  const [toolsOpen, setToolsOpen] = useState(false)

  // Floating self-view: draggable to any corner and foldable into a small
  // reopen handle; both remembered per device. Dragging writes left/top on
  // the element DIRECTLY (React never sets those keys, so its style diffing
  // leaves them alone mid-drag even when the room re-renders); on release
  // the inline position is cleared and a corner class takes over.
  const [pipView, setPipView] = useState(loadSelfView)
  const pipBoxRef = useRef(null)
  const pipDragRef = useRef(null)
  useEffect(() => {
    try { localStorage.setItem(SELF_VIEW_KEY, JSON.stringify(pipView)) } catch { /* nicety */ }
  }, [pipView])
  function onPipDown(e) {
    if (e.target.closest('button')) return
    const box = pipBoxRef.current
    if (!box) return
    const b = box.getBoundingClientRect()
    pipDragRef.current = { dx: e.clientX - b.left, dy: e.clientY - b.top, x0: e.clientX, y0: e.clientY, moved: false }
    try { box.setPointerCapture(e.pointerId) } catch { /* older engines */ }
  }
  function onPipMove(e) {
    const d = pipDragRef.current
    const box = pipBoxRef.current
    const main = mainRef.current
    if (!d || !box || !main) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return
    d.moved = true
    const m = main.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const x = Math.max(4, Math.min(m.width - b.width - 4, e.clientX - m.left - d.dx))
    const y = Math.max(4, Math.min(m.height - b.height - 4, e.clientY - m.top - d.dy))
    box.style.left = `${Math.round(x)}px`
    box.style.top = `${Math.round(y)}px`
    box.style.right = 'auto'
    box.style.bottom = 'auto'
  }
  function onPipUp() {
    const d = pipDragRef.current
    pipDragRef.current = null
    const box = pipBoxRef.current
    const main = mainRef.current
    if (!d || !d.moved || !box || !main) return
    const m = main.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const corner = (b.top - m.top + b.height / 2 < m.height / 2 ? 't' : 'b')
      + (b.left - m.left + b.width / 2 < m.width / 2 ? 'l' : 'r')
    box.style.left = box.style.top = box.style.right = box.style.bottom = ''
    setPipView(v => ({ ...v, corner }))
  }

  // Minimized mini player: same drag mechanics as the self-view, but bounded
  // by the whole viewport (the card is fixed on document.body, floating over
  // whatever page is behind it). Releases snap to the nearest corner.
  const [miniCorner, setMiniCorner] = useState(loadMiniCorner)
  const miniBoxRef = useRef(null)
  const miniDragRef = useRef(null)
  const miniMovedRef = useRef(false)
  useEffect(() => {
    try { localStorage.setItem(MINI_POS_KEY, miniCorner) } catch { /* nicety */ }
  }, [miniCorner])
  function onMiniDown(e) {
    if (e.target.closest('button')) return
    const box = miniBoxRef.current
    if (!box) return
    const b = box.getBoundingClientRect()
    miniDragRef.current = { dx: e.clientX - b.left, dy: e.clientY - b.top, x0: e.clientX, y0: e.clientY, moved: false }
    try { box.setPointerCapture(e.pointerId) } catch { /* older engines */ }
  }
  function onMiniMove(e) {
    const d = miniDragRef.current
    const box = miniBoxRef.current
    if (!d || !box) return
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return
    d.moved = true
    const b = box.getBoundingClientRect()
    const x = Math.max(4, Math.min(window.innerWidth - b.width - 4, e.clientX - d.dx))
    const y = Math.max(4, Math.min(window.innerHeight - b.height - 4, e.clientY - d.dy))
    box.style.left = `${Math.round(x)}px`
    box.style.top = `${Math.round(y)}px`
    box.style.right = 'auto'
    box.style.bottom = 'auto'
  }
  function onMiniUp() {
    const d = miniDragRef.current
    miniDragRef.current = null
    const box = miniBoxRef.current
    if (!d || !d.moved || !box) return
    // Suppress only the click synthesized by THIS gesture (it fires before
    // the timeout runs), so the video's tap-to-expand never triggers on a drop.
    miniMovedRef.current = true
    setTimeout(() => { miniMovedRef.current = false }, 0)
    const b = box.getBoundingClientRect()
    const corner = (b.top + b.height / 2 < window.innerHeight / 2 ? 't' : 'b')
      + (b.left + b.width / 2 < window.innerWidth / 2 ? 'l' : 'r')
    box.style.left = box.style.top = box.style.right = box.style.bottom = ''
    setMiniCorner(corner)
  }
  // Phone control bar: only mic, camera, More, End fit; everything else
  // lives in the More sheet (CSS decides - desktop never sees the button).
  const [moreOpen, setMoreOpen] = useState(false)

  // Professor whiteboard. Content ({ ops, redo }) lives in a ref so closing
  // and reopening the board keeps the drawing for the whole session.
  const [boardOpen, setBoardOpen] = useState(false)
  const wbStore = useRef(null)
  if (!wbStore.current) wbStore.current = { ops: [], redo: [] }

  // ── Shared class timer + random student picker (both live on the meeting
  // doc - professor-only writes, everyone reads through the meetings
  // listener; no new Firestore channel). A 1s tick runs ONLY while a
  // countdown or a fresh pick banner is actually on screen.
  const timer = meeting?.timer || null
  const picker = meeting?.picker || null
  const [, setSecTick] = useState(0)
  const timerLive = !!timer && timer.endsAt + 10000 > Date.now()
  const pickLive = !!picker && (picker.at || 0) + 15000 > Date.now()
  useEffect(() => {
    if (!timerLive && !pickLive) return undefined
    const t = setInterval(() => setSecTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [timerLive, pickLive])
  // One chime per timer for EVERYONE when it hits zero; one chime for the
  // PICKED student when their name comes up.
  const timerChimedRef = useRef(new Set())
  useEffect(() => {
    if (!timer || !timer.at) return
    if (Date.now() < timer.endsAt || timerChimedRef.current.has(timer.at)) return
    timerChimedRef.current.add(timer.at)
    playMeetingSound('hand')
  })
  const pickChimedRef = useRef(new Set())
  useEffect(() => {
    if (!picker || !picker.at || pickChimedRef.current.has(picker.at)) return
    if (picker.uid !== self?.uid || !pickLive) return
    pickChimedRef.current.add(picker.at)
    playMeetingSound('hand')
  }, [picker, pickLive]) // eslint-disable-line react-hooks/exhaustive-deps

  function startTimer(mins) {
    const m = Math.min(180, Math.max(1, mins))
    patchMeeting(meeting, { timer: { at: Date.now(), endsAt: Date.now() + m * 60000, label: timerLabel.trim().slice(0, 60) } })
      .catch(() => toast('Could not start the timer. Check your connection.', 'error'))
    setTimerOpen(false)
    setTimerMin('')
    setTimerLabel('')
  }

  // Fair cold-call: draw from students PRESENT right now, skipping anyone
  // already picked this class; once everyone has had a turn the cycle resets.
  function pickStudent() {
    const present = peers.filter(p => p.role !== 'admin' && p.uid)
    if (!present.length) { toast('No students are in the room yet.', 'error'); return }
    const history = picker?.history || []
    let pool = present.filter(p => !history.includes(p.uid))
    let nextHistory = history
    if (!pool.length) { pool = present; nextHistory = [] }
    const p = pool[Math.floor(Math.random() * pool.length)]
    patchMeeting(meeting, { picker: { uid: p.uid, name: p.name || 'Student', at: Date.now(), history: [...nextHistory, p.uid].slice(-120) } })
      .catch(() => toast('Could not pick - check your connection.', 'error'))
  }

  // Refresh the connection-details card only while it is open (its numbers
  // come from the stats the engine already polls - no extra network work).
  useEffect(() => {
    if (!diagOpen) return
    const read = () => setDiag(getDiagnostics())
    read()
    const t = setInterval(read, 2500)
    return () => clearInterval(t)
  }, [diagOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // The joining spinner must never be a dead end on weak mobile data: past
  // 20s of 'connecting' we own up to the stall and offer Retry / Close (the
  // engine keeps trying underneath either way).
  const [joinSlow, setJoinSlow] = useState(false)
  useEffect(() => {
    if (phase !== 'connecting') { setJoinSlow(false); return }
    const t = setTimeout(() => setJoinSlow(true), 20000)
    return () => clearTimeout(t)
  }, [phase])

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

  // Enrolled roster of this class, for the People panel's live attendance
  // (Present/Late/Not joined count against ENROLLMENT, not just the room).
  const classRoster = useMemo(() => (
    (students || [])
      .filter(s => s.classId === meeting?.classId || s.classIds?.includes(meeting?.classId))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  ), [students, meeting?.classId])

  // Late threshold: the meeting doc is the live source (the professor's
  // change reaches every device through the meetings listener, so a student's
  // own status pill always agrees with the professor's view); the local
  // preference only seeds the professor's first pick. Default: 15 minutes.
  const lateThr = meeting?.lateThr || (isAdmin ? getLateThreshold() : LATE_THR_DEFAULT)
  function changeThr(v) {
    setLateThreshold(v)
    if (meeting) patchMeeting(meeting, { lateThr: v }).catch(() => { /* local view already updated */ })
  }

  // Bar label: "SECTION - SUBJECT" resolved from the class record (the old
  // title · subject often read as the same string twice).
  const barLabel = useMemo(() => {
    const cls = (classes || []).find(c => c.id === meeting?.classId)
    const sec = cls ? `${courseShort(cls.name)}${cls.section ? ` ${cls.section}` : ''}` : (meeting?.className || '')
    const sub = meeting?.subject || meeting?.title || 'Live class'
    return sec ? `${sec} - ${sub}` : sub
  }, [classes, meeting?.classId, meeting?.className, meeting?.subject, meeting?.title])

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
  const recStateRef = useRef(recState); recStateRef.current = recState
  // Speech-tuned parallel audio capture + who-was-speaking timeline, feeding
  // the on-device Whisper transcript. Rides the Record button; ~1% CPU.
  const trRef = useRef(null)
  const spkRef = useRef({ events: [], sig: '' })

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
      // Transcript audio capture (best-effort - recording never depends on it).
      if (transcriptCaptureSupported()) {
        try {
          const mid = meeting.id
          const tr = createTranscriptRecorder({
            onSegment: (blob, index, startedAt) => saveSegment(mid, index, blob, startedAt).catch(() => { /* segment lost */ }),
          })
          tr.start()
          trRef.current = tr
          spkRef.current = { events: [], sig: '' }
        } catch { /* transcript capture unavailable */ }
      }
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
    // Flush the transcript capture alongside (its last segment + the speaker
    // timeline persist to IndexedDB; the Generate transcript button on the
    // ended row picks them up).
    const tr = trRef.current
    trRef.current = null
    if (tr) {
      tr.stop()
        .then(() => saveMeta(rec.meeting.id, { speakers: spkRef.current.events.slice(0, 6000) }))
        .catch(() => { /* transcript audio best-effort */ })
    }
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

  // The recording follows the TRUE presenter, never a local pin. (The scene
  // feed itself lives further down, after the speaking detector it reads.)
  const sharerPeer = useMemo(() => {
    const sharers = peers.filter(p => p.sharing)
    if (!sharers.length) return null
    return sharers.sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0))[0]
  }, [peers])

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

  // Late-join snapshot for the companion panel: how many minutes into a live
  // class this device joined, frozen at the first ready so mid-call
  // auto-reconnects never re-flag the student as "late" again. Instant
  // meetings stamp scheduledAt at go-live, so it is the true class start.
  const lateMinRef = useRef(-1)
  if (ready && lateMinRef.current < 0) {
    lateMinRef.current = !isAdmin && meeting?.status === 'live' && meeting?.scheduledAt
      ? Math.max(0, Math.round((Date.now() - meeting.scheduledAt) / 60000))
      : 0
  }
  const lateMin = Math.max(0, lateMinRef.current)

  // Telemetry: while a room is mounted (green room, live, or minimized) flag
  // the tab as in-call so a fresh deploy's service-worker reload WAITS instead
  // of dropping everyone mid-class; on unmount, report one per-class quality
  // summary (reconnects, last self quality, relay, peak peers) for the
  // System reports tab. Scalars are stamped at render time so the unmount
  // closure never reads stale values.
  const teleRef = useRef({ mid: '', at: 0, recon: 0, peers: 0, q: '', diag: null })
  teleRef.current.mid = meeting?.id || teleRef.current.mid
  teleRef.current.q = selfQuality || teleRef.current.q
  teleRef.current.diag = getDiagnostics
  if (ready && !teleRef.current.at) teleRef.current.at = Date.now()
  useEffect(() => { if (netDown) teleRef.current.recon += 1 }, [netDown])
  useEffect(() => { teleRef.current.peers = Math.max(teleRef.current.peers, peers.length) }, [peers.length])
  useEffect(() => {
    window.__acadflowInCall = true
    return () => {
      window.__acadflowInCall = false
      const t = teleRef.current
      if (!t.at || !t.mid) return
      let relay = false
      try {
        const d = t.diag && t.diag()
        relay = !!(d && d.relay > 0)
      } catch { /* engine already gone */ }
      teleMeet({ id: t.mid, dur: Math.round((Date.now() - t.at) / 60000), rec: t.recon, q: t.q, relay, peers: t.peers })
    }
  }, [])

  // One quiet nudge toward the catch-up summary: the companion button gets a
  // badge until the late joiner opens it once (or was not late at all).
  const otlHas = !!(((meeting?.outline || {}).items || []).length || ((meeting?.outline || {}).notes || []).length)
  const otlBadge = ready && !otlSeen && !outlineOpen && lateMin >= 5 && otlHas

  // Timed agenda: when the outline's current item runs past its minutes, the
  // PROFESSOR gets one soft chime + toast per item. Students never see or
  // hear pacing pressure. (Placed after isAdmin/ended above - the deps array
  // is read at render time, so it must not reference consts declared later.)
  const chimedRef = useRef(new Set())
  useEffect(() => {
    if (!isAdmin || phase !== 'ready' || ended) return undefined
    const check = () => {
      const o = meeting?.outline
      const nowIt = (o?.items || []).find(i => !i.done)
      if (!nowIt || !nowIt.min || !o?.nowAt || chimedRef.current.has(nowIt.id)) return
      if (Date.now() - o.nowAt > nowIt.min * 60000) {
        chimedRef.current.add(nowIt.id)
        playMeetingSound('hand')
        toast(`Outline: "${nowIt.text}" is past its ${nowIt.min} min.`)
      }
    }
    check()
    const t = setInterval(check, 30000)
    return () => clearInterval(t)
  }, [isAdmin, phase, ended, meeting]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto agenda: when the professor starts presenting (screen or whiteboard)
  // and the outline has NO open item, log it as the current outline entry so
  // late joiners see what is happening; it checks itself off when presenting
  // stops. If a manual agenda item is already open, the presentation is part
  // of it - adding a second entry would just be noise, so nothing is written.
  const autoItemRef = useRef('')
  useEffect(() => {
    if (!isAdmin || !ready || ended || !meeting) return
    const o = meeting.outline || {}
    const items = Array.isArray(o.items) ? o.items : []
    const links = Array.isArray(o.links) ? o.links : []
    const prevNow = (items.find(i => !i.done) || {}).id
    let next = null
    if (sharing) {
      const label = boardSharing ? 'Whiteboard' : 'Screen presentation'
      const open = items.find(i => !i.done)
      if (open) {
        // Our own auto entry switching kind (share <-> board): rename it.
        if (open.auto && open.text !== label) next = items.map(i => i.id === open.id ? { ...i, text: label } : i)
        else { if (open.auto) autoItemRef.current = open.id; return }
        autoItemRef.current = open.id
      } else {
        if (items.length >= 20) return
        const id = uuidv4()
        autoItemRef.current = id
        next = [...items, { id, text: label, done: false, auto: true }]
      }
    } else {
      const id = autoItemRef.current
      autoItemRef.current = ''
      if (!id || !items.some(i => i.id === id && i.auto && !i.done)) return
      next = items.map(i => i.id === id ? { ...i, done: true } : i)
    }
    const newNow = (next.find(i => !i.done) || {}).id
    patchMeeting(meeting, {
      outline: { items: next, links, nowAt: newNow !== prevNow ? Date.now() : (o.nowAt || 0) },
    }).catch(() => { /* best-effort log, never interrupts presenting */ })
  }, [sharing, boardSharing]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // Professor spotlight: the meeting doc names one peer as the WHOLE class's
  // featured tile (recitations, student reports). Students cannot override
  // it with a local pin; the professor's own pin still can (they set the
  // spotlight, so their pin is a deliberate look-away). A spotlighted peer
  // who left simply falls out of the lookup - no cleanup write needed.
  const spotPeer = meeting?.spot?.peerId ? peers.find(p => p.peerId === meeting.spot.peerId) || null : null
  // A PRESENTER always takes the stage: an active share or whiteboard is
  // the class content, so neither a local pin nor the spotlight can knock
  // it off. Pin and spotlight decide the stage only when nobody presents.
  const featuredPeer = sharerPeer || (isAdmin ? (pinnedPeer || spotPeer) : (spotPeer || pinnedPeer))
  const togglePin = p => setPinnedId(cur => (cur === p.peerId ? '' : p.peerId))
  function toggleSpot(p) {
    const on = meeting?.spot?.peerId === p.peerId
    patchMeeting(meeting, { spot: on ? null : { peerId: p.peerId, name: p.name || '', at: Date.now() } })
      .catch(() => toast('Could not update the spotlight. Check your connection.', 'error'))
  }

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
    // Per-float drift + wobble make a burst of the same emoji read as many
    // (transform/opacity only - the animation never costs the video).
    const dx = Math.round((Math.random() * 2 - 1) * 38)
    const rot = Math.round((Math.random() * 2 - 1) * 14)
    setFloats(f => [...f.slice(-11), { key, e: emoji, name, left, top, dx, rot }])
    setTimeout(() => setFloats(f => f.filter(x => x.key !== key)), 2600)
  }
  // Own last reaction, kept as state so the recorder scene sees it too (a
  // peer's reaction rides their participant doc; ours never comes back).
  const [selfReact, setSelfReact] = useState(null)
  function react(emoji) {
    sendReaction(emoji)
    spawnFloat('self', emoji, 'You')
    setSelfReact({ e: emoji, at: Date.now() })
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
      // battery on phones, and main-thread time everywhere else). EXCEPT
      // while recording: the sweep also feeds the transcript's speaker
      // timeline, which must keep running when the professor minimizes.
      if ((minimizedRef.current || document.visibilityState === 'hidden') && recStateRef.current !== 'on') return
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

  // Feed the recorder the current scene and audio mix whenever the room
  // changes: the true presenter plus every tile's photo, mic, hand, reaction,
  // and speaking state - the recording shows the class the way the room did.
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
        {
          // localStream keeps the camera while presenting (the share rides its
          // own stream), so the professor's face stays in the rail mid-share.
          key: 'self', stream: localStream, name: self?.name || 'You', camOn,
          photo: photoFor(self), micOn, hand: myHand, react: selfReact,
          speaking: speaking.has('self'),
        },
        ...peers.map(p => ({
          // A presenting peer's one video slot IS the share - avatar them.
          key: p.peerId, stream: p.stream, name: p.name,
          camOn: p.camOn !== false && !p.sharing,
          photo: photoFor(p), micOn: p.micOn !== false, hand: !!p.hand,
          react: p.react || null, speaking: speaking.has(p.peerId),
        })),
      ],
      audioStreams: [localStream, ...peers.map(p => p.stream)].filter(Boolean),
    })
    trRef.current?.setAudioStreams([localStream, ...peers.map(p => p.stream)].filter(Boolean))
  }, [recState, peers, localStream, screenStream, sharing, camOn, micOn, myHand, selfReact, speaking, sharerPeer, self, photoFor])

  // Who-was-speaking timeline for the transcript (only while recording): an
  // event is appended only when the speaking set CHANGES, so a whole class
  // is a few hundred entries. Whisper's timestamps are matched against this
  // to put real names on transcript lines.
  useEffect(() => {
    if (recState !== 'on') return
    const names = [...speaking]
      .map(id => (id === 'self' ? (self?.name || 'Professor') : peers.find(p => p.peerId === id)?.name))
      .filter(Boolean)
    const sig = names.slice().sort().join(',')
    if (sig === spkRef.current.sig) return
    spkRef.current.sig = sig
    if (spkRef.current.events.length < 6000) spkRef.current.events.push({ t: Date.now(), names })
  }, [speaking, recState, peers, self])

  // ── In-call chat ─────────────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMsgs, setChatMsgs] = useState([])
  const [myLock, setMyLock] = useState(false) // professor's own toggle state
  const lastReadRef = useRef(0)
  useEffect(() => {
    if (!db || !meeting?.id) return
    // Only THIS session's messages: anything older than a wide margin before
    // the class start is a leftover from a failed end-purge - never show it.
    const startGuard = (meeting?.scheduledAt || 0) - 20 * 60000
    const unsub = rtcListenChat(db, meeting.id, msgs =>
      setChatMsgs(startGuard > 0 ? msgs.filter(m2 => (m2.at || 0) >= startGuard) : msgs))
    return () => { unsub(); setChatMsgs([]) }
  }, [db, meeting?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (chatOpen) lastReadRef.current = Date.now()
  }, [chatOpen, chatMsgs.length])
  const chatLocked = isAdmin ? myLock : !!peers.find(p => p.role === 'admin')?.chatLock
  const unread = chatOpen ? 0 : chatMsgs.filter(m => (m.at || 0) > lastReadRef.current && m.uid !== self?.uid).length

  // ── Question queue (same lifecycle as the chat listener) ─────────────────
  useEffect(() => {
    if (!db || !meeting?.id) return
    const startGuard = (meeting?.scheduledAt || 0) - 20 * 60000
    const unsub = rtcListenQuestions(db, meeting.id, qs =>
      setQuestions(startGuard > 0 ? qs.filter(q2 => (q2.at || 0) >= startGuard) : qs))
    return () => { unsub(); setQuestions([]) }
  }, [db, meeting?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const openQCount = questions.filter(q => !q.answered).length
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

  // ── Whiteboard (professor only) ─────────────────────────────────────────
  // Portaled separately from the room body so minimizing the meeting hides
  // the board with CSS instead of unmounting it: the canvas (and therefore a
  // live board share) survives, students keep seeing the last state.
  const boardEl = isAdmin && boardOpen ? createPortal(
    <Whiteboard
      store={wbStore.current}
      presenting={boardSharing}
      onPresent={startBoardShare}
      onStopPresent={stopShare}
      onClose={() => { if (boardSharing) stopShare(); setBoardOpen(false) }}
      hidden={!!minimized}
      toast={toast}
    />,
    document.body,
  ) : null

  // ── Mini player (minimized) ─────────────────────────────────────────────
  if (minimized) {
    const statusText = ended ? 'Class ended'
      : phase === 'prejoin' ? 'Waiting to join'
      : phase === 'connecting' ? 'Joining…'
      : phase === 'error' ? 'Could not join'
      : phase === 'full' ? 'Room is full'
      : phase === 'removed' ? 'Removed from class'
      : phase === 'replaced' ? 'Joined somewhere else'
      : null
    const expand = () => {
      if (miniMovedRef.current) return // that click was the end of a drag
      onMinimize?.(false)
    }
    const mini = (
      <div
        className={`mr-mini mr-mpos-${miniCorner}`}
        ref={el => { rootRef.current = el; miniBoxRef.current = el }}
        onPointerDown={onMiniDown}
        onPointerMove={onMiniMove}
        onPointerUp={onMiniUp}
        onPointerCancel={onMiniUp}
        role="dialog"
        aria-label="Live class mini player"
      >
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
    return <>{createPortal(mini, document.body)}{boardEl}</>
  }

  // ── Green room (pre-join) ────────────────────────────────────────────────
  // Deliberate entries only: the engine idles in 'prejoin' until the panel
  // hands over mic/cam choices through confirmJoin. Auto-reconnects and the
  // mini player never remount the engine, so they never land here. Closing
  // the panel just closes the overlay - nothing was captured or joined yet.
  if (phase === 'prejoin' && !ended) {
    const pre = (
      <div className="mr-overlay" role="dialog" aria-label="Set up before joining">
        <PreJoinPanel
          db={db}
          roomId={meeting?.id}
          self={self}
          isAdmin={isAdmin}
          photo={photoFor(self)}
          label={barLabel}
          meeting={meeting}
          onJoin={confirmJoin}
          onCancel={onClose}
        />
      </div>
    )
    return createPortal(pre, document.body)
  }

  // ── Full room ───────────────────────────────────────────────────────────
  const tileProps = p => {
    // A down link shows the amber self-healing state for as long as it takes
    // - the engine never gives up on a peer whose heartbeat says they are in
    // the room (Meet behavior), so there is no terminal "could not connect".
    const linkDown = p.connState === 'failed' || p.connState === 'disconnected'
    const student = p.role !== 'admin'
    return {
      stream: p.stream,
      name: p.name,
      role: p.role,
      photo: photoFor(p),
      micOn: p.micOn,
      // Data saver: their camera packets are paused toward this device (the
      // sender side stops them), so show the photo instead of a dead frame.
      // A presenting peer's video is the class content and stays visible.
      camOn: dataSaver && !p.sharing ? false : p.camOn,
      muted: false,
      failed: false,
      reconnecting: linkDown || (p.retry || 0) > 0,
      retryN: p.retry || 0,
      quality: p.quality || '',
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
              <button className="mr-net-retry" onClick={reconnectNow}>Reconnect now</button>
            </div>
          )}
          {dataSaver && !netDown && !ended && phase === 'ready' && (
            <button className="mr-saver-chip" onClick={() => setDataSaver(false)} title="Turn data saver off">
              <Zap size={12} aria-hidden="true" />
              <span>Data saver on · camera video paused · tap to turn off</span>
            </button>
          )}
          {timerLive && !ended && phase === 'ready' && (() => {
            const left = timer.endsAt - Date.now()
            const up = left <= 0
            const mm = Math.max(0, Math.floor(left / 60000))
            const ss = Math.max(0, Math.floor((left % 60000) / 1000))
            return (
              <div className={`mr-timer-chip${up ? ' up' : ''}`} role="timer" aria-label="Class timer">
                <Clock size={13} aria-hidden="true" />
                <b>{up ? "Time's up" : `${mm}:${String(ss).padStart(2, '0')}`}</b>
                {timer.label && <span>{timer.label}</span>}
                {isAdmin && (
                  <button onClick={() => patchMeeting(meeting, { timer: null }).catch(() => {})} aria-label="Stop the timer"><X size={13} /></button>
                )}
              </div>
            )
          })()}
          {pickLive && !ended && phase === 'ready' && (
            <div className={`mr-pick-banner${picker.uid === self?.uid ? ' me' : ''}`} role="status">
              <Shuffle size={13} aria-hidden="true" />
              {picker.uid === self?.uid
                ? <span><b>{picker.name}</b> - you're up! Unmute when ready.</span>
                : <span><b>{picker.name}</b>, you're up!</span>}
            </div>
          )}
          {isAdmin && timerOpen && !ended && phase === 'ready' && (
            <div className="mr-poll mr-poll-compose" role="dialog" aria-label="Start a class timer">
              <div className="mr-poll-head">
                <Clock size={15} aria-hidden="true" />
                <b>Class timer</b>
                <button className="mr-diag-x" onClick={() => setTimerOpen(false)} aria-label="Close the timer menu"><X size={15} /></button>
              </div>
              <input
                className="mr-poll-q"
                value={timerLabel}
                onChange={e => setTimerLabel(e.target.value)}
                placeholder="What for? e.g. Solve problems 1-3"
                maxLength={60}
                aria-label="Timer label"
              />
              <div className="mr-poll-presets">
                {[1, 5, 10, 15].map(m => (
                  <button key={m} onClick={() => startTimer(m)}>{m} min</button>
                ))}
              </div>
              <div className="mr-otl-add">
                <input
                  className="mr-poll-q"
                  value={timerMin}
                  onChange={e => setTimerMin(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                  placeholder="Custom minutes"
                  inputMode="numeric"
                  aria-label="Custom minutes"
                  style={{ flex: 1 }}
                />
                <button className="mr-poll-go" style={{ flex: 'none', padding: '9px 16px' }} disabled={!parseInt(timerMin, 10)} onClick={() => startTimer(parseInt(timerMin, 10))}>
                  Start
                </button>
              </div>
              <p className="mr-diag-tip">Everyone sees the countdown; one soft chime for the class when it ends.</p>
            </div>
          )}
          {diagOpen && !ended && phase === 'ready' && (
            <div className="mr-diag" role="dialog" aria-label="Connection details">
              <div className="mr-diag-head">
                <Activity size={15} aria-hidden="true" />
                <b>Your connection: <span className={`mr-diag-${selfQuality}`}>{selfQuality === 'good' ? 'good' : selfQuality === 'weak' ? 'a little weak' : 'struggling'}</span></b>
                <button className="mr-diag-x" onClick={() => setDiagOpen(false)} aria-label="Close connection details"><X size={15} /></button>
              </div>
              {diag && diag.links > 0 ? (
                <div className="mr-diag-rows">
                  <span>Round trip</span><b>{diag.rtt >= 0 ? `${Math.round(diag.rtt * 1000)} ms` : '…'}</b>
                  <span>Packet loss</span><b>{typeof diag.loss === 'number' ? `${diag.loss.toFixed(1)}%` : '…'}</b>
                  <span>Route</span><b>{diag.relay === 0 ? 'Direct' : diag.relay >= diag.links ? 'Relay' : 'Mixed'}</b>
                  <span>Sending</span><b>{diag.sendKbps} kbps</b>
                  <span>Receiving</span><b>{diag.recvKbps} kbps</b>
                </div>
              ) : (
                <p className="mr-diag-tip">No one else is connected yet, so there is nothing to measure.</p>
              )}
              <label className="mr-diag-saver">
                <Zap size={14} aria-hidden="true" />
                <span>Data saver</span>
                <button
                  type="button"
                  className={`mr-pre-swi${dataSaver ? ' on' : ''}`}
                  role="switch"
                  aria-checked={dataSaver}
                  aria-label="Data saver"
                  onClick={() => setDataSaver(!dataSaver)}
                >
                  <i aria-hidden="true" />
                </button>
              </label>
              <p className="mr-diag-tip">
                {diag?.offline ? 'You are offline. Voices will resume when the connection returns.'
                  : selfQuality === 'bad' ? 'Struggling: move closer to a window or your router, or turn on Data saver to keep the audio smooth.'
                  : diag && diag.relay > 0 ? 'Connected through a relay - normal on mobile data, with slightly higher delay.'
                  : 'Everything looks steady.'}
              </p>
            </div>
          )}
          {ready && !ended && (
            <MeetingPoll
              db={db}
              roomId={meeting?.id}
              self={self}
              isAdmin={isAdmin}
              composerOpen={pollComposer}
              onCloseComposer={() => setPollComposer(false)}
              toast={toast}
            />
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
              <b>{joinSlow ? 'Still joining…' : 'Joining the room…'}</b>
              <span>
                {joinSlow
                  ? 'This is taking longer than usual - a weak signal can slow it down. You can keep waiting, retry, or come back later.'
                  : 'Hang tight, your audio and video are being set up.'}
              </span>
              {joinSlow && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm mr-retry-btn" onClick={retry}>Retry join</button>
                  <button className="btn btn-sm" onClick={handleLeave}>Close</button>
                </div>
              )}
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
          ) : phase === 'replaced' ? (
            <div className="mr-center">
              <Users size={30} style={{ color: '#fdd663' }} />
              <b>Joined somewhere else</b>
              <span>You joined this class from another tab or device, so this one left the room. The class continues there.</span>
              <button className="btn btn-sm" onClick={handleLeave}>Close</button>
            </div>
          ) : featuredPeer ? (
            <>
              <div className="mr-present">
                <VideoTile
                  key={`present-${featuredPeer.peerId}`}
                  {...tileProps(featuredPeer)}
                  presentLabel={featuredPeer.sharing ? `${featuredPeer.name} is presenting` : featuredPeer === spotPeer ? `${featuredPeer.name} · spotlight` : undefined}
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
            <span key={f.key} className="mr-float" style={{ left: f.left, top: f.top, '--fdx': `${f.dx || 0}px`, '--frot': `${f.rot || 0}deg` }}>
              <EmojiIcon emoji={f.e} size={28} />
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
                <button onClick={() => { toggleSpot(sheetPeer); setSheetPeer(null) }}>
                  <Star size={16} />
                  {meeting?.spot?.peerId === sheetPeer.peerId ? 'Remove spotlight' : 'Spotlight for the class'}
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
              phone the card itself goes portrait to match the camera frame.
              Draggable to any corner; the arrows button folds it into a small
              handle that reopens it in one tap. Hidden or not, the camera
              keeps sending - only this preview is tucked away. */}
          {ready && pipView.hidden && (
            <button
              className={`mr-pip-handle mr-pos-${pipView.corner}`}
              onClick={() => setPipView(v => ({ ...v, hidden: false }))}
              aria-label="Show your self-view"
              title="Show your self-view"
            >
              <span className="mr-pip-handle-you">You</span>
              {!micOn && <MicOff size={12} aria-hidden="true" />}
              <b aria-hidden="true">&lsaquo;&thinsp;&rsaquo;</b>
            </button>
          )}
          {ready && !pipView.hidden && (
            <div
              ref={pipBoxRef}
              className={`mr-pip mr-pos-${pipView.corner}${isAdmin ? ' mr-pip-lg' : ''}${speaking.has('self') ? ' mr-tile-speaking' : ''}`}
              data-peer="self"
              onPointerDown={onPipDown}
              onPointerMove={onPipMove}
              onPointerUp={onPipUp}
              onPointerCancel={onPipUp}
              style={!sharing && camOn && localStream && selfRatio > 0
                ? (selfRatio < 1
                  ? { width: 'auto', height: isAdmin ? 220 : 150, aspectRatio: String(Math.max(selfRatio, 9 / 16)) }
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
              <button
                className="mr-qdot-btn"
                onClick={() => setDiagOpen(o => !o)}
                title={`${selfQuality === 'good' ? 'Your connection is good' : selfQuality === 'weak' ? 'Your connection is a little weak' : 'Your connection is struggling'} - tap for details`}
                aria-label="Connection details"
              >
                <span className={`mr-qdot mr-qdot-${selfQuality}`} />
              </button>
              <button
                className="mr-pip-hide"
                onClick={() => setPipView(v => ({ ...v, hidden: true }))}
                aria-label="Hide your self-view"
                title="Hide your self-view"
              >
                &rsaquo;&thinsp;&lsaquo;
              </button>
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
          roster={classRoster}
          joinLog={joinLogLive}
          scheduledAt={meeting?.scheduledAt || 0}
          lateThr={lateThr}
          onThrChange={isAdmin ? changeThr : undefined}
          onMute={p => muteStudent(p.peerId)}
          onMuteAll={() => { muteAllStudents(); toast('Muted all students. They can unmute when they need to speak.', 'success') }}
          onRemove={p => setConfirmRemove(p)}
          onLowerHand={p => lowerHand(p.peerId)}
          onClose={() => setPeopleOpen(false)}
        />
        <MeetingOutline
          open={outlineOpen && !ended && ready}
          meeting={meeting}
          isAdmin={isAdmin}
          selfQuality={selfQuality}
          netDown={netDown}
          onOpenDiag={() => setDiagOpen(true)}
          onRetry={reconnectNow}
          lateMin={lateMin}
          onPatch={fields => Promise.resolve(patchMeeting(meeting, fields))
            .then(() => true)
            .catch(() => { toast('Could not save. Check your connection and try again.', 'error'); return false })}
          onClose={() => setOutlineOpen(false)}
        />
        <MeetingQuestions
          open={qqOpen && !ended && ready}
          questions={questions}
          self={self}
          isAdmin={isAdmin}
          onAsk={(text, anon) => rtcAskQuestion(db, meeting.id, { uid: self?.uid, name: self?.name, text, anon })
            .catch(() => toast('Your question did not send. Try again.', 'error'))}
          onPlus={q => rtcPlusQuestion(db, meeting.id, q.id, self?.uid).catch(() => {})}
          onAnswer={q => rtcAnswerQuestion(db, meeting.id, q.id).catch(() => {})}
          onDelete={q => rtcDeleteQuestion(db, meeting.id, q.id).catch(() => {})}
          onClose={() => setQqOpen(false)}
        />
      </div>

      {/* Phone More sheet: every control the compact bar hides, with labels.
          Desktop never opens it (the More button only exists under 560px). */}
      {moreOpen && ready && !ended && (
        <div className="mr-more-scrim" onClick={() => setMoreOpen(false)}>
          <div className="mr-more-sheet" role="menu" aria-label="More controls" onClick={e => e.stopPropagation()}>
            <span className="mr-more-sec">Teach</span>
            <button
              className="mr-more-item"
              onClick={() => { setMoreOpen(false); if (sharing) stopShare(); else if (canShare) startShare(); else toast('Phones and tablets cannot share their screen from the browser - no mobile browser allows it. To present, join the class from a computer using Chrome, Edge, or Safari.', 'error', 6000) }}
            >
              <span className={`mr-ctl${sharing ? ' mr-ctl-on' : ''}${canShare ? '' : ' mr-ctl-dim'}`}><MonitorUp size={18} /></span>
              <span>{sharing ? 'Stop present' : 'Present'}</span>
            </button>
            {isAdmin && (
              <button className="mr-more-item" onClick={() => { setMoreOpen(false); setBoardOpen(true) }}>
                <span className={`mr-ctl${boardOpen ? ' mr-ctl-accent' : ''}`}><Pencil size={18} /></span>
                <span>Whiteboard</span>
              </button>
            )}
            {isAdmin && (
              <button className="mr-more-item" onClick={() => { setMoreOpen(false); setTimerOpen(false); setPollComposer(true) }}>
                <span className="mr-ctl"><BarChart2 size={18} /></span>
                <span>Poll</span>
              </button>
            )}
            {isAdmin && (
              <button className="mr-more-item" onClick={() => { setMoreOpen(false); setPollComposer(false); setTimerOpen(true) }}>
                <span className={`mr-ctl${timerLive ? ' mr-ctl-accent' : ''}`}><Clock size={18} /></span>
                <span>Timer</span>
              </button>
            )}
            {isAdmin && (
              <button className="mr-more-item" onClick={() => { setMoreOpen(false); pickStudent() }}>
                <span className="mr-ctl"><Shuffle size={18} /></span>
                <span>Pick student</span>
              </button>
            )}
            {isAdmin && recordingSupported() && (
              <button
                className="mr-more-item"
                disabled={recState === 'starting' || recState === 'saving'}
                onClick={() => { setMoreOpen(false); if (recState === 'on') stopRecording(false); else startRecording() }}
              >
                <span className={`mr-ctl${recState === 'on' ? ' mr-ctl-rec' : ''}`}>{recState === 'on' ? <Square size={16} /> : <CircleDot size={18} />}</span>
                <span>{recState === 'on' ? 'Stop record' : 'Record'}</span>
              </button>
            )}
            <span className="mr-more-sec">Engage</span>
            {!isAdmin && (
              <button className="mr-more-item" onClick={() => { setMoreOpen(false); toggleHand() }}>
                <span className={`mr-ctl${myHand ? ' mr-ctl-hand' : ''}`}><Hand size={18} /></span>
                <span>{myHand ? 'Lower hand' : 'Raise hand'}</span>
              </button>
            )}
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); setReactOpen(true) }}>
              <span className="mr-ctl"><Smile size={18} /></span>
              <span>React</span>
            </button>
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); setDataSaver(!dataSaver) }}>
              <span className={`mr-ctl${dataSaver ? ' mr-ctl-on' : ''}`}><Zap size={18} /></span>
              <span>{dataSaver ? 'Saver off' : 'Data saver'}</span>
            </button>
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); setDiagOpen(true) }}>
              <span className="mr-ctl"><Activity size={18} /></span>
              <span>Connection</span>
            </button>
            <span className="mr-more-sec">Panels and room</span>
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); setPeopleOpen(false); setOutlineOpen(false); setQqOpen(false); setChatOpen(true) }}>
              <span className="mr-ctl"><MessageSquare size={18} />{unread > 0 && <span className="mr-ctl-badge">{unread > 9 ? '9+' : unread}</span>}</span>
              <span>Chat</span>
            </button>
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); setChatOpen(false); setOutlineOpen(false); setQqOpen(false); setPeopleOpen(true) }}>
              <span className="mr-ctl"><Users size={18} /></span>
              <span>People</span>
            </button>
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); setOtlSeen(true); setChatOpen(false); setPeopleOpen(false); setQqOpen(false); setOutlineOpen(true) }}>
              <span className={`mr-ctl${outlineOpen ? ' mr-ctl-accent' : ''}`}><List size={18} />{otlBadge && <span className="mr-ctl-badge">!</span>}</span>
              <span>Companion</span>
            </button>
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); setChatOpen(false); setPeopleOpen(false); setOutlineOpen(false); setQqOpen(true) }}>
              <span className="mr-ctl"><HelpCircle size={18} />{openQCount > 0 && <span className="mr-ctl-badge">{openQCount > 9 ? '9+' : openQCount}</span>}</span>
              <span>Questions</span>
            </button>
            {canPip && (
              <button className="mr-more-item" onClick={() => { setMoreOpen(false); popOut() }}>
                <span className="mr-ctl"><PictureInPicture2 size={16} /></span>
                <span>Pop out</span>
              </button>
            )}
            <button className="mr-more-item" onClick={() => { setMoreOpen(false); onMinimize?.(true) }}>
              <span className="mr-ctl"><Minimize2 size={16} /></span>
              <span>Minimize</span>
            </button>
          </div>
        </div>
      )}

      <div className="mr-bar">
        <div className="mr-bar-left">
          <span className="mr-clock">{timeStr}</span>
          <span className="mr-sep">|</span>
          <span className="mr-meta">{barLabel}</span>
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
              {/* Device cluster: always visible, leftmost where muscle memory
                  expects the red pair. */}
              <div className="mr-grp">
                <button className={`mr-ctl${micOn ? '' : ' mr-ctl-off'}`} onClick={toggleMic} title={micOn ? 'Mute microphone' : 'Unmute microphone'}>
                  {micOn ? <Mic size={18} /> : <MicOff size={18} />}
                </button>
                <button className={`mr-ctl${camOn ? '' : ' mr-ctl-off'}`} onClick={toggleCam} title={camOn ? 'Turn camera off' : 'Turn camera on'}>
                  {camOn ? <Video size={18} /> : <VideoOff size={18} />}
                </button>
              </div>
              {/* Teach cluster. Present is ALWAYS visible (students share
                  too); no phone or tablet browser can capture the screen, so
                  phones get a dimmed button with an explanation instead of a
                  mysteriously missing one. The Class tools button folds the
                  professor's five tools into one labeled popup; a green dot
                  on it means something inside is running. */}
              <div className="mr-grp mr-grp-x mr-grp-rel">
                <button
                  className={`mr-ctl${sharing ? ' mr-ctl-on' : ''}${canShare ? '' : ' mr-ctl-dim'}`}
                  onClick={sharing ? stopShare : canShare ? startShare : () => toast('Phones and tablets cannot share their screen from the browser - no mobile browser allows it. To present, join the class from a computer using Chrome, Edge, or Safari.', 'error', 6000)}
                  title={sharing ? 'Stop presenting' : canShare ? 'Present your screen' : 'Presenting needs a computer - phone browsers cannot capture the screen'}
                >
                  <MonitorUp size={18} />
                </button>
                {isAdmin && (
                  <button
                    className={`mr-ctl${toolsOpen ? ' mr-ctl-accent' : ''}`}
                    onClick={() => setToolsOpen(o => !o)}
                    title="Class tools: whiteboard, poll, timer, pick a student, record"
                  >
                    <Layers size={18} />
                    {(boardOpen || recState === 'on' || timerLive) && !toolsOpen && <span className="mr-tools-dot" aria-hidden="true" />}
                  </button>
                )}
                {isAdmin && toolsOpen && (
                  <>
                    <div className="mr-tools-scrim" onClick={() => setToolsOpen(false)} />
                    <div className="mr-tools-pop" role="menu" aria-label="Class tools">
                      <button onClick={() => { setToolsOpen(false); setBoardOpen(true) }}>
                        <Pencil size={16} /> Whiteboard{boardOpen && <i className="mr-tools-live" />}
                      </button>
                      <button onClick={() => { setToolsOpen(false); setTimerOpen(false); setPollComposer(true) }}>
                        <BarChart2 size={16} /> Poll
                      </button>
                      <button onClick={() => { setToolsOpen(false); setPollComposer(false); setTimerOpen(true) }}>
                        <Clock size={16} /> Timer{timerLive && <i className="mr-tools-live" />}
                      </button>
                      <button onClick={() => { setToolsOpen(false); pickStudent() }}>
                        <Shuffle size={16} /> Pick a student
                      </button>
                      {recordingSupported() && (
                        <button
                          disabled={recState === 'starting' || recState === 'saving'}
                          onClick={() => { setToolsOpen(false); if (recState === 'on') stopRecording(false); else startRecording() }}
                        >
                          {recState === 'on' ? <Square size={15} /> : <CircleDot size={16} />}
                          {recState === 'on' ? 'Stop recording' : recState === 'saving' ? 'Saving recording…' : 'Record'}
                          {recState === 'on' && <i className="mr-tools-live mr-tools-live-rec" />}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* Engage cluster: the professor never raises a hand (the
                  raised-hands counter on the right covers watching them). */}
              <div className="mr-grp mr-grp-x">
                {!isAdmin && (
                  <button className={`mr-ctl${myHand ? ' mr-ctl-hand' : ''}`} onClick={toggleHand} title={myHand ? 'Lower your hand' : 'Raise your hand'}>
                    <Hand size={18} />
                  </button>
                )}
                <button className={`mr-ctl${reactOpen ? ' mr-ctl-accent' : ''}`} onClick={() => setReactOpen(o => !o)} title="Send a reaction">
                  <Smile size={18} />
                </button>
              </div>
              {/* Panels cluster: badges stay visible at all times. */}
              <div className="mr-grp mr-grp-x">
                <button
                  className={`mr-ctl${chatOpen ? ' mr-ctl-accent' : ''}`}
                  onClick={() => setChatOpen(o => { const n = !o; if (n) { setPeopleOpen(false); setOutlineOpen(false); setQqOpen(false) } return n })}
                  title="In-call messages"
                >
                  <MessageSquare size={18} />
                  {unread > 0 && <span className="mr-ctl-badge">{unread > 9 ? '9+' : unread}</span>}
                </button>
                <button
                  className={`mr-ctl${peopleOpen ? ' mr-ctl-accent' : ''}`}
                  onClick={() => setPeopleOpen(o => { const n = !o; if (n) { setChatOpen(false); setOutlineOpen(false); setQqOpen(false) } return n })}
                  title="People in this class"
                >
                  <Users size={18} />
                </button>
                <button
                  className={`mr-ctl${outlineOpen ? ' mr-ctl-accent' : ''}`}
                  onClick={() => setOutlineOpen(o => { const n = !o; if (n) { setOtlSeen(true); setChatOpen(false); setPeopleOpen(false); setQqOpen(false) } return n })}
                  title="Class companion - agenda, notes, resources"
                >
                  <List size={18} />
                  {otlBadge && <span className="mr-ctl-badge">!</span>}
                </button>
                <button
                  className={`mr-ctl${qqOpen ? ' mr-ctl-accent' : ''}`}
                  onClick={() => setQqOpen(o => { const n = !o; if (n) { setChatOpen(false); setPeopleOpen(false); setOutlineOpen(false) } return n })}
                  title="Class questions - ask without interrupting"
                >
                  <HelpCircle size={18} />
                  {openQCount > 0 && <span className="mr-ctl-badge">{openQCount > 9 ? '9+' : openQCount}</span>}
                </button>
              </div>
              <button
                className={`mr-ctl mr-more-btn${moreOpen ? ' mr-ctl-accent' : ''}`}
                onClick={() => setMoreOpen(o => !o)}
                title="More controls"
              >
                <MoreHorizontal size={18} />
                {unread > 0 && !moreOpen && <span className="mr-ctl-badge">{unread > 9 ? '9+' : unread}</span>}
              </button>
            </>
          )}
          <button className="mr-hang" onClick={handleLeave} title="Leave the class">
            <PhoneOff size={18} />
          </button>
        </div>
        <div className="mr-bar-right">
          {ready && canPip && (
            <button className="mr-ctl mr-ctl-sm mr-ctl-x" onClick={popOut} title="Pop out a floating player (stays on top when you switch apps)">
              <PictureInPicture2 size={16} />
            </button>
          )}
          {ready && (
            <button className="mr-ctl mr-ctl-sm mr-ctl-x" onClick={() => onMinimize?.(true)} title="Minimize - the class keeps running while you use AcadFlow">
              <Minimize2 size={16} />
            </button>
          )}
          {handCount > 0 && (
            <span className="mr-hand-chip" title={handTitle}><Hand size={13} /> {handCount}</span>
          )}
          <button
            type="button"
            className="mr-count"
            onClick={() => setPeopleOpen(o => { const n = !o; if (n) { setChatOpen(false); setOutlineOpen(false); setQqOpen(false) } return n })}
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

  return <>{createPortal(body, document.body)}{boardEl}</>
}
