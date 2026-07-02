// ── useMeetingRoom: the in-app classroom WebRTC engine ──────────────────────
// Full-mesh calls: every participant holds one RTCPeerConnection per other
// participant, with Firestore (src/firebase/rtc.js) as the signaling channel.
// Initiator rule (deterministic, both sides read the same participant docs so
// there is no offer glare): the NEWER joiner sends the offer to everyone who
// was already in the room; ties break on peerId order.
//
// Media notes:
//  - 640x360 camera keeps mesh upload bandwidth sane at the 8-person cap.
//  - Mic/cam toggles flip track.enabled locally and mirror micOn/camOn onto
//    the participant doc so remote tiles can show the right badges.
//  - Screen share swaps the outgoing video track via replaceTrack (no
//    renegotiation needed) and reverts when the browser's Stop-sharing fires.
//  - No TURN server ($0 constraint): a strict-NAT pair may fail to connect;
//    that peer's tile shows a connection warning instead of killing the room.

import { useState, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import {
  RTC_CONFIG, ROOM_CAP, BIG_ROOM, HEARTBEAT_MS, STALE_MS,
  rtcFetchParticipants, rtcJoinRoom, rtcLeaveRoom, rtcUpdateParticipant,
  rtcSendSignal, rtcListenParticipants, rtcListenSignals, rtcAddTranscript,
} from '@/firebase/rtc'
import { speechSupported, startTranscriber, getSpeechLang, setSpeechLang } from '@/utils/transcribe'
import { whisperSupported, startWhisperTranscriber, prewarmWhisper } from '@/utils/whisperTranscribe'

// Total outgoing bandwidth budget for video, split across every connection.
// Keeping video on a hard budget is what keeps VOICE crystal clear: when a
// link degrades, the browser drops video bits, never audio.
const VIDEO_BUDGET = 2_400_000   // camera, all peers combined
const SHARE_BUDGET = 4_800_000   // screen share is worth more bits

// Ask the remote Opus encoder for resilient, speech-tuned audio: in-band FEC
// (recovers lost packets) and a bitrate that favors clarity in small rooms
// without flooding uploads in big ones. DTX (stop sending during silence) is
// applied ONLY past BIG_ROOM, where most mics are muted anyway - its silence
// gate can clip the first syllable after a pause, which the professor hears
// (and records) as words being cut, so small rooms keep the encoder always-on.
// fmtp lines in the sdp WE apply as remote describe what the OTHER side's
// encoder should send us; both peers run this, so both directions get tuned.
function tuneOpus(sdp, roomSize) {
  try {
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/)
    if (!m) return sdp
    const fmtpRe = new RegExp('a=fmtp:' + m[1] + ' (.*)')
    const f = sdp.match(fmtpRe)
    if (!f) return sdp
    let params = f[1]
    const big = roomSize > BIG_ROOM
    const extras = `useinbandfec=1;stereo=0;maxaveragebitrate=${big ? 32000 : 48000}${big ? ';usedtx=1' : ''}`
    for (const kv of extras.split(';')) {
      const key = kv.split('=')[0]
      if (!new RegExp('(^|;)' + key + '=').test(params)) params += ';' + kv
    }
    return sdp.replace(fmtpRe, 'a=fmtp:' + m[1] + ' ' + params)
  } catch { return sdp }
}

