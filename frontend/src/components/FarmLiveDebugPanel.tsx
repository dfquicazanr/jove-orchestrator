import { useEffect, useMemo, useState } from 'react'
import type { PrinterLiveUpdate, PrinterStatusStreamMeta } from '../hooks/usePrinterStatusStream'
import { formatHeaterActualTarget } from '../lib/formatPrinterTemps'
import { applyPrinterLiveUpdates, isStaleDisconnectedLive } from '../lib/mergePrinterLive'
import { printerStatusLabel } from '../lib/printerStatusLabels'
import type { Printer } from '../types/printer'

type Props = {
  dbPrinters: Printer[]
  live: Map<number, PrinterLiveUpdate>
  meta: PrinterStatusStreamMeta
}

function formatRelativeMs(fromMs: number | null, nowMs: number): string {
  if (fromMs == null) return 'never'
  const sec = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  if (sec < 1) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m ago`
}

function formatServerTs(ts: number | undefined, nowMs: number): string {
  if (ts == null || !Number.isFinite(ts)) return '—'
  const d = new Date(ts * 1000)
  const ageSec = Math.max(0, Math.floor(nowMs / 1000 - ts))
  return `${d.toLocaleTimeString()} (${ageSec}s old)`
}

function boolLabel(v: boolean | undefined): string {
  if (v === true) return 'yes'
  if (v === false) return 'no'
  return '—'
}

export function FarmLiveDebugPanel({ dbPrinters, live, meta }: Props) {
  const [open, setOpen] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [open])

  const mergedById = useMemo(() => {
    const merged = applyPrinterLiveUpdates(dbPrinters, live)
    return new Map(merged.map((p) => [p.id, p]))
  }, [dbPrinters, live])

  const sorted = useMemo(
    () => [...dbPrinters].sort((a, b) => a.name.localeCompare(b.name)),
    [dbPrinters],
  )

  return (
    <details
      className="farm-live-debug"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="farm-live-debug-summary">Live stream debug</summary>
      <div className="farm-live-debug-body">
        <p className="muted small">
          Moonraker patches from <code className="inline-code">GET /printers/status/stream</code>.
          Compare DB snapshot (<code className="inline-code">GET /printers</code>) with SSE and what
          each card shows after merge.
        </p>

        <dl className="farm-live-debug-stream">
          <div>
            <dt>SSE connection</dt>
            <dd>
              <span className={meta.streamOpen ? 'farm-live-debug-ok' : 'farm-live-debug-warn'}>
                {meta.streamOpen ? 'open' : 'closed / reconnecting'}
              </span>
            </dd>
          </div>
          <div>
            <dt>Last SSE message</dt>
            <dd>
              {meta.lastEventAt != null
                ? `${new Date(meta.lastEventAt).toLocaleTimeString()} — ${formatRelativeMs(meta.lastEventAt, nowMs)}`
                : 'none yet'}
            </dd>
          </div>
          <div>
            <dt>Messages this session</dt>
            <dd>{meta.eventCount}</dd>
          </div>
          <div>
            <dt>Printers with a live row</dt>
            <dd>{live.size}</dd>
          </div>
        </dl>

        <div className="farm-live-debug-table-wrap">
          <table className="farm-live-debug-table">
            <thead>
              <tr>
                <th>Printer</th>
                <th>SSE / WS</th>
                <th>Live status</th>
                <th>DB status</th>
                <th>Card status</th>
                <th>Extruder °C</th>
                <th>Bed °C</th>
                <th>Server ts</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((db) => {
                const u = live.get(db.id)
                const card = mergedById.get(db.id) ?? db
                const stale = u ? isStaleDisconnectedLive(db, u) : false
                return (
                  <tr key={db.id}>
                    <td>{db.name}</td>
                    <td>
                      {u ? (
                        <>
                          conn {boolLabel(u.connected)}
                          {', '}
                          ws {boolLabel(u.ws_live)}
                          {stale ? (
                            <span
                              className="farm-live-debug-stale"
                              title="Live says disconnected but DB looks reachable — card keeps DB status"
                            >
                              {' '}
                              stale
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted">no row</span>
                      )}
                    </td>
                    <td>{u ? printerStatusLabel(u.last_known_status) : '—'}</td>
                    <td>{printerStatusLabel(db.last_known_status)}</td>
                    <td>{printerStatusLabel(card.last_known_status)}</td>
                    <td>
                      <span className="farm-live-debug-temps">
                        <span title="Live patch">
                          L: {formatHeaterActualTarget(u?.extruder_actual_c, u?.extruder_target_c)}
                        </span>
                        <span title="Card (merged)">
                          C: {formatHeaterActualTarget(card.extruder_actual_c, card.extruder_target_c)}
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="farm-live-debug-temps">
                        <span title="Live patch">
                          L: {formatHeaterActualTarget(u?.bed_actual_c, u?.bed_target_c)}
                        </span>
                        <span title="Card (merged)">
                          C: {formatHeaterActualTarget(card.bed_actual_c, card.bed_target_c)}
                        </span>
                      </span>
                    </td>
                    <td className="farm-live-debug-ts">{formatServerTs(u?.ts, nowMs)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  )
}
