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
  RTC_CONFIG, ROOM_CAP, HEARTBEAT_MS, STALE_MS,
  rtcFetchParticipants, rtcJoinRoom, rtcLeaveRoom, rtcUpdateParticipant,
  rtcSendSignal, rtcListenParticipants, rtcListenSignals,
} from '@/firebase/rtc'

export default function useMeetingRoom({ db, roomId, self }) {
  const [phase, setPhase] = useState('connecting') // connecting | ready | full | error | left
  const [errorMsg, setErrorMsg] = useState('')
  const [peers, setPeers] = useState([])
  const [localStream, setLocalStream] = useState(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  const apiRef = useRef({})
  const selfRef = useRef(self)
  selfRef.current = self

  useEffect(() => {
    if (!db || !roomId) return
    let dead = false
    const myId = uuidv4()
    const pcs = new Map()        // peerId -> RTCPeerConnection
    const streams = new Map()    // peerId -> MediaStream
    const connState = new Map()  // peerId -> RTCPeerConnection.connectionState
    const pendingIce = new Map() // peerId -> [candidateJSON] queued pre-remoteDescription
    const initiated = new Set()
    let roster = []
    let myJoinedAt = 0
    let local = null
    let screenTrack = null
    let heartbeat = null
    const unsubs = []

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
    }

    function makePc(peerId) {
      const pc = new RTCPeerConnection(RTC_CONFIG)
      pcs.set(peerId, pc)
      if (local) for (const t of local.getTracks()) pc.addTrack(t, local)
      // If a share is already running, the new peer should get the screen.
      if (screenTrack) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video')
        if (sender) sender.replaceTrack(screenTrack).catch(() => {})
      }
      pc.onicecandidate = e => { if (e.candidate) send(peerId, 'ice', e.candidate.toJSON()) }
      pc.ontrack = e => {
        if (e.streams && e.streams[0]) { streams.set(peerId, e.streams[0]); publish() }
      }
      pc.onconnectionstatechange = () => {
        connState.set(peerId, pc.connectionState)
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
        await pc.setRemoteDescription(msg.data)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        send(from, 'answer', pc.localDescription.toJSON())
        await flushIce(from)
      } else if (msg.type === 'answer') {
        const pc = pcs.get(from)
        if (pc) { await pc.setRemoteDescription(msg.data); await flushIce(from) }
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
      try {
        local = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch {
        camOk = false
        try {
          local = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
        } catch {
          if (!dead) { setPhase('error'); setErrorMsg('Camera and microphone are blocked. Allow access in your browser and try again.') }
          return
        }
      }
      if (dead) { local.getTracks().forEach(t => t.stop()); return }
      setLocalStream(local)
      setCamOn(camOk)

      // Join-time cap check (the roster listener re-checks deterministically).
      try {
        const existing = await rtcFetchParticipants(db, roomId)
        const now = Date.now()
        if (existing.filter(p => now - (p.lastSeen || 0) < STALE_MS).length >= ROOM_CAP) {
          local.getTracks().forEach(t => t.stop()); local = null
          if (!dead) setPhase('full')
          return
        }
        const s = selfRef.current || {}
        const me = await rtcJoinRoom(db, roomId, {
          peerId: myId, uid: s.uid, name: s.name, role: s.role, camOn: camOk,
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
        for (const pc of pcs.values()) {
          const sender = pc.getSenders().find(x => x.track && x.track.kind === 'video')
          if (sender) sender.replaceTrack(screenTrack).catch(() => {})
        }
        screenTrack.onended = () => apiRef.current.stopShare()
        setSharing(true)
        rtcUpdateParticipant(db, roomId, myId, { sharing: true })
      },
      stopShare() {
        if (!screenTrack) return
        try { screenTrack.stop() } catch { /* noop */ }
        screenTrack = null
        const cam = local && local.getVideoTracks()[0]
        for (const pc of pcs.values()) {
          const sender = pc.getSenders().find(x => x.track && x.track.kind === 'video')
          if (sender) sender.replaceTrack(cam || null).catch(() => {})
        }
        setSharing(false)
        rtcUpdateParticipant(db, roomId, myId, { sharing: false })
      },
      leave() {
        teardown()
        setPhase('left')
      },
    }

    start()
    return () => { dead = true; teardown() }
  }, [db, roomId])

  return {
    phase, errorMsg, peers, localStream, micOn, camOn, sharing,
    toggleMic: () => apiRef.current.toggleMic?.(),
    toggleCam: () => apiRef.current.toggleCam?.(),
    startShare: () => apiRef.current.startShare?.(),
    stopShare: () => apiRef.current.stopShare?.(),
    leave: () => apiRef.current.leave?.(),
    canShare: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
  }
}
