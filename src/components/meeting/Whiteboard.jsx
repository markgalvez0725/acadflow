import React, { useEffect, useRef, useState } from 'react'
import {
  Pencil, Minus, Square, Circle, ArrowUpRight, Type,
  RotateCcw, RotateCw, Trash2, Download, X, MonitorUp,
} from 'lucide-react'

// In-meeting whiteboard (professor only). A plain 2D-canvas drawing board -
// no libraries - that broadcasts itself to the class through the meeting's
// EXISTING screen-share pipeline: "Present to class" captures the canvas with
// canvas.captureStream() and hands it to useMeetingRoom.startBoardShare(), so
// students watch it exactly like a presentation (featured stage, "is
// presenting" label, recorded by the class recorder) with zero new Firestore
// schema. Because no getDisplayMedia is involved, presenting the board works
// from phones and tablets too.
//
// Board content lives in the `store` prop ({ ops, redo }, a ref object owned
// by MeetingRoom), so closing and reopening the board keeps the drawing for
// the whole class session. Everything is vector ops replayed onto the canvas,
// which is what makes undo/redo/clear exact.
//
// If real-time per-stroke sync is ever wanted WITHOUT presenting, the op
// objects below are already serializable - they could be streamed over the
// existing rtcRooms signaling as-is. The share pipeline makes that unnecessary
// today.

// Fixed logical board size: coordinates are resolution-independent, the
// shared/encoded stream has a stable frame size, and PNG exports are crisp.
const W = 1600
const H = 900
// Broadcast size: the mesh encodes the presented board once PER STUDENT, so
// the stream comes from a downscaled mirror of the canvas - the downscale is
// paid once, every peer encoder gets 720p frames, and end-to-end delay stays
// low even in full rooms. Drawing and PNG export keep the full 1600x900.
const BW = 1280
const BH = 720

const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#9333ea']
const SIZES = [3, 5, 9, 14]
const TEXT_SIZE = { 3: 26, 5: 34, 9: 46, 14: 62 } // brush size -> font px

// lucide's old build in this repo has no Eraser icon - tiny inline SVG in the
// same 24x24 stroke style instead.
function EraserIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20H8.5L3.6 15.1a2 2 0 0 1 0-2.8L13.4 2.5a2 2 0 0 1 2.8 0l4.3 4.3a2 2 0 0 1 0 2.8L12 18" />
      <path d="m9 8 7 7" />
    </svg>
  )
}