// Human-readable reason for a getUserMedia failure, so the room can tell the
// user exactly how to recover instead of a generic "blocked".
function explainGumError(e) {
  const name = e?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera and microphone access was blocked. Click the camera icon in your address bar (or open your browser\'s site settings), allow access, then press Try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera or microphone was found on this device. Plug one in or switch devices, then press Try again.'
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'Your camera or microphone is busy in another app (Zoom, Meet, OBS...). Close it, then press Try again.'
  return 'Could not access your camera or microphone. Check your browser permissions, then press Try again.'
}

export default function useMeetingRoom({ db, roomId, self }) {
  const [phase, setPhase] = useState('connecting') // connecting | ready | full | error | left
  const [errorMsg, setErrorMsg] = useState('')
  const [peers, setPeers] = useState([])
  const [localStream, setLocalStream] = useState(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  // Screen share as a stream, for the meeting recorder's compositor.
  const [screenStream, setScreenStream] = useState(null)
  // Silent transcription language (per device); segments feed the Smart Recap.
  const [transcribeLang, setTranscribeLangState] = useState(() => getSpeechLang())
  const langRef = useRef(transcribeLang)
  // Bumping this remounts the whole engine - used by Try again after a
  // permission error (the browser re-prompts on the fresh getUserMedia call).
  const [attempt, setAttempt] = useState(0)
  const apiRef = useRef({})
  const selfRef = useRef(self)
  selfRef.current = self

  useEffect(() => {
    if (!db || !roomId) return
    // Fresh attempt: reset everything a previous failed try may have left.
    setPhase('connecting')
    setErrorMsg('')
    setPeers([])
    setLocalStream(null)
    setMicOn(true)
    setCamOn(true)
    setSharing(false)
    setScreenStream(null)
    let dead = false
    const myId = uuidv4()
    const pcs = new Map()          // peerId -> RTCPeerConnection
    const streams = new Map()      // peerId -> MediaStream
    const connState = new Map()    // peerId -> RTCPeerConnection.connectionState
    const pendingIce = new Map()   // peerId -> [candidateJSON] queued pre-remoteDescription
    const videoSenders = new Map() // peerId -> RTCRtpSender for the outgoing video slot
    const initiated = new Set()
    let roster = []
    let myJoinedAt = 0
    let local = null
    let screenTrack = null
    let heartbeat = null
    let transcriber = null
    const unsubs = []

    // ── Silent transcription of MY OWN speech (never displayed in-meeting;
    // it builds the class transcript the Smart Recap summarizes). Runs only
    // while the mic is live - the recognizer would otherwise keep hearing a
    // muted speaker.
    //
    // Two engines, picked automatically:
    //  1. The browser's SpeechRecognition (free, live). It opens its OWN mic
    //     capture, and on plenty of systems it goes silently deaf while
    //     WebRTC already holds the microphone (Firefox has no engine at all).
    //  2. On-device Whisper (utils/whisperTranscribe, CDN) reading the SAME
    //     stream the meeting captured - it cannot go deaf.
    // A watchdog meters actual speech energy on the local stream; once ~15s
    // of real speech produced zero recognition events, this session switches
    // to Whisper for good (prewarming the model at the first sign of trouble).
    let whisperMode = !speechSupported() // engine choice for THIS session
    let watchdog = null
    let meter = null
    let deafVoicedMs = 0

    function makeMeter(stream) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC || !stream.getAudioTracks().length) return null
        const ac = new AC()
        const an = ac.createAnalyser()
        an.fftSize = 512
        ac.createMediaStreamSource(stream).connect(an)
        ac.resume().catch(() => { /* resumes on gesture */ })
        const buf = new Uint8Array(an.fftSize)
        return {
          rms() {
            an.getByteTimeDomainData(buf)
            let s = 0
            for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; s += d * d }
            return Math.sqrt(s / buf.length)
          },
          close() { try { ac.close() } catch { /* noop */ } },
        }
      } catch { return null }
    }

    function transcriptSink() {
      const s = selfRef.current || {}
      return text => {
        rtcAddTranscript(db, roomId, {
          at: Date.now(), uid: s.uid || '', name: s.name || 'Participant',
          role: s.role || 'student', lang: langRef.current, text,
        }).catch(() => { /* transcript is best-effort */ })
      }
    }

    function stopWatchdog() {
      if (watchdog) { clearInterval(watchdog); watchdog = null }
      deafVoicedMs = 0
    }

    function switchToWhisper() {
      if (whisperMode) return
      whisperMode = true
      stopTranscription()
      startTranscription()
    }

    function startWatchdog() {
      if (watchdog || dead) return
      if (!meter && local) meter = makeMeter(local)
      if (!meter) return // cannot meter - keep Web Speech and hope
      deafVoicedMs = 0
      watchdog = setInterval(() => {
        if (dead || !transcriber) return
        const track = local && local.getAudioTracks()[0]
        if (!track || !track.enabled) return
        if (meter.rms() >= 0.02) deafVoicedMs += 1000
        if (deafVoicedMs >= 5000 && whisperSupported()) prewarmWhisper()
        if (deafVoicedMs >= 15000 && whisperSupported()) switchToWhisper()
      }, 1000)
    }

    function startTranscription() {
      if (transcriber || dead) return
      if (whisperMode) {
        transcriber = startWhisperTranscriber({
          stream: local, lang: langRef.current, onFlush: transcriptSink(),
        })
        stopWatchdog() // whisper reads our own stream; nothing to watch
        return
      }
      if (!speechSupported()) return
      transcriber = startTranscriber({
        lang: langRef.current,
        onFlush: transcriptSink(),
        onResult: () => { deafVoicedMs = 0 }, // any event = the engine hears
      })
      startWatchdog()
    }
    function stopTranscription() {
      stopWatchdog()
      if (!transcriber) return
      transcriber.stop() // flushes any buffered speech first
      transcriber = null
    }

    const send = (to, type, data) =>
      rtcSendSignal(db, roomId, { to, from: myId, type, data }).catch(() => {})

    function publish() {
      if (dead) return
      const now = Date.now()
      setPeers(roster
        .filter(p => p.peerId !== myId && now - (p.lastSeen || 0) < STALE_MS)
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
        .map(p => ({
          ...p,
          stream: streams.get(p.peerId) || null,
          connState: connState.get(p.peerId) || 'new',
        })))
    }

    function closePeer(peerId) {
      const pc = pcs.get(peerId)
      if (pc) { try { pc.close() } catch { /* already closed */ } }
      pcs.delete(peerId)
      streams.delete(peerId)
      connState.delete(peerId)
      pendingIce.delete(peerId)
      initiated.delete(peerId)
      videoSenders.delete(peerId)
      applyMediaBudget()
    }

    // Split the video budget across every connection and pin audio at high
    // network priority. Re-applied whenever the room size or share state
    // changes, and once per connection when it reaches 'connected' (encoder
    // parameters only stick after negotiation).
    function applyMediaBudget() {
      const n = Math.max(1, pcs.size)
      const camBits = Math.round(Math.min(350_000, Math.max(60_000, VIDEO_BUDGET / n)))
      const shareBits = Math.round(Math.min(1_200_000, Math.max(120_000, SHARE_BUDGET / n)))
      const scale = screenTrack ? 1 : (n > 16 ? 4 : n > 6 ? 2 : 1)
      for (const sender of videoSenders.values()) {
        try {
          const p = sender.getParameters()
          if (!p.encodings || !p.encodings.length) continue // pre-negotiation
          p.encodings[0].maxBitrate = screenTrack ? shareBits : camBits
          p.encodings[0].scaleResolutionDownBy = scale
          sender.setParameters(p).catch(() => {})
        } catch { /* renegotiating */ }
      }
      for (const pc of pcs.values()) {
        for (const s of pc.getSenders()) {
          if (!s.track || s.track.kind !== 'audio') continue
          try {
            const p = s.getParameters()
            if (!p.encodings || !p.encodings.length) continue
            p.encodings[0].priority = 'high'
            p.encodings[0].networkPriority = 'high'
            s.setParameters(p).catch(() => {})
          } catch { /* renegotiating */ }
        }
      }
    }

    function makePc(peerId) {
      const pc = new RTCPeerConnection(RTC_CONFIG)
      pcs.set(peerId, pc)
      let vSender = null
      if (local) for (const t of local.getTracks()) {
        const s = pc.addTrack(t, local)
        if (t.kind === 'video') vSender = s
      }
      // Audio-only joiners (camera blocked/missing) still get a negotiated
      // video slot, so a later screen share can replaceTrack into it without
      // any renegotiation. Without this, their "Present" button sent nothing.
      if (!vSender) {
        try { vSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender } catch { /* very old browser */ }
      }
      if (vSender) videoSenders.set(peerId, vSender)
      // If a share is already running, the new peer should get the screen.
      if (screenTrack && vSender) vSender.replaceTrack(screenTrack).catch(() => {})
      pc.onicecandidate = e => { if (e.candidate) send(peerId, 'ice', e.candidate.toJSON()) }
      pc.ontrack = e => {
        if (e.streams && e.streams[0]) { streams.set(peerId, e.streams[0]); publish() }
      }
      pc.onconnectionstatechange = () => {
        connState.set(peerId, pc.connectionState)
        if (pc.connectionState === 'connected') applyMediaBudget()
        publish()
      }
      return pc
    }

    async function initiate(peerId) {
      if (initiated.has(peerId) || pcs.has(peerId)) return
      initiated.add(peerId)
      const pc = makePc(peerId)
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        send(peerId, 'offer', pc.localDescription.toJSON())
      } catch { connState.set(peerId, 'failed'); publish() }
    }

    async function flushIce(peerId) {
      const pc = pcs.get(peerId)
      const queued = pendingIce.get(peerId) || []
      pendingIce.delete(peerId)
      for (const c of queued) { try { await pc.addIceCandidate(c) } catch { /* stale candidate */ } }
    }

    async function onSignal(msg) {
      if (dead) return
      const from = msg.from
      if (msg.type === 'offer') {
        const pc = pcs.get(from) || makePc(from)
        await pc.setRemoteDescription({ ...msg.data, sdp: tuneOpus(msg.data.sdp, pcs.size) })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send(from, 'answer', pc.localDescription.toJSON())
        await flushIce(from)
      } else if (msg.type === 'answer') {
        const pc = pcs.get(from)
        if (pc) { await pc.setRemoteDescription({ ...msg.data, sdp: tuneOpus(msg.data.sdp, pcs.size) }); await flushIce(from) }
      } else if (msg.type === 'ice') {
        const pc = pcs.get(from)
        if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(msg.data) } catch { /* stale */ } }
        else pendingIce.set(from, [...(pendingIce.get(from) || []), msg.data])
      }
    }

    function onRoster(list) {
      if (dead) return
      roster = list
      const now = Date.now()
      const alive = list.filter(p => now - (p.lastSeen || 0) < STALE_MS)
      // Deterministic overflow: order everyone by join time; whoever lands
      // past the cap leaves on their own (covers two people joining seat 8
      // at once - both order the same list, only the later one bails).
      const me = alive.find(p => p.peerId === myId)
      if (me) {
        const idx = alive
          .slice()
          .sort((a, b) => (a.joinedAt - b.joinedAt) || (a.peerId < b.peerId ? -1 : 1))
          .findIndex(p => p.peerId === myId)
        if (idx >= ROOM_CAP) { teardown(); setPhase('full'); return }
      }
      for (const p of alive) {
        if (p.peerId === myId || pcs.has(p.peerId)) continue
        // Newer joiner initiates; both sides compare the same doc values.
        const iAmNewer = (p.joinedAt < myJoinedAt)
          || (p.joinedAt === myJoinedAt && p.peerId < myId)
        if (iAmNewer) initiate(p.peerId)
      }
      // Peers that left (doc deleted) get torn down; stale ones are hidden by
      // publish() and torn down once their doc disappears or on room end.
      const ids = new Set(list.map(p => p.peerId))
      for (const peerId of [...pcs.keys()]) if (!ids.has(peerId)) closePeer(peerId)
      publish()
    }

    function teardown() {
      stopTranscription()
      if (meter) { meter.close(); meter = null }
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
      unsubs.splice(0).forEach(u => { try { u() } catch { /* noop */ } })
      for (const peerId of [...pcs.keys()]) closePeer(peerId)
      if (screenTrack) { try { screenTrack.stop() } catch { /* noop */ } screenTrack = null }
      if (local) { local.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } }); local = null }
      rtcLeaveRoom(db, roomId, myId)
      window.removeEventListener('pagehide', onPageHide)
    }

    function onPageHide() { rtcLeaveRoom(db, roomId, myId) }

    async function start() {
      // Camera + mic; degrade to audio-only (camera busy/denied) before failing.
      let camOk = true
      const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      try {
        local = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
          audio: AUDIO,
        })
      } catch {
        camOk = false
        try {
          local = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
        } catch (e2) {
          if (!dead) { setPhase('error'); setErrorMsg(explainGumError(e2)) }
          return
        }
      }
      if (dead) { local.getTracks().forEach(t => t.stop()); return }
      // Content hints steer the encoders: speech-optimized audio, motion-
      // optimized camera (the screen track gets 'detail' when sharing).
      try {
        const mic = local.getAudioTracks()[0]
        if (mic) mic.contentHint = 'speech'
        const cam = local.getVideoTracks()[0]
        if (cam) cam.contentHint = 'motion'
      } catch { /* hints are advisory */ }
      setLocalStream(local)
      setCamOn(camOk)

      // Join-time cap check (the roster listener re-checks deterministically).
      try {
        const existing = await rtcFetchParticipants(db, roomId)
        const now = Date.now()
        const aliveCount = existing.filter(p => now - (p.lastSeen || 0) < STALE_MS).length
        if (aliveCount >= ROOM_CAP) {
          local.getTracks().forEach(t => t.stop()); local = null
          if (!dead) setPhase('full')
          return
        }
        const s = selfRef.current || {}
        // Lecture etiquette at scale: past BIG_ROOM people, students come in
        // muted with the camera off (one tap turns either back on). This is
        // also what makes a 60-person mesh viable - idle listeners upload
        // almost nothing (muted Opus + DTX), so the professor's voice and
        // screen get the bandwidth.
        const quiet = aliveCount >= BIG_ROOM && s.role !== 'admin'
        if (quiet) {
          for (const t of local.getTracks()) t.enabled = false
          setMicOn(false)
          setCamOn(false)
        }
        const me = await rtcJoinRoom(db, roomId, {
          peerId: myId, uid: s.uid, name: s.name, role: s.role,
          micOn: !quiet, camOn: quiet ? false : camOk,
        })
        myJoinedAt = me.joinedAt
      } catch {
        if (local) local.getTracks().forEach(t => t.stop())
        if (!dead) { setPhase('error'); setErrorMsg('Could not join the room. Check your connection and try again.') }
        return
      }
      if (dead) { teardown(); return }

      unsubs.push(rtcListenParticipants(db, roomId, onRoster))
      unsubs.push(rtcListenSignals(db, roomId, myId, onSignal))
      heartbeat = setInterval(() => {
        rtcUpdateParticipant(db, roomId, myId, {})
        publish() // re-evaluate staleness on a clock, not only on snapshots
      }, HEARTBEAT_MS)
      window.addEventListener('pagehide', onPageHide)
      const micLive = local.getAudioTracks()[0]?.enabled
      if (micLive) startTranscription()
      setPhase('ready')
    }

    apiRef.current = {
      toggleMic() {
        if (!local) return
        const t = local.getAudioTracks()[0]
        if (!t) return
        t.enabled = !t.enabled
        setMicOn(t.enabled)
        if (t.enabled) startTranscription()
        else stopTranscription()
        rtcUpdateParticipant(db, roomId, myId, { micOn: t.enabled })
      },
      toggleCam() {
        if (!local) return
        const t = local.getVideoTracks()[0]
        if (!t) return
        t.enabled = !t.enabled
        setCamOn(t.enabled)
        rtcUpdateParticipant(db, roomId, myId, { camOn: t.enabled })
      },
      async startShare() {
        if (screenTrack || !navigator.mediaDevices?.getDisplayMedia) return
        let ds
        try { ds = await navigator.mediaDevices.getDisplayMedia({ video: true }) }
        catch { return } // picker dismissed
        screenTrack = ds.getVideoTracks()[0]
        if (!screenTrack) return
        try { screenTrack.contentHint = 'detail' } catch { /* advisory */ }
        for (const sender of videoSenders.values()) sender.replaceTrack(screenTrack).catch(() => {})
        applyMediaBudget()
        screenTrack.onended = () => apiRef.current.stopShare()
        setScreenStream(new MediaStream([screenTrack]))
        setSharing(true)
        // sharedAt lets everyone feature the LATEST presenter when two people
        // share at once (Meet behavior).
        rtcUpdateParticipant(db, roomId, myId, { sharing: true, sharedAt: Date.now() })
      },
      stopShare() {
        if (!screenTrack) return
        try { screenTrack.stop() } catch { /* noop */ }
        screenTrack = null
        const cam = local && local.getVideoTracks()[0]
        for (const sender of videoSenders.values()) sender.replaceTrack(cam || null).catch(() => {})
        applyMediaBudget()
        setScreenStream(null)
        setSharing(false)
        rtcUpdateParticipant(db, roomId, myId, { sharing: false })
      },
      setTranscribeLang(code) {
        if (!code) return
        setSpeechLang(code)
        langRef.current = code
        setTranscribeLangState(code)
        // Restart the recognizer in the new language if it is running.
        if (transcriber) { stopTranscription(); startTranscription() }
      },
      setRecordingFlag(on) {
        // Everyone's roster shows the REC pill off the professor's doc.
        rtcUpdateParticipant(db, roomId, myId, { recording: !!on, recStartAt: on ? Date.now() : null })
      },
      leave() {
        teardown()
        setPhase('left')
      },
    }

    start()
    return () => { dead = true; teardown() }
  }, [db, roomId, attempt])

  return {
    phase, errorMsg, peers, localStream, micOn, camOn, sharing, screenStream, transcribeLang,
    toggleMic: () => apiRef.current.toggleMic?.(),
    toggleCam: () => apiRef.current.toggleCam?.(),
    startShare: () => apiRef.current.startShare?.(),
    stopShare: () => apiRef.current.stopShare?.(),
    leave: () => apiRef.current.leave?.(),
    retry: () => setAttempt(a => a + 1),
    setTranscribeLang: code => apiRef.current.setTranscribeLang?.(code),
    setRecordingFlag: on => apiRef.current.setRecordingFlag?.(on),
    canShare: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
    speechOk: speechSupported() || whisperSupported(), // either engine can transcribe
  }
}
