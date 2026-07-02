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
  RTC_CONFIG, ROOM_CAP, BIG_ROOM, HEARTBEAT_MS, STALE_MS, STALE_FAST_MS,
  rtcFetchParticipants, rtcJoinRoom, rtcLeaveRoom, rtcLeaveBeacon,
  rtcUpdateParticipant, rtcSendSignal, rtcListenParticipants,
  rtcListenSignals,
} from '@/firebase/rtc'
import { getIdToken } from '@/firebase/firebaseInit'

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
    let presence = null
    let leaving = false
    let rejoining = false
    let cachedToken = ''       // for the pagehide leave beacon (fetch keepalive)
    const seenLocal = new Map() // peerId -> { sig, at }: OUR clock when their heartbeat last changed
    const joinStamp = new Map() // peerId -> joinedAt we built the pc against
    const swept = new Set()     // ghost docs this device already deleted
    let aliveSig = ''
    const unsubs = []

    const send = (to, type, data) =>
      rtcSendSignal(db, roomId, { to, from: myId, type, data }).catch(() => {})

    // ── Presence, judged on OUR clock ─────────────────────────────────────
    // How long ago did *I* last see this peer's heartbeat value change?
    // Comparing Date.now() with the peer's own lastSeen (their clock) broke
    // on skewed device clocks: a crashed device whose clock ran fast looked
    // alive forever - the "left the meeting but still shown there" ghost.
    function seenAge(peerId) {
      const rec = seenLocal.get(peerId)
      return rec ? Date.now() - rec.at : 0
    }
    function isGone(p) {
      const age = seenAge(p.peerId)
      if (age >= STALE_MS) return true
      // Dead link + quiet heartbeat = gone early. NAT-blocked peers who are
      // really present keep heartbeating, so this never evicts them.
      const cs = connState.get(p.peerId)
      return age >= STALE_FAST_MS && (cs === 'disconnected' || cs === 'failed' || cs === 'closed')
    }

    function publish() {
      if (dead) return
      const shown = roster.filter(p => p.peerId !== myId && !isGone(p))
      aliveSig = shown.map(p => p.peerId).sort().join(',')
      setPeers(shown
        .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
        .map(p => ({
          ...p,
          stream: streams.get(p.peerId) || null,
          connState: connState.get(p.peerId) || 'new',
        })))
    }

    // Runs every few seconds: hides peers the moment they cross the stale
    // line (snapshots alone cannot do that - a vanished peer stops producing
    // them), and the OLDEST alive participant (usually the professor) also
    // DELETES ghost docs so Firestore matches reality for everyone,
    // including future joiners. Firestore has no onDisconnect; this sweep is
    // what actually removes a killed tab from the room.
    function presenceTick() {
      if (dead) return
      if (myJoinedAt && !leaving && !roster.some(p => p.peerId === myId)) { rejoin(); return }
      const sig = roster.filter(p => p.peerId !== myId && !isGone(p)).map(p => p.peerId).sort().join(',')
      if (sig !== aliveSig) publish()
      const alive = roster.filter(p => !isGone(p))
      const sweeper = alive.slice()
        .sort((a, b) => (a.joinedAt - b.joinedAt) || (a.peerId < b.peerId ? -1 : 1))[0]
      if (!sweeper || sweeper.peerId !== myId) return
      for (const p of roster) {
        if (p.peerId === myId || swept.has(p.peerId)) continue
        if (seenAge(p.peerId) >= STALE_MS + 10000) {
          swept.add(p.peerId)
          rtcLeaveRoom(db, roomId, p.peerId) // idempotent; also drops their queued signals
        }
      }
    }

    // My own doc vanished while I am still live: I was swept as a ghost
    // (laptop lid closed, long network drop). Re-insert myself and rebuild
    // every connection - without this, the swept side stayed in a room
    // nobody else could see or hear.
    async function rejoin() {
      if (dead || leaving || rejoining) return
      rejoining = true
      try {
        for (const peerId of [...pcs.keys()]) closePeer(peerId)
        swept.clear()
        const s = selfRef.current || {}
        const me = await rtcJoinRoom(db, roomId, {
          peerId: myId, uid: s.uid, name: s.name, role: s.role,
          micOn: !!(local && local.getAudioTracks()[0] && local.getAudioTracks()[0].enabled),
          camOn: !!(local && local.getVideoTracks()[0] && local.getVideoTracks()[0].enabled),
        })
        myJoinedAt = me.joinedAt
        // Left while the rejoin write was in flight: take the doc back out
        // so the re-insert does not become the very ghost this fixes.
        if (dead || leaving) { rtcLeaveRoom(db, roomId, myId); return }
        // A rejoining presenter keeps presenting (the fresh doc reset it).
        if (screenTrack) rtcUpdateParticipant(db, roomId, myId, { sharing: true, sharedAt: Date.now() })
      } catch { /* the next presence tick retries */ }
      rejoining = false
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
      // Stamp receipt times BEFORE any filtering: presence is judged on when
      // WE saw each heartbeat value change (see seenAge above).
      for (const p of list) {
        const rec = seenLocal.get(p.peerId)
        if (!rec || rec.sig !== p.lastSeen) seenLocal.set(p.peerId, { sig: p.lastSeen, at: now })
      }
      for (const id of [...seenLocal.keys()]) {
        if (!list.some(p => p.peerId === id)) seenLocal.delete(id)
      }
      if (myJoinedAt && !leaving && !list.some(p => p.peerId === myId)) { rejoin(); return }
      // A peer that REJOINED (fresh joinedAt, e.g. after being swept) needs
      // fresh connections: drop the dead pc so the initiator rule re-runs
      // for the new incarnation instead of feeding offers to a closed pc.
      for (const p of list) {
        if (p.peerId === myId) continue
        const known = joinStamp.get(p.peerId)
        if (known !== undefined && known !== p.joinedAt) closePeer(p.peerId)
        joinStamp.set(p.peerId, p.joinedAt)
      }
      for (const id of [...joinStamp.keys()]) {
        if (!list.some(p => p.peerId === id)) joinStamp.delete(id)
      }
      const alive = list.filter(p => !isGone(p))
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
      leaving = true
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
      if (presence) { clearInterval(presence); presence = null }
      unsubs.splice(0).forEach(u => { try { u() } catch { /* noop */ } })
      for (const peerId of [...pcs.keys()]) closePeer(peerId)
      if (screenTrack) { try { screenTrack.stop() } catch { /* noop */ } screenTrack = null }
      if (local) { local.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } }); local = null }
      rtcLeaveRoom(db, roomId, myId)
      window.removeEventListener('pagehide', onPageHide)
    }

    function onPageHide() {
      // The tab is dying: the SDK delete rarely gets to flush, so fire the
      // keepalive REST delete first - it is what actually reaches the server
      // when a tab closes mid-class. The sweeper covers whatever slips by.
      rtcLeaveBeacon(db, roomId, myId, cachedToken)
      rtcLeaveRoom(db, roomId, myId)
    }

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
        // Keep a fresh ID token at hand for the pagehide leave beacon
        // (resolves from the SDK cache - no network round-trip).
        getIdToken().then(t => { if (t) cachedToken = t }).catch(() => {})
      }, HEARTBEAT_MS)
      presence = setInterval(presenceTick, 5000)
      getIdToken().then(t => { if (t) cachedToken = t }).catch(() => {})
      window.addEventListener('pagehide', onPageHide)
      setPhase('ready')
    }

    apiRef.current = {
      toggleMic() {
        if (!local) return
        const t = local.getAudioTracks()[0]
        if (!t) return
        t.enabled = !t.enabled
        setMicOn(t.enabled)
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
      setRecordingFlag(on) {
        // Everyone's roster shows the REC pill off the professor's doc.
        rtcUpdateParticipant(db, roomId, myId, { recording: !!on, recStartAt: on ? Date.now() : null })
      },
      setHand(on) {
        // Raise/lower own hand; the timestamp orders the queue for everyone.
        rtcUpdateParticipant(db, roomId, myId, { hand: on ? Date.now() : null })
      },
      lowerHand(peerId) {
        // Professor lowering a student's hand (rules allow any signed-in write).
        rtcUpdateParticipant(db, roomId, peerId, { hand: null })
      },
      sendReaction(emoji) {
        // One cheap self-doc update; every roster listener animates it.
        rtcUpdateParticipant(db, roomId, myId, { react: { e: String(emoji).slice(0, 8), at: Date.now() } })
      },
      setChatLock(on) {
        // Professor-only toggle; students read it off the professor's doc.
        rtcUpdateParticipant(db, roomId, myId, { chatLock: !!on })
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
    phase, errorMsg, peers, localStream, micOn, camOn, sharing, screenStream,
    toggleMic: () => apiRef.current.toggleMic?.(),
    toggleCam: () => apiRef.current.toggleCam?.(),
    startShare: () => apiRef.current.startShare?.(),
    stopShare: () => apiRef.current.stopShare?.(),
    leave: () => apiRef.current.leave?.(),
    retry: () => setAttempt(a => a + 1),
    setRecordingFlag: on => apiRef.current.setRecordingFlag?.(on),
    setHand: on => apiRef.current.setHand?.(on),
    lowerHand: peerId => apiRef.current.lowerHand?.(peerId),
    sendReaction: e => apiRef.current.sendReaction?.(e),
    setChatLock: on => apiRef.current.setChatLock?.(on),
    canShare: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
  }
}