// Replay one vector op onto a 2D context. The base canvas is TRANSPARENT
// (the eraser punches real holes with destination-out); whiteness is added
// only at blit time so the visible/captured canvas stays fully opaque -
// captured video treats transparent pixels as black.
function drawOp(ctx, op) {
  if (op.t === 'clear') {
    ctx.clearRect(0, 0, W, H)
    return
  }
  ctx.save()
  if (op.t === 'erase') ctx.globalCompositeOperation = 'destination-out'
  ctx.strokeStyle = op.c
  ctx.fillStyle = op.c
  ctx.lineWidth = op.w
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (op.t === 'pen' || op.t === 'erase') {
    const pts = op.pts
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    // A tap with no movement still leaves a dot (round caps need length > 0).
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1])
    // Quadratic curves through segment midpoints, with each recorded point as
    // the control: fast strokes replay as smooth ink, not straight jags.
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2)
    }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
    ctx.stroke()
  } else if (op.t === 'line' || op.t === 'arrow') {
    ctx.beginPath()
    ctx.moveTo(op.a[0], op.a[1])
    ctx.lineTo(op.b[0], op.b[1])
    ctx.stroke()
    if (op.t === 'arrow') {
      const ang = Math.atan2(op.b[1] - op.a[1], op.b[0] - op.a[0])
      const hl = Math.max(14, op.w * 3.5)
      ctx.beginPath()
      ctx.moveTo(op.b[0], op.b[1])
      ctx.lineTo(op.b[0] - hl * Math.cos(ang - 0.5), op.b[1] - hl * Math.sin(ang - 0.5))
      ctx.moveTo(op.b[0], op.b[1])
      ctx.lineTo(op.b[0] - hl * Math.cos(ang + 0.5), op.b[1] - hl * Math.sin(ang + 0.5))
      ctx.stroke()
    }
  } else if (op.t === 'rect') {
    ctx.strokeRect(Math.min(op.a[0], op.b[0]), Math.min(op.a[1], op.b[1]), Math.abs(op.b[0] - op.a[0]), Math.abs(op.b[1] - op.a[1]))
  } else if (op.t === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse((op.a[0] + op.b[0]) / 2, (op.a[1] + op.b[1]) / 2, Math.abs(op.b[0] - op.a[0]) / 2, Math.abs(op.b[1] - op.a[1]) / 2, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (op.t === 'text') {
    ctx.font = `600 ${op.s}px Lexend, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(op.text, op.x, op.y)
  }
  ctx.restore()
}

function paintBase(base, ops) {
  const ctx = base.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  for (const op of ops) drawOp(ctx, op)
}

const TOOLS = [
  { id: 'pen', Icon: Pencil, label: 'Pen' },
  { id: 'erase', Icon: EraserIcon, label: 'Eraser' },
  { id: 'line', Icon: Minus, label: 'Line' },
  { id: 'arrow', Icon: ArrowUpRight, label: 'Arrow' },
  { id: 'rect', Icon: Square, label: 'Rectangle' },
  { id: 'ellipse', Icon: Circle, label: 'Circle' },
  { id: 'text', Icon: Type, label: 'Text' },
]

export default function Whiteboard({ store, presenting, onPresent, onStopPresent, onClose, hidden, toast }) {
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[1])
  const [confirmClear, setConfirmClear] = useState(false)
  const [textDraft, setTextDraft] = useState(null) // { x, y, left, top, v }
  const [, bumpTick] = useState(0) // refreshes undo/redo disabled states
  const bump = () => bumpTick(t => t + 1)

  const canvasRef = useRef(null)
  const frameRef = useRef(null)
  const baseRef = useRef(null)   // offscreen canvas holding committed ops
  const bcastRef = useRef(null)  // downscaled mirror the class actually streams
  const gestureRef = useRef(null) // in-flight stroke/shape
  const cursorRef = useRef(null) // brush-size ring following the pointer
  const curDiaRef = useRef(0)
  const rafRef = useRef(0)       // one blit per animation frame while drawing
  const previewRef = useRef(null)

  function baseCtx() { return baseRef.current.getContext('2d') }

  // Visible canvas = white fill + committed ops (+ preview). While presenting,
  // the broadcast mirror is refreshed from it in the same pass.
  function blit(previewOp) {
    const c = canvasRef.current
    if (!c || !baseRef.current) return
    const ctx = c.getContext('2d')
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    ctx.drawImage(baseRef.current, 0, 0)
    if (previewOp) drawOp(ctx, previewOp)
    const b = bcastRef.current
    if (b) b.getContext('2d').drawImage(c, 0, 0, BW, BH)
  }

  // Pointer events can fire far faster than frames are worth painting -
  // coalesce all of a frame's updates into ONE full blit via rAF.
  function scheduleBlit(previewOp) {
    previewRef.current = previewOp || null
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      blit(previewRef.current)
    })
  }
  function flushBlit() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    previewRef.current = null
    blit()
  }
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // Rebuild everything from the op list (undo/redo/clear all land here).
  function repaint() {
    paintBase(baseRef.current, store.ops)
    blit()
    bump()
  }

  useEffect(() => {
    const base = document.createElement('canvas')
    base.width = W
    base.height = H
    baseRef.current = base
    paintBase(base, store.ops) // restore content from earlier in the session
    blit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function undo() {
    if (!store.ops.length) return
    store.redo.push(store.ops.pop())
    repaint()
  }
  function redo() {
    if (!store.redo.length) return
    store.ops.push(store.redo.pop())
    repaint()
  }
  function commitOp(op) {
    store.ops.push(op)
    store.redo = []
    bump()
  }
  function clearBoard() {
    setConfirmClear(false)
    if (!store.ops.length) return
    drawOp(baseCtx(), { t: 'clear' })
    commitOp({ t: 'clear' }) // an op, so Undo brings the drawing back
    blit()
  }

  useEffect(() => {
    if (hidden) return
    const onKey = e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden])

  // Map a pointer event to logical board coordinates (the canvas is CSS
  // scaled to fit, so clientX/Y must be unscaled back to the 1600x900 space).
  function toXY(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return [
      Math.max(0, Math.min(W, (e.clientX - r.left) * (W / r.width))),
      Math.max(0, Math.min(H, (e.clientY - r.top) * (H / r.height))),
    ]
  }

  // ── Brush indicator ───────────────────────────────────────────────────────
  // A ring that previews the EXACT on-screen footprint of the pen/eraser at
  // the pointer. Driven by direct style writes (never state) so it costs
  // nothing per move; hidden for shape/text tools and when the pointer leaves.
  const brushable = tool === 'pen' || tool === 'erase'

  function moveCursor(e) {
    const el = cursorRef.current
    const c = canvasRef.current
    if (!el || !c) return
    if (!brushable) { el.style.opacity = '0'; return }
    const r = c.getBoundingClientRect()
    const dia = Math.max(6, (tool === 'erase' ? size * 3 : size) * (r.width / W))
    if (curDiaRef.current !== dia) {
      curDiaRef.current = dia
      el.style.width = dia + 'px'
      el.style.height = dia + 'px'
    }
    el.style.left = (e.clientX - r.left) + 'px'
    el.style.top = (e.clientY - r.top) + 'px'
    el.style.opacity = '1'
  }
  function hideCursor() {
    if (cursorRef.current) cursorRef.current.style.opacity = '0'
  }
  useEffect(() => { if (!brushable) hideCursor() }, [brushable])

  // Append one point to the in-flight stroke and paint just the newest piece
  // as a midpoint quadratic (matches the drawOp replay).
  function extendFree(g, x, y) {
    const pts = g.op.pts
    const last = pts[pts.length - 1]
    if (Math.abs(x - last[0]) + Math.abs(y - last[1]) < 1.2) return false
    pts.push([x, y])
    const n = pts.length
    const ctx = baseCtx()
    ctx.save()
    if (g.op.t === 'erase') ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = g.op.c
    ctx.lineWidth = g.op.w
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (n >= 3) {
      const p0 = pts[n - 3]
      const p1 = pts[n - 2]
      ctx.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
      ctx.quadraticCurveTo(p1[0], p1[1], (p1[0] + x) / 2, (p1[1] + y) / 2)
    } else {
      ctx.moveTo(last[0], last[1])
      ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
    return true
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return
    moveCursor(e)
    if (textDraft) { commitText(); return }
    const [x, y] = toXY(e)
    if (tool === 'text') {
      const fr = frameRef.current.getBoundingClientRect()
      setTextDraft({ x, y, left: e.clientX - fr.left, top: e.clientY - fr.top, v: '' })
      return
    }
    e.preventDefault()
    try { canvasRef.current.setPointerCapture(e.pointerId) } catch { /* older engines */ }
    if (tool === 'pen' || tool === 'erase') {
      const op = { t: tool, c: color, w: tool === 'erase' ? size * 3 : size, pts: [[x, y]] }
      gestureRef.current = { op, free: true }
      drawOp(baseCtx(), op) // the initial dot
      blit()
    } else {
      gestureRef.current = { op: { t: tool, c: color, w: size, a: [x, y], b: [x, y] }, free: false }
    }
  }

  function onPointerMove(e) {
    moveCursor(e)
    const g = gestureRef.current
    if (!g) return
    e.preventDefault()
    if (g.free) {
      // Browsers coalesce fast pointer samples into one event per frame;
      // pulling them back out is what keeps quick handwriting smooth
      // instead of polygonal (a 120Hz stylus delivers 2-4 samples a frame).
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null
      const events = coalesced && coalesced.length ? coalesced : [e]
      let changed = false
      for (const ev of events) {
        const [x, y] = toXY(ev)
        if (extendFree(g, x, y)) changed = true
      }
      if (changed) scheduleBlit()
    } else {
      const [x, y] = toXY(e)
      g.op.b = [x, y]
      scheduleBlit(g.op) // committed content + live shape preview
    }
  }

  function onPointerUp(e) {
    if (e && e.pointerType === 'touch') hideCursor()
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null
    if (g.free) {
      // Close the smoothed stroke: the last half-segment (final midpoint to
      // the final point) hasn't been painted yet.
      const pts = g.op.pts
      if (pts.length >= 2) {
        const p0 = pts[pts.length - 2]
        const p1 = pts[pts.length - 1]
        const ctx = baseCtx()
        ctx.save()
        if (g.op.t === 'erase') ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = g.op.c
        ctx.lineWidth = g.op.w
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        ctx.lineTo(p1[0], p1[1])
        ctx.stroke()
        ctx.restore()
      }
      commitOp(g.op) // already painted incrementally
      flushBlit()
    } else {
      drawOp(baseCtx(), g.op)
      commitOp(g.op)
      flushBlit()
    }
  }

  function commitText() {
    const d = textDraft
    if (!d) return
    setTextDraft(null)
    const v = (d.v || '').trim()
    if (!v) return
    const op = { t: 'text', c: color, s: TEXT_SIZE[size] || 34, x: d.x, y: d.y, text: v.slice(0, 200) }
    drawOp(baseCtx(), op)
    commitOp(op)
    blit()
  }

  function togglePresent() {
    if (presenting) { onStopPresent(); return }
    const c = canvasRef.current
    if (!c || typeof c.captureStream !== 'function') {
      toast('This browser cannot broadcast the board. You can still draw and save it as an image.', 'error')
      return
    }
    const b = document.createElement('canvas')
    b.width = BW
    b.height = BH
    bcastRef.current = b
    blit() // fills the mirror too - a first frame exists before capture starts
    const stream = b.captureStream(15)
    if (!onPresent(stream)) {
      bcastRef.current = null
      stream.getTracks().forEach(t => { try { t.stop() } catch { /* noop */ } })
      toast('Could not start presenting the board - try again.', 'error')
    }
  }

  // Presenting ended (from here, the room bar, or teardown): drop the mirror
  // so ordinary drawing stops paying for it.
  useEffect(() => {
    if (!presenting) bcastRef.current = null
  }, [presenting])

  function download() {
    try {
      const a = document.createElement('a')
      a.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`
      a.href = canvasRef.current.toDataURL('image/png')
      a.click()
    } catch {
      toast('Could not save the board as an image.', 'error')
    }
  }

  const frameW = frameRef.current ? frameRef.current.getBoundingClientRect().width : W

  return (
    <div className={`wb-overlay${hidden ? ' wb-hidden' : ''}`} role="dialog" aria-label="Whiteboard">
      <div className="wb-head">
        <span className="wb-title"><Pencil size={15} /> Whiteboard</span>
        {presenting && <span className="wb-live"><span className="wb-live-dot" /> Presenting to class</span>}
        <div className="wb-head-ctls">
          <button className={`wb-btn${presenting ? ' wb-btn-stop' : ' wb-btn-primary'}`} onClick={togglePresent}>
            <MonitorUp size={15} /> {presenting ? 'Stop presenting' : 'Present to class'}
          </button>
          <button className="wb-btn wb-btn-ic" onClick={download} title="Save the board as a PNG image" aria-label="Save as image">
            <Download size={16} />
          </button>
          <button className="wb-btn wb-btn-ic" onClick={onClose} title="Close the board (your drawing is kept)" aria-label="Close the board">
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="wb-tools">
        {TOOLS.map(t => (
          <button
            key={t.id}
            className={`wb-tool${tool === t.id ? ' on' : ''}`}
            onClick={() => { setTool(t.id); setConfirmClear(false) }}
            title={t.label}
            aria-label={t.label}
            aria-pressed={tool === t.id}
          >
            <t.Icon size={18} />
          </button>
        ))}
        <span className="wb-sep" aria-hidden="true" />
        {COLORS.map(c => (
          <button
            key={c}
            className={`wb-swatch${color === c ? ' on' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            title="Color"
            aria-label={`Color ${c}`}
          />
        ))}
        <label className={`wb-swatch wb-custom${COLORS.includes(color) ? '' : ' on'}`} style={{ background: COLORS.includes(color) ? undefined : color }} title="Custom color">
          <input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="Custom color" />
        </label>
        <span className="wb-sep" aria-hidden="true" />
        {SIZES.map(s => (
          <button
            key={s}
            className={`wb-tool wb-size${size === s ? ' on' : ''}`}
            onClick={() => setSize(s)}
            title={`Brush size ${s}`}
            aria-label={`Brush size ${s}`}
          >
            <span style={{ width: 4 + s, height: 4 + s }} />
          </button>
        ))}
        <span className="wb-sep" aria-hidden="true" />
        <button className="wb-tool" onClick={undo} disabled={!store.ops.length} title="Undo" aria-label="Undo"><RotateCcw size={18} /></button>
        <button className="wb-tool" onClick={redo} disabled={!store.redo.length} title="Redo" aria-label="Redo"><RotateCw size={18} /></button>
        <button className="wb-tool wb-danger" onClick={() => setConfirmClear(true)} disabled={!store.ops.length} title="Clear the board" aria-label="Clear the board"><Trash2 size={18} /></button>
      </div>

      <div className="wb-stage">
        <div className="wb-frame" ref={frameRef}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className={`wb-canvas${brushable ? ' wb-canvas-brush' : tool === 'text' ? ' wb-canvas-text' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={hideCursor}
          />
          <span ref={cursorRef} className={`wb-cursor${tool === 'erase' ? ' wb-cursor-erase' : ''}`} aria-hidden="true" />
          {textDraft && (
            <input
              className="wb-text-in"
              style={{
                left: textDraft.left,
                top: textDraft.top,
                color,
                fontSize: Math.max(12, (TEXT_SIZE[size] || 34) * (frameW / W)),
              }}
              value={textDraft.v}
              placeholder="Type, then Enter"
              autoFocus
              onChange={e => setTextDraft(d => (d ? { ...d, v: e.target.value } : d))}
              onKeyDown={e => {
                if (e.key === 'Enter') commitText()
                else if (e.key === 'Escape') setTextDraft(null)
              }}
              onBlur={commitText}
            />
          )}
          {confirmClear && (
            <div className="wb-confirm" role="alertdialog" aria-label="Clear the board?">
              <span>Clear the whole board?</span>
              <button className="wb-btn wb-btn-stop" onClick={clearBoard}>Clear</button>
              <button className="wb-btn" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
