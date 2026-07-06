import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import {
  Activity, ShieldCheck, Zap, Radio, Bug, RefreshCw, FileText, FileSpreadsheet, Loader2,
  Users, LogIn, Video, FileUp, ClipboardList, MessageSquare,
} from 'lucide-react'
import PageHeader from '@/components/ds/PageHeader'
import EmptyState from '@/components/ds/EmptyState'
import ErrorState from '@/components/ds/ErrorState'
import { getInitials, relativeTime } from '@/utils/format'
import { courseShort } from '@/constants/courses'
import { aggregateTelemetry, telemetryDaySeries, buildSystemPdf, buildSystemXlsx, sysPct, sysMs } from '@/utils/systemReports'

// System reports: how AcadFlow ITSELF is behaving across every device that
// signs in. Each report card carries a live day-by-day graph (hand-rolled
// SVG, no chart library) with pointer tooltips showing the exact metrics,
// a deterministic health pill, and a live report sentence - all recomputed
// from the one-shot telemetry fetch. Refresh is manual (button) plus a
// re-fetch when the tab becomes visible again; never a background poll.

const VERDICT_LABEL = { ok: 'Healthy', warn: 'Watch', bad: 'Needs attention', none: 'No data yet' }

// ── Who's online ───────────────────────────────────────────────────────────
// Presence heartbeats land in `presence/{userId}` (see src/utils/presence.js);
// this section joins them with the roster for names and photos. Online means
// a heartbeat inside the last 5 minutes and no logout stamp. Hovering (or
// tapping) a person opens their session popover: current tab, device, and
// the short breadcrumb trail their device reported.

// Matched to the 10-minute presence heartbeat (quota discipline: heartbeats
// only write for ACTIVE devices, so the window must outlast one beat).
const ONLINE_MS = 12 * 60 * 1000
const OFF_SHOWN = 10

const TAB_LABELS = {
  overview: 'Home', stream: 'Stream', dashboard: 'Dashboard', classes: 'Classes',
  students: 'Students', grades: 'Grades', integrity: 'Grade Integrity',
  attendance: 'Attendance', activities: 'Activities', assignments: 'Assignments',
  caseStudies: 'Case Studies', quizzes: 'Quizzes', notifications: 'Notifications',
  calendar: 'Calendar', onlineClasses: 'Online Classes', enrollment: 'Enrollment',
  messages: 'Messages', feedback: 'Feedback', system: 'System Reports',
}
const tabLabel = k => TAB_LABELS[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : '')

const TRAIL_ICONS = { login: LogIn, tab: Activity, submit: FileUp, quiz: ClipboardList, join: Video, leave: Video, msg: MessageSquare, comment: MessageSquare }

