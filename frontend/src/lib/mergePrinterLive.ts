import type { PrinterLiveUpdate } from '../hooks/usePrinterStatusStream'
import type { Printer } from '../types/printer'

export function applyPrinterLiveUpdates(
  printers: Printer[],
  live: Map<number, PrinterLiveUpdate>,
): Printer[] {
  if (live.size === 0) return printers
  return printers.map((p) => {
    const u = live.get(p.id)
    if (!u) return p
    return {
      ...p,
      last_known_status: u.last_known_status,
      last_moonraker_error: u.last_moonraker_error,
    }
  })
}
