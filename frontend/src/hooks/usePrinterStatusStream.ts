import { useEffect, useState } from 'react'
import { API_URL } from '../config'
import { getToken } from '../api/client'

export type PrinterLiveUpdate = {
  printer_id: number
  last_known_status: string
  last_moonraker_error: string | null
  connected: boolean
  extruder_actual_c: number | null
  extruder_target_c: number | null
  bed_actual_c: number | null
  bed_target_c: number | null
  /** Unix seconds from API when this patch was emitted. */
  ts?: number
  /** True when this patch came from an active Moonraker WebSocket (not HTTP liveness only). */
  ws_live?: boolean
}

export type PrinterStatusStreamMeta = {
  /** Browser EventSource is open (not in reconnect backoff). */
  streamOpen: boolean
  /** Client time (ms) when the last SSE message was parsed. */
  lastEventAt: number | null
  /** Total SSE messages received this session. */
  eventCount: number
}

const INITIAL_META: PrinterStatusStreamMeta = {
  streamOpen: false,
  lastEventAt: null,
  eventCount: 0,
}

/**
 * Subscribe to Jove ``GET /printers/status/stream`` (Moonraker WebSocket fan-out).
 * Returns a map of printer id → latest live status patch plus stream diagnostics.
 */
export function usePrinterStatusStream(enabled: boolean): {
  live: Map<number, PrinterLiveUpdate>
  meta: PrinterStatusStreamMeta
} {
  const [live, setLive] = useState<Map<number, PrinterLiveUpdate>>(() => new Map())
  const [meta, setMeta] = useState<PrinterStatusStreamMeta>(INITIAL_META)

  useEffect(() => {
    if (!enabled) {
      setLive(new Map())
      setMeta(INITIAL_META)
      return
    }
    const token = getToken()
    if (!token) return

    let closed = false
    let es: EventSource | null = null
    let reconnectTimer: number | undefined

    const url = `${API_URL}/printers/status/stream?access_token=${encodeURIComponent(token)}`

    function pickTemp(next: number | null | undefined, prev: number | null | undefined): number | null {
      // `null` is an explicit clear from backend (offline / no live heater data).
      if (next === null) return null
      if (typeof next === 'number' && !Number.isNaN(next)) return next
      if (typeof prev === 'number' && !Number.isNaN(prev)) return prev
      return null
    }

    function applyUpdate(u: PrinterLiveUpdate) {
      if (typeof u.printer_id !== 'number') return
      setLive((prev) => {
        const next = new Map(prev)
        const old = prev.get(u.printer_id)
        next.set(u.printer_id, {
          printer_id: u.printer_id,
          last_known_status: u.last_known_status,
          last_moonraker_error: u.last_moonraker_error,
          connected: u.connected,
          extruder_actual_c: pickTemp(u.extruder_actual_c, old?.extruder_actual_c),
          extruder_target_c: pickTemp(u.extruder_target_c, old?.extruder_target_c),
          bed_actual_c: pickTemp(u.bed_actual_c, old?.bed_actual_c),
          bed_target_c: pickTemp(u.bed_target_c, old?.bed_target_c),
          ts: u.ts ?? Date.now() / 1000,
          ws_live: u.ws_live ?? old?.ws_live,
        })
        return next
      })
    }

    function connect() {
      if (closed) return
      es?.close()
      es = new EventSource(url)

      es.onopen = () => {
        setMeta((m) => ({ ...m, streamOpen: true }))
      }

      es.onmessage = (ev) => {
        try {
          applyUpdate(JSON.parse(ev.data) as PrinterLiveUpdate)
          setMeta((m) => ({
            ...m,
            lastEventAt: Date.now(),
            eventCount: m.eventCount + 1,
          }))
        } catch {
          /* ignore malformed */
        }
      }

      es.onerror = () => {
        setMeta((m) => ({ ...m, streamOpen: false }))
        es?.close()
        es = null
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        connect()
      }
    }

    connect()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      closed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      es?.close()
    }
  }, [enabled])

  return { live, meta }
}