function deviceLabel(ua) {
  const s = String(ua || '')
  if (!s) return ''
  const browser = s.includes('Edg') ? 'Edge' : s.includes('OPR') ? 'Opera' : s.includes('Firefox') ? 'Firefox' : s.includes('Chrome') ? 'Chrome' : s.includes('Safari') ? 'Safari' : 'Browser'
  const os = s.includes('Android') ? 'Android' : (s.includes('iPhone') || s.includes('iPad')) ? 'iOS' : s.includes('Windows') ? 'Windows' : s.includes('Mac') ? 'Mac' : s.includes('Linux') ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

function WhoAvatar({ x, size = 36 }) {
  return (
    <span className="sysr-who-av" style={{ width: size, height: size }}>
      {x.photo
        ? <img src={x.photo} alt="" />
        : <i>{getInitials(x.name)}</i>}
      {x.online && <span className="sysr-who-dot" />}
    </span>
  )
}

function PersonPop({ x }) {
  const ref = useRef(null)
  const [flip, setFlip] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 8) setFlip(true)
    else if (r.left < 8) setFlip(false)
  }, [])
  const p = x.p || {}
  const now = Date.now()
  const trail = [...(p.trail || [])].reverse()
  const banner = x.online
    ? `Now in ${tabLabel(p.tab) || 'AcadFlow'}${p.tabAt ? ` · ${fmtDur(now - p.tabAt)}` : ''}${p.since ? ` · online for ${fmtDur(now - p.since)}` : ''}${p.call ? ' · in a live class' : ''}`
    : x.at
      ? `Last seen ${relativeTime(x.at)}${p.tab ? ` · was in ${tabLabel(p.tab)}` : ''}`
      : 'No activity recorded yet on this update.'
  const dev = deviceLabel(p.ua)
  return (
    <div className={`sysr-pop${flip ? ' flip' : ''}`} ref={ref} onClick={e => e.stopPropagation()}>
      <div className="sysr-pop-head">
        <WhoAvatar x={{ ...x, online: false }} size={30} />
        <div>
          <b>{x.name}</b>
          <span>{[x.meta || x.role, dev].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <p className={`sysr-pop-banner${x.online ? '' : ' off'}`}>{banner}</p>
      {trail.length > 0 && (
        <>
          <p className="sysr-pop-lab">{x.online ? 'This session' : 'Last session'}</p>
          {trail.map((e, i) => {
            const Ic = TRAIL_ICONS[e.k] || Activity
            return (
              <div key={`${e.at}-${i}`} className="sysr-pop-tr">
                <span className="sysr-pop-time">{new Date(e.at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</span>
                <Ic size={13} aria-hidden="true" />
                <span>{e.k === 'tab' ? `Opened ${tabLabel(e.t)}` : e.t}</span>
              </div>
            )
          })}
        </>
      )}
      {trail.length === 0 && x.at > 0 && (
        <p className="sysr-pop-lab">The trail fills in as they use the app.</p>
      )}
      <p className="sysr-pop-foot">Updates every few minutes · visible to you only</p>
    </div>
  )
}

function PersonRow({ x, open, onOpen, onClose, chip = false }) {
  const t = useRef(0)
  useEffect(() => () => clearTimeout(t.current), [])
  // The delayed close passes this row's id so a stale timer from the row the
  // pointer just LEFT can never close the popover of the row it moved TO.
  return (
    <div
      className={`${chip ? 'sysr-who-chip' : 'sysr-who-row'}${x.online ? '' : ' off'}`}
      onMouseEnter={() => { clearTimeout(t.current); onOpen(x.id) }}
      onMouseLeave={() => { t.current = setTimeout(() => onClose(x.id), 160) }}
      onClick={e => { e.stopPropagation(); if (open) onClose(x.id); else onOpen(x.id) }}
    >
      <WhoAvatar x={x} size={chip ? 24 : 36} />
      <div className="sysr-who-id">
        <b className="sysr-who-nm">{x.name}</b>
        {!chip && (
          <span className="sysr-who-st">
            {x.online
              ? `${x.role} · ${Date.now() - x.at < 90000 ? 'active now' : relativeTime(x.at)}`
              : x.at ? `Last seen ${relativeTime(x.at)}` : 'No data yet'}
          </span>
        )}
        {chip && <span className="sysr-who-st">{x.at ? relativeTime(x.at) : 'no data yet'}</span>}
      </div>
      {open && <PersonPop x={x} />}
    </div>
  )
}

// ── Tiny charts (shared tooltip mechanics) ─────────────────────────────────
// Each chart measures its card slot (ResizeObserver) and draws in TRUE pixel
// coordinates - viewBox width equals the element width, so text, dots, and
// bars never stretch on wide cards. Plot area: x 8..w-8, y 14..40, labels at
// y 54. Hover snaps to the nearest index with data and shows a floating chip
// with the metrics; the same text feeds the SVG aria-label so screen readers
// get it too.

function useHover(count) {
  const [hov, setHov] = useState(-1)
  const move = e => {
    if (!count) return
    const r = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / (r.width || 1)))
    setHov(Math.round(frac * (count - 1)))
  }
  return [hov, move, () => setHov(-1)]
}

