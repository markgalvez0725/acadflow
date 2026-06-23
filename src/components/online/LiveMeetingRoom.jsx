import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, Hand, MessageSquare,
  Users, PhoneOff, Radio, Clock, Loader2, AlertTriangle,
} from 'lucide-react'
import { loadJitsi, meetingRoomName, JITSI_DOMAIN } from '@/utils/jitsi'

// Immersive, embedded video room for an online class. The middle video grid is
// a Jitsi Meet iframe (real audio/video/screen-share); the surrounding chrome —
// header, joined banner and control bar — is ours, mirroring the app's preview
// design. Native Jitsi toolbar is hidden so every control routes through here.
export default function LiveMeetingRoom({ meeting, displayName, email, isHost = false, subtitle, onLeave, onEnd }) {
  const holderRef = useRef(null)
  const apiRef = useRef(null)
  const timerRef = useRef(null)
  // Leaving can be signalled twice (our hangup + Jitsi's readyToClose); resolve
  // exactly once. Callbacks are read through refs so the latest closures run.
  // `ended` chooses onEnd (close the class for everyone) vs onLeave (just exit).
  const onLeaveRef = useRef(onLeave); onLeaveRef.current = onLeave
  const onEndRef = useRef(onEnd); onEndRef.current = onEnd
  const leftRef = useRef(false)
  const finish = (ended) => {
    if (leftRef.current) return
    leftRef.current = true
    if (ended && onEndRef.current) onEndRef.current()
    else onLeaveRef.current?.()
  }

  const [phase, setPhase] = useState('loading') // loading | joined | error
  const [error, setError] = useState('')
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(isHost)
  const [sharing, setSharing] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [count, setCount] = useState(1)
  const [secs, setSecs] = useState(0)
  // `reveal` uncovers the Jitsi iframe even before we've fully joined, so its
  // own prejoin / "waiting for host" / sign-in screens are never hidden behind
  // our loading overlay (which would otherwise trap the user on "Connecting…").
  const [reveal, setReveal] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false) // host Leave/End chooser

  useEffect(() => {
    let disposed = false
    let api = null
    let revealTimer = null

    loadJitsi().then((JitsiMeetExternalAPI) => {
      if (disposed || !holderRef.current) return
      api = new JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName: meetingRoomName(meeting),
        parentNode: holderRef.current,
        userInfo: { displayName: displayName || 'Guest', email: email || undefined },
        configOverwrite: {
          prejoinPageEnabled: false,            // legacy key
          prejoinConfig: { enabled: false },    // current key — skip the prejoin screen
          disableDeepLinking: true,
          startWithAudioMuted: false,
          startWithVideoMuted: !isHost,
          toolbarButtons: [], // hide Jitsi's own toolbar — we render our own
        },
        interfaceConfigOverwrite: {
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
          MOBILE_APP_PROMO: false,
        },
      })
      apiRef.current = api

      const syncCount = () => { try { setCount(api.getNumberOfParticipants() || 1) } catch (e) { /* ignore */ } }

      api.addEventListener('videoConferenceJoined', () => {
        if (disposed) return
        setPhase('joined')
        setReveal(true)
        syncCount()
        timerRef.current = setInterval(() => setSecs(s => s + 1), 1000)
      })
      // Safety net: if joining stalls (prejoin/lobby/sign-in, or a slow server),
      // uncover the Jitsi UI after a few seconds so the user can act on it.
      revealTimer = setTimeout(() => { if (!disposed) setReveal(true) }, 4500)
      api.addEventListener('participantJoined', syncCount)
      api.addEventListener('participantLeft', syncCount)
      api.addEventListener('audioMuteStatusChanged', e => setMicOn(!e.muted))
      api.addEventListener('videoMuteStatusChanged', e => setCamOn(!e.muted))
      api.addEventListener('screenSharingStatusChanged', e => setSharing(!!e.on))
      api.addEventListener('raiseHandUpdated', e => {
        // Fires for every participant; only reflect our own hand state.
        try { if (e.id === api._myUserID || e.id === api.getMyUserId?.()) setHandRaised(!!e.handRaised) } catch (err) { /* ignore */ }
      })
      api.addEventListener('readyToClose', () => { if (!disposed) finish(false) })
    }).catch(err => {
      if (disposed) return
      setError(err?.message || 'Could not start the video room.')
      setPhase('error')
    })

    return () => {
      disposed = true
      if (timerRef.current) clearInterval(timerRef.current)
      if (revealTimer) clearTimeout(revealTimer)
      try { api?.dispose() } catch (e) { /* ignore */ }
      apiRef.current = null
    }
  }, [meeting?.id])

  function cmd(name) { try { apiRef.current?.executeCommand(name) } catch (e) { /* ignore */ } }
  // Disconnect from Jitsi and resolve. `ended` is host-only: it ends the class
  // for everyone. We resolve synchronously so the guard wins over readyToClose.
  function doLeave(ended) {
    cmd('hangup')
    finish(ended)
  }
  function onLeaveClick() {
    if (isHost) setConfirmEnd(true) // host picks Leave vs End for everyone
    else doLeave(false)
  }

  const elapsed = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
  const sub = subtitle || meeting?.className || 'Online class'

  return createPortal(
    <div style={S.overlay} role="dialog" aria-modal="true" aria-label={`Live class: ${meeting?.title || ''}`}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={S.title}>{meeting?.title || 'Online class'}</div>
          <div style={S.subtitle}>{sub}{meeting?.subject ? ` · ${meeting.subject}` : ''} · {count} in call</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={S.livePill}><Radio size={12} /> LIVE</span>
          <span style={S.timer}><Clock size={14} /> {elapsed}</span>
        </div>
      </div>

      {/* Video stage (Jitsi iframe mounts here) */}
      <div style={S.stage}>
        <div ref={holderRef} style={{ position: 'absolute', inset: 0 }} />
        {phase === 'error' ? (
          <div style={S.stageOverlay}>
            <AlertTriangle size={34} style={{ color: '#f59e0b' }} />
            <div style={{ marginTop: 10, fontSize: 14 }}>{error}</div>
            <button style={{ ...S.ctrlPill, marginTop: 16 }} onClick={() => onLeave?.()}>Close</button>
          </div>
        ) : (phase !== 'joined' && !reveal) ? (
          // Non-blocking: pointer-events none so any prejoin/sign-in button
          // underneath stays clickable; auto-clears via `reveal`.
          <div style={{ ...S.stageOverlay, pointerEvents: 'none' }}>
            <Loader2 size={32} className="animate-spin" />
            <div style={{ marginTop: 10, fontSize: 14, opacity: .8 }}>Connecting you to the class…</div>
          </div>
        ) : null}
      </div>

      {/* Joined status banner */}
      {phase === 'joined' && (
        <div style={S.banner}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          You joined the meeting · mic is {micOn ? 'on' : 'off'}, camera is {camOn ? 'on' : 'off'}{sharing ? ' · sharing your screen' : ''}
        </div>
      )}

      {/* Control bar */}
      <div style={S.controls}>
        <Ctrl on={micOn} danger={!micOn} onClick={() => cmd('toggleAudio')} label={micOn ? 'Mute microphone' : 'Unmute microphone'}>
          {micOn ? <Mic size={19} /> : <MicOff size={19} />}
        </Ctrl>
        <Ctrl on={camOn} danger={!camOn} onClick={() => cmd('toggleVideo')} label={camOn ? 'Turn off camera' : 'Turn on camera'}>
          {camOn ? <Video size={19} /> : <VideoOff size={19} />}
        </Ctrl>
        <Ctrl on={sharing} active={sharing} onClick={() => cmd('toggleShareScreen')} label={sharing ? 'Stop sharing screen' : 'Share your screen'}>
          <MonitorUp size={19} />
        </Ctrl>
        <Ctrl active={handRaised} onClick={() => cmd('toggleRaiseHand')} label="Raise hand">
          <Hand size={19} />
        </Ctrl>
        <Ctrl onClick={() => cmd('toggleChat')} label="Open chat">
          <MessageSquare size={19} />
        </Ctrl>
        <Ctrl onClick={() => cmd('toggleParticipantsPane')} label="Participants">
          <Users size={19} />
        </Ctrl>
        <button style={S.leave} onClick={onLeaveClick} aria-label="Leave meeting">
          <PhoneOff size={18} /> Leave
        </button>
      </div>

      {/* Host-only chooser: step out, or end the class for everyone */}
      {confirmEnd && (
        <div style={S.confirmBackdrop} onClick={() => setConfirmEnd(false)}>
          <div style={S.confirmCard} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Leave or end class">
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Leave the class?</div>
            <div style={{ fontSize: 13, color: '#9aa6b6', lineHeight: 1.5, marginBottom: 18 }}>
              End it for everyone, or step out and keep the class running for your students.
            </div>
            <button style={S.confirmDanger} onClick={() => { setConfirmEnd(false); doLeave(true) }}>
              <VideoOff size={16} /> End class for everyone
            </button>
            <button style={S.confirmGhost} onClick={() => { setConfirmEnd(false); doLeave(false) }}>
              <PhoneOff size={16} /> Leave, keep class running
            </button>
            <button style={S.confirmCancel} onClick={() => setConfirmEnd(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

function Ctrl({ children, onClick, label, on, active, danger }) {
  const bg = danger ? 'rgba(239,68,68,.18)' : active ? 'rgba(59,130,246,.22)' : 'rgba(255,255,255,.08)'
  const color = danger ? '#fca5a5' : active ? '#93c5fd' : '#e8edf4'
  const border = danger ? '1px solid rgba(239,68,68,.5)' : active ? '1px solid rgba(59,130,246,.55)' : '1px solid rgba(255,255,255,.14)'
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ width: 46, height: 46, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: bg, color, border }}
    >
      {children}
    </button>
  )
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, background: '#0d1117',
    display: 'flex', flexDirection: 'column', color: '#e8edf4',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
    borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: 0,
  },
  title: { fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  subtitle: { fontSize: 12, color: '#9aa6b6', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  livePill: { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(239,68,68,.16)', color: '#fca5a5', fontSize: 12, fontWeight: 700, letterSpacing: '.05em', padding: '4px 10px', borderRadius: 999 },
  timer: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9aa6b6' },
  stage: { position: 'relative', flex: 1, minHeight: 0, background: '#000' },
  stageOverlay: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#e8edf4', background: '#0d1117' },
  banner: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 14px', fontSize: 12, color: '#86efac', background: 'rgba(34,197,94,.10)', borderTop: '1px solid rgba(34,197,94,.18)', flexShrink: 0 },
  controls: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 14px calc(env(safe-area-inset-bottom) + 12px)', borderTop: '1px solid rgba(255,255,255,.08)', flexShrink: 0, flexWrap: 'wrap' },
  ctrlPill: { padding: '8px 16px', borderRadius: 999, background: 'rgba(255,255,255,.1)', color: '#e8edf4', border: '1px solid rgba(255,255,255,.2)', cursor: 'pointer' },
  leave: { height: 46, padding: '0 20px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ef4444', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  confirmBackdrop: { position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  confirmCard: { width: '100%', maxWidth: 360, background: '#161b22', border: '1px solid rgba(255,255,255,.10)', borderRadius: 16, padding: '20px 20px 16px', color: '#e8edf4', boxShadow: '0 20px 60px rgba(0,0,0,.5)' },
  confirmDanger: { width: '100%', height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 8 },
  confirmGhost: { width: '100%', height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(255,255,255,.08)', color: '#e8edf4', border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer', marginBottom: 8 },
  confirmCancel: { width: '100%', height: 38, background: 'none', color: '#9aa6b6', border: 'none', fontSize: 13, cursor: 'pointer' },
}
