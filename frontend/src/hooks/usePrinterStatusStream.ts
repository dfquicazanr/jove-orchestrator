import { useEffect, useState } from 'react'
import { API_URL } from '../config'
import { getToken } from '../api/client'

export type PrinterLiveUpdate = {
  printer_id: number
  last_known_status: string
  last_moonraker_error: string | null
  connected: boolean
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
          next.set(u.printer_id, u)
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