function useSize() {
  const ref = useRef(null)
  const [w, setW] = useState(320)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => {
      const px = Math.round(el.clientWidth || 0)
      if (px > 0) setW(Math.max(200, px))
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return [ref, w]
}

function ChartShell({ boxRef, w, caption, aria, hovText, hovX, children, onMove, onLeave }) {
  return (
    <div className="sysr-chart" ref={boxRef}>
      <svg
        viewBox={`0 0 ${w} 56`}
        role="img"
        aria-label={aria}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={onLeave}
      >
        <text x="8" y="10" className="sysr-ax">{caption}</text>
        {children}
      </svg>
      {hovText && (
        <span className="sysr-tip" style={{ left: `${Math.min(78, Math.max(22, hovX))}%` }}>{hovText}</span>
      )}
    </div>
  )
}

function MiniLine({ series, getV, tip, caption, aria, tone = 'accent' }) {
  const n = series.length
  const [hov, onMove, onLeave] = useHover(n)
  const [boxRef, w] = useSize()
  const span = w - 16
  const pts = series.map((s, i) => ({ i, v: getV(s) })).filter(p => p.v !== null && p.v !== undefined)
  const X = i => 8 + (n <= 1 ? span / 2 : i * (span / (n - 1)))
  if (!pts.length) {
    return (
      <ChartShell boxRef={boxRef} w={w} caption={caption} aria={`${aria}. No data yet.`}>
        <line x1="8" y1="40" x2={w - 8} y2="40" className="sysr-base" />
      </ChartShell>
    )
  }
  let min = Math.min(...pts.map(p => p.v))
  let max = Math.max(...pts.map(p => p.v))
  if (min === max) { min -= 1; max += 1 }
  const Y = v => 40 - ((v - min) / (max - min)) * 26
  const poly = pts.map(p => `${X(p.i)},${Y(p.v)}`).join(' ')
  // Snap the hover to the nearest index that actually has data.
  const snap = hov < 0 ? null : pts.reduce((b, p) => (Math.abs(p.i - hov) < Math.abs(b.i - hov) ? p : b), pts[0])
  const last = pts[pts.length - 1]
  return (
    <ChartShell
      boxRef={boxRef}
      w={w}
      caption={caption}
      aria={`${aria}. ${tip(series[last.i])}`}
      hovText={snap ? tip(series[snap.i]) : ''}
      hovX={snap ? (X(snap.i) / w) * 100 : 0}
      onMove={onMove}
      onLeave={onLeave}
    >
      <line x1="8" y1="40" x2={w - 8} y2="40" className="sysr-base" />
      {pts.length > 1 && <polyline points={poly} className={`sysr-line sysr-${tone}`} />}
      {pts.map(p => (
        <circle
          key={p.i}
          cx={X(p.i)}
          cy={Y(p.v)}
          r={snap && snap.i === p.i ? 3.4 : p.i === last.i ? 3 : 1.8}
          className={`sysr-dot sysr-${tone}`}
        />
      ))}
      <text x="8" y="54" className="sysr-ax">{series[0].label}</text>
      <text x={w - 8} y="54" textAnchor="end" className="sysr-ax">{series[n - 1].label}</text>
    </ChartShell>
  )
}

function MiniBars({ bars, tip, caption, aria, warnOn }) {
  const n = bars.length
  const [hov, onMove, onLeave] = useHover(n)
  const [boxRef, w] = useSize()
  const span = w - 16
  const vals = bars.map(b => b.v === null || b.v === undefined ? null : b.v)
  const has = vals.some(v => v !== null)
  const max = Math.max(1, ...vals.filter(v => v !== null))
  const slot = span / Math.max(1, n)
  const bw = Math.min(26, Math.max(6, slot - 4))
  const X = i => 8 + (n <= 1 ? 0 : i * slot) + (slot - bw) / 2
  if (!has) {
    return (
      <ChartShell boxRef={boxRef} w={w} caption={caption} aria={`${aria}. No data yet.`}>
        <line x1="8" y1="40" x2={w - 8} y2="40" className="sysr-base" />
      </ChartShell>
    )
  }
  const hovOk = hov >= 0 && vals[hov] !== null
  return (
    <ChartShell
      boxRef={boxRef}
      w={w}
      caption={caption}
      aria={`${aria}. ${tip(bars[n - 1])}`}
      hovText={hovOk ? tip(bars[hov]) : ''}
      hovX={hovOk ? ((X(hov) + bw / 2) / w) * 100 : 0}
      onMove={onMove}
      onLeave={onLeave}
    >
      <line x1="8" y1="40" x2={w - 8} y2="40" className="sysr-base" />
      {bars.map((b, i) => {
        if (vals[i] === null) return null
        const h = vals[i] === 0 ? 2 : 4 + (vals[i] / max) * 24
        return (
          <rect
            key={i}
            x={X(i)}
            y={40 - h}
            width={bw}
            height={h}
            rx="2"
            className={`sysr-bar${warnOn && warnOn(b) ? ' warn' : ''}${hov === i ? ' hov' : ''}`}
          />
        )
      })}
      <text x="8" y="54" className="sysr-ax">{bars[0].label}</text>
      <text x={w - 8} y="54" textAnchor="end" className="sysr-ax">{bars[n - 1].label}</text>
    </ChartShell>
  )
}

// ── The tab ────────────────────────────────────────────────────────────────

export default function SystemReportsTab() {
  const { fetchTelemetry, fetchPresence, meetings, students, admin } = useData()
  const { toast } = useUI()
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState(null) // null = loading
  const [pres, setPres] = useState(null) // presence heartbeats (null = loading)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState('') // `${kind}-${fmt}` while generating
  const [updatedAt, setUpdatedAt] = useState(0)
  const [popId, setPopId] = useState('') // which person's popover is open
  const [offAll, setOffAll] = useState(false)
  const loadingRef = useRef(false)

  const load = useCallback((d = days, quiet = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (!quiet) setRows(null)
    setFailed(false)
    // Presence rides the same refresh; its failure never blocks telemetry.
    fetchPresence()
      .then(p => setPres(p))
      .catch(() => setPres(prev => prev || []))
    fetchTelemetry(d)
      .then(r => { setRows(r); setUpdatedAt(Date.now()) })
      .catch(() => { setRows(prev => prev || []); setFailed(true) })
      .finally(() => { loadingRef.current = false })
  }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(days) }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back to the tab after it was hidden re-fetches quietly (the data
  // on screen stays put while the new snapshot loads). No background polling.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(days, true) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  // Who's online refreshes itself every FIVE minutes while this tab is open
  // and visible (each refresh reads one doc per user, so a tighter loop was
  // eating the free-tier read quota the live class mesh depends on).
  // Telemetry keeps its manual-refresh-only rule.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      fetchPresence().then(p => setPres(p)).catch(() => { /* keep last snapshot */ })
    }, 300000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Close the person popover by id (stale hover timers pass the id they were
  // armed for), and close it outright on any click outside a row - rows and
  // the popover stop propagation, so this only sees true outside clicks.
  const closePop = useCallback(id => setPopId(p => (!id || p === id ? '' : p)), [])
  useEffect(() => {
    if (!popId) return undefined
    const onDoc = () => setPopId('')
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [popId])

  // Join presence heartbeats with the roster (names, photos, course chips).
  const who = useMemo(() => {
    const now = Date.now()
    const byId = new Map((pres || []).map(p => [p.id, p]))
    const list = [{
      id: 'admin', name: admin?.name || 'Professor', photo: admin?.photo || null,
      role: 'Professor', meta: 'Professor', p: byId.get('admin'),
    }]
    for (const s of students) {
      list.push({
        id: s.id, name: s.name || s.id, photo: s.photo || null, role: 'Student',
        meta: ['Student', courseShort(s.course), s.section ? `Sec ${s.section}` : ''].filter(Boolean).join(' · '),
        p: byId.get(s.id),
      })
    }
    const state = list.map(x => {
      const at = x.p?.at || 0
      const online = at > 0 && !(x.p?.out) && now - at < ONLINE_MS
      return { ...x, at, online }
    })
    return {
      online: state.filter(x => x.online).sort((a, b) => b.at - a.at),
      offline: state.filter(x => !x.online).sort((a, b) => b.at - a.at),
      any: (pres || []).length > 0,
    }
  }, [pres, students, admin])

  const sinceTs = Date.now() - days * 86400000
  const agg = useMemo(() => aggregateTelemetry(rows || [], meetings, sinceTs), [rows, meetings]) // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => telemetryDaySeries(rows || [], days), [rows, days])
  const rangeLabel = days === 7 ? 'Last 7 days' : 'Last 30 days'
  const loading = rows === null
  const noData = !loading && !failed && (rows || []).length === 0
  const today = series[series.length - 1]

  // Per-card live verdict + narrative, all deterministic thresholds.
  const cards = useMemo(() => {
    const hasTele = (rows || []).length > 0
    const classBars = agg.meets.slice(0, 7).reverse().map(m => ({
      label: m.when ? new Date(m.when).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '',
      v: m.reconnects === null ? 0 : m.reconnects,
      m,
    }))
    const latest = agg.meets[0]

    const stabV = !hasTele ? 'none' : agg.crashFree === null ? 'none' : agg.crashFree < 0.9 ? 'bad' : (agg.crashFree < 0.98 || agg.chunkFail > 0) ? 'warn' : 'ok'
    const perfV = !hasTele || agg.bootMed === null ? 'none' : agg.bootMed > 6000 ? 'bad' : agg.bootMed > 3000 ? 'warn' : 'ok'
    const relV = !agg.meets.length ? 'none' : (latest && (latest.reconnects || 0) > 5) || agg.meets.some(m => (m.weakShare || 0) > 0.25) ? 'warn' : 'ok'
    const errV = !hasTele ? 'none' : agg.errors.some(e => Date.now() - e.last < 86400000) ? 'warn' : agg.errorsTotal > 0 ? 'ok' : 'ok'
    const robV = !hasTele ? 'none' : (agg.saveFail > 3 || agg.offline > 5) ? 'warn' : 'ok'

    return [
      {
        kind: 'stability', Icon: ShieldCheck, title: 'Stability', verdict: stabV,
        text: stabV === 'none' ? 'Waiting for devices to report - the graph fills in day by day.'
          : `${today && today.crashFree !== null ? sysPct(today.crashFree) : sysPct(agg.crashFree)} crash-free today across ${agg.devices} device${agg.devices !== 1 ? 's' : ''}. ${agg.errorsTotal} error${agg.errorsTotal !== 1 ? 's' : ''} and ${agg.chunkFail} chunk failure${agg.chunkFail !== 1 ? 's' : ''} this range.${stabV === 'ok' ? ' Nothing to optimize.' : ' Check the Bugs report for the messages.'}`,
        chart: (
          <MiniLine
            series={series}
            getV={s => (s.crashFree === null ? null : Math.round(s.crashFree * 100))}
            tip={s => `${s.label} · ${s.crashFree === null ? 'no data' : `${Math.round(s.crashFree * 100)}% crash-free`} · ${s.sessions} session${s.sessions !== 1 ? 's' : ''}`}
            caption="crash-free % per day"
            aria="Crash-free percentage per day"
            tone="green"
          />
        ),
      },
      {
        kind: 'performance', Icon: Zap, title: 'Performance', verdict: perfV,
        text: perfV === 'none' ? 'Waiting for devices to report app start timings.'
          : `Median start ${sysMs(agg.bootMed)}, first paint ${sysMs(agg.lcpMed)}${agg.memMax ? `, peak memory ${agg.memMax} MB` : ''}. ${perfV === 'ok' ? 'Start under 3s - no action needed.' : 'Slow starts detected - a stale cache or weak devices; suggest a hard refresh.'}`,
        chart: (
          <MiniLine
            series={series}
            getV={s => s.boot}
            tip={s => `${s.label} · ${s.boot === null ? 'no data' : `${sysMs(s.boot)} median start`} · ${s.sessions} session${s.sessions !== 1 ? 's' : ''}`}
            caption="median app start per day"
            aria="Median app start time per day"
            tone="accent"
          />
        ),
      },
      {
        kind: 'reliability', Icon: Radio, title: 'Class reliability', verdict: relV,
        text: relV === 'none' ? 'No online classes in this range yet.'
          : latest && latest.reconnects !== null
            ? `Latest class had ${latest.reconnects} reconnect${latest.reconnects !== 1 ? 's' : ''}${latest.relayShare !== null ? ` and ${sysPct(latest.relayShare)} of devices on a relay` : ''}. ${relV === 'ok' ? 'Connections held steady.' : 'Above normal - suggest Data saver to students on mobile data.'}`
            : `${agg.meets.length} class${agg.meets.length !== 1 ? 'es' : ''} in range. Quality metrics appear once devices report from a class on this update.`,
        chart: (
          <MiniBars
            bars={classBars}
            tip={b => `${b.m.title} · ${b.label} · ${b.m.reconnects === null ? 'no quality data' : `${b.m.reconnects} reconnect${b.m.reconnects !== 1 ? 's' : ''}`} · ${b.m.joins} joined`}
            caption="reconnects per class (latest right)"
            aria="Reconnects per online class"
            warnOn={b => (b.m.reconnects || 0) > 5}
          />
        ),
      },
      {
        kind: 'errors', Icon: Bug, title: 'Bugs and errors', verdict: errV,
        text: errV === 'none' ? 'No devices reporting yet - errors will chart per day here.'
          : agg.errorsTotal === 0 ? 'No errors captured this range. Clean.'
          : `${agg.errorsTotal} error${agg.errorsTotal !== 1 ? 's' : ''} across ${agg.errors.length} distinct message${agg.errors.length !== 1 ? 's' : ''}. Top: "${agg.errors[0].m.slice(0, 60)}" (${agg.errors[0].n}x on ${agg.errors[0].devs} device${agg.errors[0].devs !== 1 ? 's' : ''}).`,
        chart: (
          <MiniBars
            bars={series.map(s => ({ label: s.label, v: s.errors, s }))}
            tip={b => `${b.label} · ${b.v === null ? 'no data' : `${b.v} error${b.v !== 1 ? 's' : ''}`} · ${b.s.sessions} session${b.s.sessions !== 1 ? 's' : ''}`}
            caption="errors per day"
            aria="Errors per day"
            warnOn={b => (b.v || 0) > 0}
          />
        ),
      },
      {
        kind: 'robustness', Icon: RefreshCw, title: 'Robustness', verdict: robV,
        text: robV === 'none' ? 'Waiting for devices to report save and network events.'
          : `${agg.saveFail} failed save${agg.saveFail !== 1 ? 's' : ''}, ${agg.offline} offline spell${agg.offline !== 1 ? 's' : ''}, ${agg.slow} slow-connection event${agg.slow !== 1 ? 's' : ''}. ${robV === 'ok' ? 'Writes are landing reliably.' : 'Watch for a pattern - the Excel export lists them per day.'}`,
        chart: (
          <MiniBars
            bars={series.map(s => ({ label: s.label, v: s.events, s }))}
            tip={b => `${b.label} · ${b.v === null ? 'no data' : `${b.s.saveFail} failed save${b.s.saveFail !== 1 ? 's' : ''} · ${b.s.offline} offline · ${b.s.slow} slow`}`}
            caption="save + network events per day"
            aria="Failed saves and network events per day"
            warnOn={b => (b.v || 0) > 2}
          />
        ),
      },
    ]
  }, [agg, series, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  async function generate(kind, fmt) {
    const key = `${kind}-${fmt}`
    if (busy) return
    setBusy(key)
    try {
      if (fmt === 'pdf') await buildSystemPdf(kind, agg, rangeLabel)
      else buildSystemXlsx(kind, agg, rangeLabel)
      toast('Report downloaded.', 'success')
    } catch (e) {
      toast(e?.message || 'Could not build the report. Try again.', 'error')
    } finally {
      setBusy('')
    }
  }

  const crashTone = agg.crashFree === null ? '' : agg.crashFree >= 0.98 ? ' good' : agg.crashFree >= 0.9 ? ' warn' : ' bad'

  return (
    <div>
      <PageHeader
        title="System reports"
        subtitle="How AcadFlow itself is behaving across your students' devices"
        actions={(
          <div className="sysr-head-a">
            {updatedAt > 0 && (
              <span className="sysr-upd">Updated {new Date(updatedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => load(days, true)} title="Fetch the latest telemetry">
              <RefreshCw size={14} /> Refresh
            </button>
            <select className="sysr-range" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Report range">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
        )}
      />

      {loading && (
        <p className="sysr-note"><Loader2 size={14} className="animate-spin" /> Gathering telemetry…</p>
      )}
      {failed && (
        <ErrorState
          title="Could not load telemetry"
          text="Check your connection and try again. If this keeps happening, the telemetry rules block may not be published yet in the Firebase console."
        />
      )}
      {noData && (
        <EmptyState
          Icon={Activity}
          title="No telemetry yet"
          text="Devices start reporting automatically after they load this update. Come back after the next class day - class history below still covers past meetings."
          tone="muted"
          compact
        />
      )}

      {!loading && !failed && (
        <>
          <div className="sysr-stats">
            <div className={`sysr-stat${crashTone}`}>
              <span>Crash-free sessions</span>
              <b>{sysPct(agg.crashFree)}</b>
              <i>{agg.sessions} sessions · {agg.devices} devices</i>
            </div>
            <div className="sysr-stat">
              <span>Errors</span>
              <b>{agg.errorsTotal}</b>
              <i>{agg.errors.length} distinct</i>
            </div>
            <div className="sysr-stat">
              <span>Median app start</span>
              <b>{sysMs(agg.bootMed)}</b>
              <i>first paint {sysMs(agg.lcpMed)}</i>
            </div>
            <div className={`sysr-stat${agg.reconTotal > 5 ? ' warn' : ''}`}>
              <span>Meeting reconnects</span>
              <b>{agg.reconTotal}</b>
              <i>{agg.meets.length} classes in range</i>
            </div>
          </div>

          <div className="card sysr-who">
            <div className="sysr-who-head">
              <p className="sysr-card-t"><Users size={16} aria-hidden="true" /> Who's online</p>
              <div className="sysr-who-pills">
                <span className="sysr-who-pill on">{who.online.length} online</span>
                <span className="sysr-who-pill">{who.offline.length} offline</span>
              </div>
            </div>
            <p className="sysr-who-sub">Active in the last few minutes · hover a person for their session trail · refreshes every few minutes</p>
            {!who.any && (
              <p className="sysr-who-none">
                No presence heartbeats yet. Devices start reporting after they load this update
                (the presence rules block must be published in the Firebase console).
              </p>
            )}
            {who.online.length > 0 && (
              <div className="sysr-who-grid">
                {who.online.map(x => (
                  <PersonRow key={x.id} x={x} open={popId === x.id} onOpen={setPopId} onClose={closePop} />
                ))}
              </div>
            )}
            {who.offline.length > 0 && (
              <div className="sysr-who-off">
                <p className="sysr-pop-lab">Offline</p>
                <div className="sysr-who-offwrap">
                  {(offAll ? who.offline : who.offline.slice(0, OFF_SHOWN)).map(x => (
                    <PersonRow key={x.id} x={x} chip open={popId === x.id} onOpen={setPopId} onClose={closePop} />
                  ))}
                  {who.offline.length > OFF_SHOWN && (
                    <button className="sysr-who-more" onClick={() => setOffAll(v => !v)}>
                      {offAll ? 'Show less' : `+${who.offline.length - OFF_SHOWN} more`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="sysr-grid">
            {cards.map(c => (
              <div key={c.kind} className="card sysr-card">
                <p className="sysr-card-t">
                  <c.Icon size={16} aria-hidden="true" /> {c.title}
                  <span className={`sysr-pill ${c.verdict}`}>{VERDICT_LABEL[c.verdict]}</span>
                </p>
                {c.chart}
                <p className={`sysr-live${c.verdict === 'warn' || c.verdict === 'bad' ? ' warn' : ''}`}>{c.text}</p>
                <div className="sysr-card-a">
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => generate(c.kind, 'pdf')}>
                    {busy === `${c.kind}-pdf` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => generate(c.kind, 'xlsx')}>
                    {busy === `${c.kind}-xlsx` ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
                  </button>
                </div>
              </div>
            ))}
            <div className="card sysr-card sysr-card-full">
              <p className="sysr-card-t"><Activity size={16} aria-hidden="true" /> Full health report</p>
              <p className="sysr-card-x">All five sections in one document.</p>
              <div className="sysr-card-a">
                <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => generate('full', 'pdf')}>
                  {busy === 'full-pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
                </button>
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => generate('full', 'xlsx')}>
                  {busy === 'full-xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
                </button>
              </div>
            </div>
          </div>

          {agg.errors.length > 0 && (
            <div className="card sysr-errors">
              <p className="sysr-card-t"><Bug size={15} aria-hidden="true" /> Top errors ({rangeLabel.toLowerCase()})</p>
              {agg.errors.slice(0, 6).map(e => (
                <div key={e.m} className="sysr-err">
                  <span className="sysr-err-m">{e.m}</span>
                  <span className="sysr-err-n">{e.n}x · {e.devs} device{e.devs !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
