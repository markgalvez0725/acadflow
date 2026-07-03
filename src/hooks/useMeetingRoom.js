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
//  - Share latency: the mesh encodes the share once PER PEER, so an uncapped
//    retina grab (8-14MP frames) backs up the encoder queue - that queue IS
//    the multi-second share lag. Fixes: capture capped at 1080p (720p past
//    16 peers, applied at the SOURCE via applyConstraints), H.264 preferred
//    when the device has a hardware encoder (VP8 is software-only on every
//    common laptop - the reason long/repeated shares built up delay), encode
//    fps laddered by room size, degradationPreference maintain-resolution
//    (text drops frames under pressure, never blurs), receivers run a
//    zero-target jitter buffer, and x-google-start-bitrate skips the slow
//    first-seconds bitrate ramp.
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
// Chrome's bandwidth estimator starts every video sender near 300kbps and
// ramps up over several seconds - on a screen share that is the "blurry and
// laggy at first" window, and every mid-class joiner restarts it for their
// link. x-google-start-bitrate in the video codec fmtp of the sdp we apply
// as the REMOTE description seeds the estimator higher (same direction as
// tuneOpus: remote fmtp tells the local sender what to send). Non-Chromium
// browsers ignore the unknown parameter, so this is free speed where it
// works and a no-op everywhere else.
function tuneVideoStart(sdp) {
  try {
    if (sdp.indexOf('x-google-start-bitrate') !== -1) return sdp
    let out = sdp
    const re = /a=rtpmap:(\d+) (?:VP8|VP9|H264|AV1)\/90000/g
    let m
    while ((m = re.exec(sdp))) {
      const pt = m[1]
      out = new RegExp('a=fmtp:' + pt + ' ').test(out)
        ? out.replace(new RegExp('(a=fmtp:' + pt + ' [^\\r\\n]*)'), '$1;x-google-start-bitrate=600')
        : out.replace(new RegExp('(a=rtpmap:' + pt + ' [^\\r\\n]*)'), '$1\r\na=fmtp:' + pt + ' x-google-start-bitrate=600')
    }
    return out
  } catch { return sdp }
}

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

// Self-heal is NEVER terminal (Meet behavior): as long as a peer's heartbeat
// says they are in the room, their link keeps getting repair attempts - the
// first ones as cheap ICE restarts on the same connection, then full
// rebuilds, with backoff capped at HEAL_BACKOFF_MAX. The retry counter only
// shapes backoff and resets whenever the link reaches 'connected' or the
// device's own network comes back.
const HEAL_BACKOFF_MAX = 15000

