import React, { useState, useEffect, useMemo } from 'react'
import { useData } from '@/context/DataContext'
import { useUI } from '@/context/UIContext'
import {
  Activity, ShieldCheck, Zap, Radio, Bug, RefreshCw, FileText, FileSpreadsheet, Loader2,
} from 'lucide-react'
import PageHeader from '@/components/ds/PageHeader'
import EmptyState from '@/components/ds/EmptyState'
import ErrorState from '@/components/ds/ErrorState'
import { aggregateTelemetry, buildSystemPdf, buildSystemXlsx, sysPct, sysMs } from '@/utils/systemReports'

// System reports: how AcadFlow ITSELF is behaving across every device that
// signs in - stability, performance, class reliability, errors, robustness.
// Data comes from the on-device telemetry collector (src/utils/telemetry.js,
// one small Firestore doc per device per day) fetched ONCE per visit/range;
// aggregation and PDF/Excel generation all happen on this device.

const REPORTS = [
  { kind: 'stability', Icon: ShieldCheck, title: 'Stability report', text: 'Crash-free rate, JS errors, and failed chunk loads across every device.' },
  { kind: 'performance', Icon: Zap, title: 'Performance report', text: 'App start time, first paint, long tasks, memory, and browser mix.' },
  { kind: 'reliability', Icon: Radio, title: 'Class reliability report', text: 'Per online class: joins, reconnects, relay share, and weak-connection share.' },
  { kind: 'errors', Icon: Bug, title: 'Bugs and errors report', text: 'Every captured error grouped by message with counts, devices, and last seen.' },
  { kind: 'robustness', Icon: RefreshCw, title: 'Robustness report', text: 'Failed saves, offline spells, and slow-connection events - and how often.' },
]

export default function SystemReportsTab() {
  const { fetchTelemetry, meetings } = useData()
  const { toast } = useUI()
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState(null) // null = loading
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState('') // `${kind}-${fmt}` while generating

  useEffect(() => {
    let dead = false
    setRows(null)
    setFailed(false)
    fetchTelemetry(days)
      .then(r => { if (!dead) setRows(r) })
      .catch(() => { if (!dead) { setRows([]); setFailed(true) } })
    return () => { dead = true }
  }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  const sinceTs = Date.now() - days * 86400000
  const agg = useMemo(() => aggregateTelemetry(rows || [], meetings, sinceTs), [rows, meetings]) // eslint-disable-line react-hooks/exhaustive-deps
  const rangeLabel = days === 7 ? 'Last 7 days' : 'Last 30 days'
  const loading = rows === null
  const noData = !loading && !failed && (rows || []).length === 0

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
          <select className="sysr-range" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Report range">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
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

          <div className="sysr-grid">
            {REPORTS.map(r => (
              <div key={r.kind} className="card sysr-card">
                <p className="sysr-card-t"><r.Icon size={16} aria-hidden="true" /> {r.title}</p>
                <p className="sysr-card-x">{r.text}</p>
                <div className="sysr-card-a">
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => generate(r.kind, 'pdf')}>
                    {busy === `${r.kind}-pdf` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => generate(r.kind, 'xlsx')}>
                    {busy === `${r.kind}-xlsx` ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />} Excel
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
