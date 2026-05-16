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
}

/**
 * Subscribe to Jove ``GET /printers/status/stream`` (Moonraker WebSocket fan-out).
 * Returns a map of printer id → latest live status patch.
 */
export function usePrinterStatusStream(enabled: boolean): Map<number, PrinterLiveUpdate> {
  const [live, setLive] = useState<Map<number, PrinterLiveUpdate>>(() => new Map())

  useEffect(() => {
    if (!enabled) {
      setLive(new Map())
      return
    }
    const token = getToken()
    if (!token) return

    const url = `${API_URL}/printers/status/stream?access_token=${encodeURIComponent(token)}`
    const es = new EventSource(url)

    es.onmessage = (ev) => {
      try {
        const u = JSON.parse(ev.data) as PrinterLiveUpdate
        if (typeof u.printer_id !== 'number') return
        setLive((prev) => {
          const next = new Map(prev)
          next.set(u.printer_id, {
            printer_id: u.printer_id,
            last_known_status: u.last_known_status,
            last_moonraker_error: u.last_moonraker_error,
            connected: u.connected,
            extruder_actual_c: u.extruder_actual_c ?? null,
            extruder_target_c: u.extruder_target_c ?? null,
            bed_actual_c: u.bed_actual_c ?? null,
            bed_target_c: u.bed_target_c ?? null,
          })
          return next
        })
      } catch {
        /* ignore malformed */
      }
    }

    return () => {
      es.close()
    }
  }, [enabled])

  return live
}