// Weak-hardware profile: few cores or little memory (entry phones, old
// laptops) cannot run one video encoder per peer without the encoders
// backing up - the link starves, flaps, and reads as "disconnecting". These
// devices capture smaller frames and send fewer bits; capable devices are
// untouched. deviceMemory is absent on Safari (treated as capable).
const LOW_END = typeof navigator !== 'undefined'
  && ((navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 2)

// Rooms this device was removed from by the professor. Module-level so the
// block survives the engine remounting - pressing Join again in the same
// browser session lands straight on the removed screen instead of sneaking
// back into the class. A full reload clears it (next session, next class).
const ejectedRooms = new Set()

export default function useMeetingRoom({ db, roomId, self }) {
  // prejoin | connecting | ready | full | error | left | removed | replaced
  const [phase, setPhase] = useState('prejoin')
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
  // Green room: the engine idles in 'prejoin' until confirmJoin(prefs) hands
  // over the user's mic/cam choices. Prefs live in a ref so Try again (an
  // attempt bump) keeps them, while a NEW roomId clears them - every fresh
  // room entry gets the panel. Auto-reconnect and the mini player never
  // remount the engine, so they never fall back into prejoin.
  const [joinEpoch, setJoinEpoch] = useState(0)
  const joinPrefsRef = useRef(null)
  const prefRoomRef = useRef('')
  // MY network dropped (offline event, or every link down at once) - the room
  // shows one amber banner instead of blaming each peer's tile.
  const [netDown, setNetDown] = useState(false)
  // Aggregate health of my own links: the median across peers, so one student
  // on hotel wifi never turns MY dot red.
  const [selfQuality, setSelfQuality] = useState('good')
  // Bumped when the professor force-mutes this device (the room toasts it).
  const [forcedMuteAt, setForcedMuteAt] = useState(0)
  // Reactive copy of the join log for the in-meeting attendance viewer
  // (updates only when someone new joins, rejoins earlier, or leaves).
  const [joinLogLive, setJoinLogLive] = useState([])
  const apiRef = useRef({})
  const selfRef = useRef(self)
  selfRef.current = self

  useEffect(() => {
    if (!db || !roomId) return
    if (prefRoomRef.current !== roomId) {
      prefRoomRef.current = roomId
      joinPrefsRef.current = null
    }
    // Removed by the professor earlier this session: land straight on the
    // removed screen, before the green room can invite a doomed setup.
    if (ejectedRooms.has(roomId)) { apiRef.current = {}; setPhase('removed'); return }
    // Green room: idle here (no capture, no room writes) until the panel
    // confirms. Stale APIs from a previous engine run must not be callable.
    if (!joinPrefsRef.current) { apiRef.current = {}; setPhase('prejoin'); return }
    // Fresh attempt: reset everything a previous failed try may have left.
    setPhase('connecting')
    setErrorMsg('')
    setPeers([])
    setLocalStream(null)
    setMicOn(true)
    setCamOn(true)
    setSharing(false)
    setScreenStream(null)
    setNetDown(false)
    setSelfQuality('good')
    setForcedMuteAt(0)
    setJoinLogLive([])
    let dead = false
    const myId = uuidv4()
    const pcs = new Map()          // peerId -> RTCPeerConnection
    const streams = new Map()      // peerId -> MediaStream
    const connState = new Map()    // peerId -> RTCPeerConnection.connectionState
    const pendingIce = new Map()   // peerId -> [candidateJSON] queued pre-remoteDescription
    const videoSenders = new Map() // peerId -> RTCRtpSender for the outgoing video slot
    const retries = new Map()      // peerId -> self-heal attempts since the link last connected
    const healTimers = new Map()   // peerId -> pending self-heal timer
    const pcBorn = new Map()       // peerId -> when this pc incarnation was built
    const qual = new Map()         // peerId -> 'good' | 'weak' | 'bad', from the stats poll
    const qualPend = new Map()     // peerId -> candidate quality awaiting a confirming poll
    const statPrev = new Map()     // peerId -> { lost, recv } totals at the last stats poll
    const joinLog = new Map()      // student uid -> { uid, name, joinedAt } earliest sighting
    const initiated = new Set()
    let roster = []
    let myJoinedAt = 0
    let local = null
    let screenTrack = null
    let preferH264 = false // set once at start(): this device has a hardware H.264 encoder
    let shareCapW = 0      // capture width bucket currently applied to the share track
    let heartbeat = null
    let hbWorker = null    // background-proof heartbeat timer (see startHeartbeat)
    let hbUrl = ''
    let selfQ = 'good'     // my own uplink grade; drives the adaptive send budget
    let presence = null
    let statsTimer = null
    let offline = typeof navigator !== 'undefined' && navigator.onLine === false
    let netFlag = false
    let leaving = false
    let rejoining = false
    let cachedToken = ''       // for the pagehide leave beacon (fetch keepalive)
    const seenLocal = new Map() // peerId -> { sig, at }: OUR clock when their heartbeat last changed
    const joinStamp = new Map() // peerId -> joinedAt we built the pc against
    const swept = new Set()     // ghost docs this device already deleted
    const dupes = new Set()     // older docs of a uid that joined again (hidden instantly)
    let aliveSig = ''
    let lastPub = ''
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
      // An older doc of a uid that joined again is gone the moment the new
      // one exists - the fix for "their old tile said Reconnecting while
      // their new connection sat right next to it".
      if (dupes.has(p.peerId)) return true
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
      const sorted = shown.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
      // Skip identical publishes. Roster snapshots arrive on EVERY heartbeat
      // write (a 30-person room produces one every ~700ms), and each publish
      // used to re-render the whole room - React work that steals main-thread
      // time from video decode exactly when a share needs it. The signature
      // must cover EVERY peer field the room UI reads; a field missing here
      // means its changes stop reaching the screen.
      const sig = sorted.map(p =>
        p.peerId + ':' + p.name + ':' + p.role + ':' + (p.joinedAt || 0)
        + ':' + p.micOn + ':' + p.camOn + ':' + (p.sharing ? 1 : 0) + ':' + (p.sharedAt || 0)
        + ':' + (p.hand || 0) + ':' + (p.react?.at || 0) + (p.react?.e || '')
        + ':' + (p.recording ? 1 : 0) + ':' + (p.chatLock ? 1 : 0)
        + ':' + (connState.get(p.peerId) || 'new') + ':' + (qual.get(p.peerId) || 'good')
        + ':' + (retries.get(p.peerId) || 0) + ':' + (streams.get(p.peerId)?.id || '')
      ).join('|')
      if (sig === lastPub) return
      lastPub = sig
      setPeers(sorted.map(p => ({
        ...p,
        stream: streams.get(p.peerId) || null,
        connState: connState.get(p.peerId) || 'new',
        quality: qual.get(p.peerId) || 'good',
        retry: retries.get(p.peerId) || 0,
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
        // Duplicate docs (same uid joined again) are deleted right away -
        // stale ghosts wait out the full window as before.
        if (dupes.has(p.peerId) || seenAge(p.peerId) >= STALE_MS + 10000) {
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
      pcBorn.delete(peerId)
      qual.delete(peerId)
      statPrev.delete(peerId)
      const ht = healTimers.get(peerId)
      if (ht) { clearTimeout(ht); healTimers.delete(peerId) }
      // retries survives on purpose: the self-heal loop rebuilds through
      // closePeer, and its backoff must remember how many tries it has spent.
      applyMediaBudget()
    }

    // ── Self-healing links ────────────────────────────────────────────────
    // A dropped connection used to be terminal: the tile froze on "could not
    // connect" until someone manually rejoined. Now every 'failed' link (and
    // any 'disconnected' that does not recover by itself) is rebuilt through
    // the exact join path - same deterministic initiator, fresh pc, fresh
    // ICE - with backoff, until the peer is actually gone or HEAL_MAX is hit.
    function iAmInitiator(peerId) {
      const p = roster.find(x => x.peerId === peerId)
      if (!p) return false
      return (p.joinedAt < myJoinedAt) || (p.joinedAt === myJoinedAt && p.peerId < myId)
    }

    function scheduleHeal(peerId, delay) {
      const old = healTimers.get(peerId)
      if (old) clearTimeout(old)
      healTimers.set(peerId, setTimeout(() => { healTimers.delete(peerId); healPeer(peerId) }, delay))
    }

    // Cheap in-place repair, what Meet does first: fresh ICE candidates on
    // the SAME connection. The DTLS session and negotiated codecs survive,
    // the new gather round now includes the TURN relay, and media resumes in
    // a couple round trips instead of a full teardown + re-signaling cycle.
    async function iceRestart(peerId) {
      const pc = pcs.get(peerId)
      if (!pc) return false
      try {
        if (pc.restartIce) pc.restartIce()
        const offer = await pc.createOffer({ iceRestart: true })
        await pc.setLocalDescription(offer)
        send(peerId, 'offer', pc.localDescription.toJSON())
        return true
      } catch { return false }
    }

    async function healPeer(peerId) {
      if (dead || leaving) return
      const pc = pcs.get(peerId)
      const st = pc ? pc.connectionState : ''
      // Recovered (or mid-rebuild) on its own - nothing to do. A missing pc
      // means the rebuild is already underway or the peer left.
      if (!pc || (st !== 'failed' && st !== 'disconnected')) return
      const p = roster.find(x => x.peerId === peerId)
      if (!p || isGone(p)) return // actually left; the presence sweep owns it
      // Their heartbeat has gone quiet on top of the dead link: they are
      // leaving, not lagging - stop resuscitating and let presence evict them
      // (this is what kept a departed peer's tile alive as "Reconnecting").
      if (seenAge(peerId) >= STALE_FAST_MS) return
      // My own pipe is down: signaling cannot deliver anything anyway, so
      // wait for the 'online' event (it re-kicks every dead link).
      if (offline) { scheduleHeal(peerId, 3000); return }
      const n = (retries.get(peerId) || 0) + 1
      retries.set(peerId, n)
      // Ladder: two ICE restarts first, full rebuild only for links a
      // restart cannot save. Never terminal - while their heartbeat is
      // alive the tries keep coming with capped backoff.
      if (n <= 2 && st !== 'closed') {
        if (iAmInitiator(peerId)) {
          const ok = await iceRestart(peerId)
          if (!ok) { closePeer(peerId); initiate(peerId) }
        } else {
          // Only the initiator may offer (no glare) - ask them to restart.
          send(peerId, 'reoffer', { n, restart: true })
        }
      } else if (iAmInitiator(peerId)) {
        closePeer(peerId)
        initiate(peerId)
      } else {
        // Tear down my side and ask them to rebuild. If the link died for
        // them too they already are - the 'reoffer' handler ignores
        // requests against a fresh pc.
        closePeer(peerId)
        send(peerId, 'reoffer', { n })
      }
      publish()
      scheduleHeal(peerId, Math.min(HEAL_BACKOFF_MAX, 2000 * n))
    }

    // ── My own network ────────────────────────────────────────────────────
    function updateNetDown() {
      let down = offline
      if (!down && pcs.size >= 2) {
        let bad = 0
        for (const pc of pcs.values()) {
          const s = pc.connectionState
          if (s === 'failed' || s === 'disconnected') bad++
        }
        down = bad === pcs.size // every single link down at once = it's me
      }
      if (down !== netFlag) { netFlag = down; if (!dead) setNetDown(down) }
    }

    function onNetOffline() { offline = true; updateNetDown() }
    function onNetOnline() {
      offline = false
      retries.clear() // fresh pipe, fresh patience
      for (const [peerId, pc] of pcs) {
        const s = pc.connectionState
        if (s === 'failed' || s === 'disconnected') scheduleHeal(peerId, 800)
      }
      updateNetDown()
    }

    // ── Background-proof presence ─────────────────────────────────────────
    // Browsers clamp main-thread timers in hidden tabs - aggressively on
    // phones (screen off, app switched). The heartbeat used to stop, the
    // sweeper evicted the student as a ghost, and they bounced out of the
    // room: THE "students keep disconnecting" loop. Worker timers are exempt
    // from intensive throttling, so presence survives a backgrounded tab.
    function beat() {
      if (dead || leaving) return
      rtcUpdateParticipant(db, roomId, myId, {})
      // Keep a fresh ID token at hand for the pagehide leave beacon
      // (resolves from the SDK cache - no network round-trip).
      getIdToken().then(t => { if (t) cachedToken = t }).catch(() => {})
    }
    function startHeartbeat() {
      try {
        hbUrl = URL.createObjectURL(new Blob(
          ['setInterval(function(){postMessage(0)},' + HEARTBEAT_MS + ')'],
          { type: 'text/javascript' },
        ))
        hbWorker = new Worker(hbUrl)
        hbWorker.onmessage = beat
      } catch {
        heartbeat = setInterval(beat, HEARTBEAT_MS) // no Worker: main-thread timer
      }
    }
    // Back to a foreground tab: beat immediately (the sweep may be close),
    // refresh the quality dots, and kick every downed link right away
    // instead of waiting out its backoff.
    function onVisible() {
      if (dead || typeof document === 'undefined' || document.visibilityState !== 'visible') return
      beat()
      pollStats()
      for (const [peerId, pc] of pcs) {
        const s = pc.connectionState
        if (s === 'failed' || s === 'disconnected') scheduleHeal(peerId, 500)
      }
    }

    // ── Connection quality (the per-tile dot) ─────────────────────────────
    // Every 5s, read each link's real numbers: packet loss over the window
    // (inbound-rtp deltas) and round-trip time (the selected candidate pair).
    // Purely local - getStats never touches the network or Firestore.
    async function pollStats() {
      // Skip while nothing is on screen (backgrounded tab): the dots are
      // invisible, and on a phone this poll is pure battery. The first poll
      // after returning refreshes everything.
      if (dead || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      let changed = false
      for (const [peerId, pc] of [...pcs]) {
        if (pc.connectionState !== 'connected') {
          if (qual.get(peerId) !== 'bad') { qual.set(peerId, 'bad'); qualPend.delete(peerId); changed = true }
          continue
        }
        try {
          const report = await pc.getStats()
          if (dead) return
          let lost = 0, recv = 0, rtt = -1, selId = ''
          const pairs = new Map()
          report.forEach(s => {
            if (s.type === 'inbound-rtp') { lost += s.packetsLost || 0; recv += s.packetsReceived || 0 }
            else if (s.type === 'candidate-pair') pairs.set(s.id, s)
            else if (s.type === 'transport' && s.selectedCandidatePairId) selId = s.selectedCandidatePairId
          })
          const sel = pairs.get(selId) || [...pairs.values()].find(x => x.nominated && x.state === 'succeeded')
          if (sel && typeof sel.currentRoundTripTime === 'number') rtt = sel.currentRoundTripTime
          const prev = statPrev.get(peerId) || { lost, recv }
          statPrev.set(peerId, { lost, recv })
          const dLost = Math.max(0, lost - prev.lost)
          const dRecv = Math.max(0, recv - prev.recv)
          const lossPct = dLost + dRecv > 0 ? (dLost / (dLost + dRecv)) * 100 : 0
          const q = (lossPct > 8 || rtt > 0.5) ? 'bad'
            : (lossPct > 2.5 || rtt > 0.25) ? 'weak'
            : 'good'
          // Hysteresis: a dot only flips after TWO consecutive polls agree,
          // so a link sitting at a threshold boundary does not strobe the
          // dot (and re-render the room) every 5 seconds.
          const cur = qual.get(peerId) || 'good'
          if (q === cur) qualPend.delete(peerId)
          else if (qualPend.get(peerId) === q) { qual.set(peerId, q); qualPend.delete(peerId); changed = true }
          else qualPend.set(peerId, q)
        } catch { /* stats unavailable this tick */ }
      }
      for (const id of [...qual.keys()]) {
        if (!pcs.has(id)) { qual.delete(id); qualPend.delete(id); statPrev.delete(id); changed = true }
      }
      const rank = { good: 0, weak: 1, bad: 2 }
      const vals = [...qual.values()].sort((a, b) => rank[a] - rank[b])
      const q2 = offline ? 'bad' : vals.length ? vals[Math.floor(vals.length / 2)] : 'good'
      if (q2 !== selfQ) {
        // My own uplink changed grade: re-run the budget immediately so a
        // struggling link sends smaller, lighter video (and a recovered one
        // gets its quality back) without waiting for a room-size change.
        selfQ = q2
        applyMediaBudget()
      }
      setSelfQuality(prevQ => (prevQ === q2 ? prevQ : q2))
      if (changed) publish()
    }

    // Split the video budget across every connection and pin audio at high
    // network priority. Re-applied whenever the room size or share state
    // changes, and once per connection when it reaches 'connected' (encoder
    // parameters only stick after negotiation).
    function applyMediaBudget() {
      const n = Math.max(1, pcs.size)
      // Weak devices and struggling uplinks send smaller, lighter camera
      // video: half the pixels and fewer bits beat a stalled connection
      // every time (the Meet trade - stay connected, degrade video first).
      const camCap = LOW_END ? 220_000 : 350_000
      let camBits = Math.round(Math.min(camCap, Math.max(60_000, VIDEO_BUDGET / n)))
      if (selfQ === 'bad') camBits = Math.round(camBits * 0.6)
      // Share bitrate: a generous ceiling for small rooms (crisp 1080p text
      // wants ~2Mbps) and a floor high enough that text stays legible at
      // scale. maxBitrate is only a CAP - per-link congestion control still
      // adapts each student's feed to what their network actually delivers.
      const shareBits = Math.round(Math.min(2_500_000, Math.max(300_000, SHARE_BUDGET / n)))
      let scale = screenTrack ? 1 : (n > 16 ? 4 : n > 6 ? 2 : 1)
      if (!screenTrack && (LOW_END || selfQ === 'bad')) scale = Math.min(8, scale * 2)
      // The mesh encodes the share once per peer, so cap the ENCODE framerate
      // as the room grows: it keeps the sharer's CPU ahead of the frame queue
      // (a backed-up encoder is exactly what share lag is). Slides are static
      // so low fps is invisible; what moves stays in sync, just fewer frames.
      const shareFps = n > 16 ? 10 : n > 6 ? 15 : 30
      // Big rooms downscale the CAPTURE itself (720p past 16 peers): scaling
      // at the source is paid once, while scaleResolutionDownBy would make
      // all N encoders resize 1080p frames separately. Smaller frames also
      // mean smaller keyframes - what keeps low-bitrate links from stalling
      // for seconds whenever one is needed.
      if (screenTrack) {
        const w = n > 16 ? 1280 : 1920
        if (w !== shareCapW && screenTrack.applyConstraints) {
          shareCapW = w
          screenTrack.applyConstraints({
            width: { max: w },
            height: { max: w === 1280 ? 720 : 1080 },
          }).catch(() => { /* capture keeps its current size */ })
        }
      }
      for (const sender of videoSenders.values()) {
        try {
          const p = sender.getParameters()
          if (!p.encodings || !p.encodings.length) continue // pre-negotiation
          p.encodings[0].maxBitrate = screenTrack ? shareBits : camBits
          p.encodings[0].scaleResolutionDownBy = scale
          if (screenTrack) p.encodings[0].maxFramerate = shareFps
          else delete p.encodings[0].maxFramerate
          // Spec-recommended pairing with the content hints: under CPU or
          // bandwidth pressure the share ('detail') drops FRAMES and never
          // blurs text; the camera ('motion') gives up resolution first so
          // faces keep moving naturally.
          p.degradationPreference = screenTrack ? 'maintain-resolution' : 'maintain-framerate'
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

    // Chrome's default codec (VP8) has NO hardware encoder on any common
    // laptop - it is pure CPU, and the mesh runs one encoder per peer. That
    // is why long or repeated shares build up delay: the encoders fall
    // behind and the backlog only grows. When this device reports a power-
    // efficient (hardware) H.264 encoder, steering the calls onto H.264
    // moves that work to the GPU/media block and encode time stays flat no
    // matter how long, how often, or to how many people you present.
    // Devices that report no hardware H.264 keep today's behavior.
    async function detectHwH264() {
      try {
        const mc = navigator.mediaCapabilities
        if (!mc || !mc.encodingInfo) return false
        const tries = [
          'video/h264;profile-level-id=42e01f;packetization-mode=1',
          'video/h264;profile-level-id=42e01f',
          'video/h264',
        ]
        for (const contentType of tries) {
          try {
            const info = await mc.encodingInfo({
              type: 'webrtc',
              video: { contentType, width: 1280, height: 720, framerate: 30, bitrate: 1_500_000 },
            })
            if (info && info.supported) return !!info.powerEfficient
          } catch { /* this contentType shape not accepted, try the next */ }
        }
      } catch { /* stay on defaults */ }
      return false
    }

    function makePc(peerId) {
      const pc = new RTCPeerConnection(RTC_CONFIG)
      pcs.set(peerId, pc)
      pcBorn.set(peerId, Date.now())
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
      // Device-less joiners ("join with both off") still need an audio slot in
      // THEIR offer, or remote voices never flow on links they initiate.
      if (!local || !local.getAudioTracks().length) {
        try { pc.addTransceiver('audio', { direction: 'recvonly' }) } catch { /* very old browser */ }
      }
      if (vSender) videoSenders.set(peerId, vSender)
      // H.264-first codec order when this device has the hardware encoder.
      // Reorder ONLY - nothing is removed, so a peer without H.264 falls
      // back through the list exactly as before. The answering side's
      // preference decides a pair's codec, so two VP8-only devices between
      // themselves are completely untouched.
      if (preferH264 && vSender) {
        try {
          const caps = RTCRtpReceiver.getCapabilities && RTCRtpReceiver.getCapabilities('video')
          const codecs = caps && caps.codecs
          if (codecs && codecs.length && codecs.some(c => /h264/i.test(c.mimeType || ''))) {
            const isH264 = c => /h264/i.test(c.mimeType || '')
            const tr = pc.getTransceivers().find(t => t.sender === vSender)
            if (tr && tr.setCodecPreferences)
              tr.setCodecPreferences([...codecs.filter(isH264), ...codecs.filter(c => !isH264(c))])
          }
        } catch { /* codec order is best-effort */ }
      }
      // If a share is already running, the new peer should get the screen.
      if (screenTrack && vSender) vSender.replaceTrack(screenTrack).catch(() => {})
      pc.onicecandidate = e => { if (e.candidate) send(peerId, 'ice', e.candidate.toJSON()) }
      pc.ontrack = e => {
        // Live-first playout: the default adaptive jitter buffer grows to
        // smooth out bursty frames, which turns a screen share into a feed
        // that runs seconds behind the presenter. Target zero buffering for
        // video (frames render the moment they are complete); audio keeps
        // its own adaptive buffer so voice stays clean.
        if (e.track && e.track.kind === 'video') {
          try {
            const r = e.receiver || (e.transceiver && e.transceiver.receiver)
            if (r && 'jitterBufferTarget' in r) r.jitterBufferTarget = 0
            else if (r && 'playoutDelayHint' in r) r.playoutDelayHint = 0
          } catch { /* advisory knob */ }
        }
        if (e.streams && e.streams[0]) { streams.set(peerId, e.streams[0]); publish() }
      }
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState
        connState.set(peerId, st)
        if (st === 'connected') {
          retries.delete(peerId)
          const ht = healTimers.get(peerId)
          if (ht) { clearTimeout(ht); healTimers.delete(peerId) }
          applyMediaBudget()
        } else if (st === 'failed') {
          // Small stagger lets a burst of state flaps settle before healing.
          scheduleHeal(peerId, 300)
        } else if (st === 'disconnected') {
          // 'disconnected' often self-recovers within seconds - only heal the
          // ones that stay down.
          scheduleHeal(peerId, 4500)
        }
        updateNetDown()
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
      // A replaced incarnation may still be flushing signals - ignore them
      // (fresh unknown joiners are never in dupes, so first contact is safe).
      if (dupes.has(from)) return
      if (msg.type === 'offer') {
        const pc = pcs.get(from) || makePc(from)
        await pc.setRemoteDescription({ ...msg.data, sdp: tuneVideoStart(tuneOpus(msg.data.sdp, pcs.size)) })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send(from, 'answer', pc.localDescription.toJSON())
        await flushIce(from)
      } else if (msg.type === 'answer') {
        const pc = pcs.get(from)
        if (pc) { await pc.setRemoteDescription({ ...msg.data, sdp: tuneVideoStart(tuneOpus(msg.data.sdp, pcs.size)) }); await flushIce(from) }
      } else if (msg.type === 'ice') {
        const pc = pcs.get(from)
        if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(msg.data) } catch { /* stale */ } }
        else pendingIce.set(from, [...(pendingIce.get(from) || []), msg.data])
      } else if (msg.type === 'reoffer') {
        // The other side sees our link as dead and cannot re-offer (only the
        // initiator may - no glare). Restart requests run the cheap ICE
        // restart on the existing pc; rebuild requests tear down - unless
        // this pc was just built: then the crossing rebuild already
        // happened and this request is stale.
        if (!iAmInitiator(from)) return
        const cur = pcs.get(from)
        if (msg.data && msg.data.restart && cur && cur.connectionState !== 'closed') {
          if (await iceRestart(from)) return
          // Restart failed - fall through to the full rebuild.
        }
        if (Date.now() - (pcBorn.get(from) || 0) < 4000) return
        closePeer(from)
        initiate(from)
      } else if (msg.type === 'ctl') {
        // Professor room controls. Verified against the live roster - the
        // sender's participant doc must say role admin - and the professor's
        // own client ignores ctl entirely.
        const sender = roster.find(p => p.peerId === from)
        if (!sender || sender.role !== 'admin') return
        if ((selfRef.current || {}).role === 'admin') return
        const action = msg.data && msg.data.do
        if (action === 'mute') {
          const t = local && local.getAudioTracks()[0]
          if (t && t.enabled) {
            t.enabled = false
            setMicOn(false)
            setForcedMuteAt(Date.now())
            rtcUpdateParticipant(db, roomId, myId, { micOn: false })
          }
        } else if (action === 'eject') {
          ejectedRooms.add(roomId)
          teardown()
          setPhase('removed')
        }
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
      // Same account in the room twice (rejoined after a killed tab whose doc
      // lingered, or opened a second device): only the NEWEST doc per uid is
      // real. Older ones are hidden instantly (isGone), their pcs closed, and
      // the sweeper deletes their docs without waiting out the stale window.
      dupes.clear()
      const newestByUid = new Map()
      for (const p of list) {
        if (!p.uid) continue
        const cur = newestByUid.get(p.uid)
        if (!cur || (p.joinedAt || 0) > (cur.joinedAt || 0)
          || ((p.joinedAt || 0) === (cur.joinedAt || 0) && p.peerId > cur.peerId)) newestByUid.set(p.uid, p)
      }
      for (const p of list) {
        if (!p.uid) continue
        const w = newestByUid.get(p.uid)
        if (w && w.peerId !== p.peerId) {
          dupes.add(p.peerId)
          if (pcs.has(p.peerId)) closePeer(p.peerId)
        }
      }
      // It is THIS device that got replaced (the same account joined again
      // elsewhere): bow out cleanly instead of seesaw-rejoining forever.
      if (dupes.has(myId)) { teardown(); setPhase('replaced'); return }
      // Attendance trail: remember every STUDENT ever sighted in the room and
      // their earliest join time (their doc disappears when they leave, so
      // this is accumulated live, not read at the end). The professor stamps
      // it onto the meeting doc at End class; the in-meeting viewer reads the
      // reactive copy. leftAt marks who joined then left (cleared on rejoin).
      let jlChanged = false
      for (const p of list) {
        if (p.role === 'admin' || !p.uid) continue
        const cur = joinLog.get(p.uid)
        if (!cur || (p.joinedAt || 0) < cur.joinedAt) {
          joinLog.set(p.uid, { uid: p.uid, name: p.name || '', joinedAt: p.joinedAt || Date.now(), leftAt: 0 })
          jlChanged = true
        }
      }
      const liveUids = new Set(list.filter(p => p.role !== 'admin' && p.uid).map(p => p.uid))
      for (const [uid, e] of joinLog) {
        if (liveUids.has(uid)) {
          if (e.leftAt) { joinLog.set(uid, { ...e, leftAt: 0 }); jlChanged = true }
        } else if (!e.leftAt) {
          joinLog.set(uid, { ...e, leftAt: Date.now() })
          jlChanged = true
        }
      }
      if (jlChanged) setJoinLogLive([...joinLog.values()])
      if (myJoinedAt && !leaving && !list.some(p => p.peerId === myId)) { rejoin(); return }
      // A peer that REJOINED (fresh joinedAt, e.g. after being swept) needs
      // fresh connections: drop the dead pc so the initiator rule re-runs
      // for the new incarnation instead of feeding offers to a closed pc.
      for (const p of list) {
        if (p.peerId === myId) continue
        const known = joinStamp.get(p.peerId)
        // A fresh incarnation also gets a fresh self-heal budget.
        if (known !== undefined && known !== p.joinedAt) { closePeer(p.peerId); retries.delete(p.peerId) }
        joinStamp.set(p.peerId, p.joinedAt)
      }
      for (const id of [...joinStamp.keys()]) {
        if (!list.some(p => p.peerId === id)) { joinStamp.delete(id); retries.delete(id) }
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
      if (hbWorker) { try { hbWorker.terminate() } catch { /* noop */ } hbWorker = null }
      if (hbUrl) { try { URL.revokeObjectURL(hbUrl) } catch { /* noop */ } hbUrl = '' }
      document.removeEventListener('visibilitychange', onVisible)
      if (presence) { clearInterval(presence); presence = null }
      if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
      for (const t of healTimers.values()) clearTimeout(t)
      healTimers.clear()
      window.removeEventListener('offline', onNetOffline)
      window.removeEventListener('online', onNetOnline)
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
      // Green-room choices (mic/cam on-off + device ids); {} on direct joins.
      const prefs = joinPrefsRef.current || {}
      // Codec decision must exist before the first connection is built.
      preferH264 = await detectHwH264()
      if (dead) return
      // Camera + mic; degrade to audio-only (camera busy/denied) before failing.
      let camOk = true
      const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      if (prefs.audioId) AUDIO.deviceId = { ideal: prefs.audioId }
      // Low-end devices capture smaller and slower at the SOURCE: fewer
      // pixels into every per-peer encoder is what keeps a budget phone's
      // CPU (and its connection) alive in a full room.
      const VIDEO = LOW_END
        ? { width: { ideal: 480 }, height: { ideal: 270 }, frameRate: { ideal: 15, max: 24 }, facingMode: 'user' }
        : { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' }
      if (prefs.videoId) VIDEO.deviceId = { ideal: prefs.videoId }
      if (prefs.noMedia) {
        // "Join with both off" from a device-blocked green room: listen-only,
        // no capture at all (makePc adds a recvonly audio slot so remote
        // voices still reach this device on links it initiates).
        camOk = false
      } else {
        try {
          local = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: AUDIO })
        } catch {
          camOk = false
          try {
            local = await navigator.mediaDevices.getUserMedia({ audio: AUDIO })
          } catch (e2) {
            if (!dead) { setPhase('error'); setErrorMsg(explainGumError(e2)) }
            return
          }
        }
      }
      if (dead) { if (local) local.getTracks().forEach(t => t.stop()); return }
      // Content hints steer the encoders: speech-optimized audio, motion-
      // optimized camera (the screen track gets 'detail' when sharing).
      try {
        const mic = local && local.getAudioTracks()[0]
        if (mic) mic.contentHint = 'speech'
        const cam = local && local.getVideoTracks()[0]
        if (cam) cam.contentHint = 'motion'
      } catch { /* hints are advisory */ }
      setLocalStream(local)
      // Enter exactly as configured in the green room: tracks stay live (an
      // in-room tap re-enables instantly) but start disabled when chosen off.
      const wantMic = !!local && prefs.micOn !== false && !!local.getAudioTracks()[0]
      const wantCam = camOk && prefs.camOn !== false
      if (local) {
        const mt = local.getAudioTracks()[0]
        if (mt) mt.enabled = wantMic
        const vt = local.getVideoTracks()[0]
        if (vt) vt.enabled = wantCam
      }
      setMicOn(wantMic)
      setCamOn(wantCam)

      // Join-time cap check (the roster listener re-checks deterministically).
      try {
        const existing = await rtcFetchParticipants(db, roomId)
        const now = Date.now()
        const aliveCount = existing.filter(p => now - (p.lastSeen || 0) < STALE_MS).length
        if (aliveCount >= ROOM_CAP) {
          if (local) { local.getTracks().forEach(t => t.stop()); local = null }
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
          if (local) for (const t of local.getTracks()) t.enabled = false
          setMicOn(false)
          setCamOn(false)
        }
        const me = await rtcJoinRoom(db, roomId, {
          peerId: myId, uid: s.uid, name: s.name, role: s.role,
          micOn: quiet ? false : wantMic,
          camOn: quiet ? false : wantCam,
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
      startHeartbeat()
      presence = setInterval(presenceTick, 5000)
      statsTimer = setInterval(pollStats, 5000)
      getIdToken().then(t => { if (t) cachedToken = t }).catch(() => {})
      window.addEventListener('pagehide', onPageHide)
      window.addEventListener('offline', onNetOffline)
      window.addEventListener('online', onNetOnline)
      document.addEventListener('visibilitychange', onVisible)
      updateNetDown()
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
        // Cap the capture itself: an uncapped retina/4K grab hands the mesh
        // 8-14MP frames to encode once per peer, and that encode queue is
        // where multi-second share lag comes from. 1080p at up to 30fps is
        // what Meet ships for shares - text stays crisp at a fraction of the
        // cost. selfBrowserSurface 'exclude' hides this very tab from the
        // picker (sharing the meeting into itself = mirrors + wasted bits);
        // surfaceSwitching lets Chrome swap the shared tab without stopping.
        const capped = {
          video: {
            width: { max: 1920 },
            height: { max: 1080 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
        }
        let ds
        try { ds = await navigator.mediaDevices.getDisplayMedia(capped) }
        catch (e) {
          // Dismissed picker = done. A browser that rejects the constraint
          // shape instead retries plain, rather than losing share entirely.
          if (!e || e.name === 'NotAllowedError' || e.name === 'AbortError') return
          try { ds = await navigator.mediaDevices.getDisplayMedia({ video: true }) }
          catch { return }
        }
        screenTrack = ds.getVideoTracks()[0]
        if (!screenTrack) return
        shareCapW = 1920 // matches the capture constraints above
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
        shareCapW = 0
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
      muteStudent(peerId) {
        // Professor only: the student's client turns its own mic off (a
        // browser cannot force a remote mic) - they can unmute to speak.
        if ((selfRef.current || {}).role !== 'admin') return
        send(peerId, 'ctl', { do: 'mute' })
      },
      muteAllStudents() {
        if ((selfRef.current || {}).role !== 'admin') return
        for (const p of roster) {
          if (p.peerId === myId || p.role === 'admin' || isGone(p)) continue
          if (p.micOn !== false) send(p.peerId, 'ctl', { do: 'mute' })
        }
      },
      removeStudent(peerId) {
        // Professor only: their client tears down, deletes its own docs, and
        // blocks rejoining this room for the rest of their browser session.
        if ((selfRef.current || {}).role !== 'admin') return
        send(peerId, 'ctl', { do: 'eject' })
      },
      getJoinLog() {
        return [...joinLog.values()]
      },
      leave() {
        teardown()
        setPhase('left')
      },
    }

    start()
    return () => { dead = true; teardown() }
  }, [db, roomId, attempt, joinEpoch])

  return {
    phase, errorMsg, peers, localStream, micOn, camOn, sharing, screenStream,
    netDown, selfQuality, forcedMuteAt, joinLogLive,
    toggleMic: () => apiRef.current.toggleMic?.(),
    toggleCam: () => apiRef.current.toggleCam?.(),
    startShare: () => apiRef.current.startShare?.(),
    stopShare: () => apiRef.current.stopShare?.(),
    leave: () => apiRef.current.leave?.(),
    retry: () => setAttempt(a => a + 1),
    // Green room handoff: prefs = { micOn, camOn, audioId, videoId, noMedia }.
    confirmJoin: prefs => { joinPrefsRef.current = prefs || {}; setJoinEpoch(e => e + 1) },
    setRecordingFlag: on => apiRef.current.setRecordingFlag?.(on),
    setHand: on => apiRef.current.setHand?.(on),
    lowerHand: peerId => apiRef.current.lowerHand?.(peerId),
    sendReaction: e => apiRef.current.sendReaction?.(e),
    setChatLock: on => apiRef.current.setChatLock?.(on),
    muteStudent: peerId => apiRef.current.muteStudent?.(peerId),
    muteAllStudents: () => apiRef.current.muteAllStudents?.(),
    removeStudent: peerId => apiRef.current.removeStudent?.(peerId),
    getJoinLog: () => apiRef.current.getJoinLog?.() || [],
    canShare: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
  }
}
