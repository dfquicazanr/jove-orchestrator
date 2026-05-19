import type { PrinterLiveUpdate } from '../hooks/usePrinterStatusStream'
import type { Printer } from '../types/printer'

const OFFLINE_LIKE = new Set(['offline', 'powered_off'])
/** No green "live" pulse — Moonraker may be connected while Klipper is down. */
const NOT_MOONRAKER_LIVE_PULSE = new Set(['offline', 'powered_off', 'error'])

function dbLooksReachable(status: string): boolean {
  return !OFFLINE_LIKE.has(status)
}

/**
 * Ignore stale SSE rows that still say disconnected after the DB was updated
 * (e.g. Sync / ping while the browser missed queue events).
 */
export function isStaleDisconnectedLive(dbPrinter: Printer, live: PrinterLiveUpdate): boolean {
  return !live.connected && dbLooksReachable(dbPrinter.last_known_status)
}

function pickTemp(
  next: number | null | undefined,
  prev: number | null | undefined,
): number | null | undefined {
  if (next === null) return null
  if (typeof next === 'number' && !Number.isNaN(next)) return next
  if (typeof prev === 'number' && !Number.isNaN(prev)) return prev
  return prev
}

function mergeLiveFields(p: Printer, u: PrinterLiveUpdate): Printer {
  const offlineLike = OFFLINE_LIKE.has(u.last_known_status)
  return {
    ...p,
    last_known_status: u.last_known_status,
    last_moonraker_error: u.last_moonraker_error,
    extruder_actual_c: offlineLike ? null : (pickTemp(u.extruder_actual_c, p.extruder_actual_c) ?? null),
    extruder_target_c: offlineLike ? null : (pickTemp(u.extruder_target_c, p.extruder_target_c) ?? null),
    bed_actual_c: offlineLike ? null : (pickTemp(u.bed_actual_c, p.bed_actual_c) ?? null),
    bed_target_c: offlineLike ? null : (pickTemp(u.bed_target_c, p.bed_target_c) ?? null),
  }
}

export function applyPrinterLiveUpdates(
  printers: Printer[],
  live: Map<number, PrinterLiveUpdate>,
): Printer[] {
  if (live.size === 0) return printers
  return printers.map((p) => {
    const u = live.get(p.id)
    if (!u) return p
    if (isStaleDisconnectedLive(p, u)) {
      return {
        ...p,
        extruder_actual_c: OFFLINE_LIKE.has(u.last_known_status)
          ? null
          : (pickTemp(u.extruder_actual_c, p.extruder_actual_c) ?? null),
        extruder_target_c: OFFLINE_LIKE.has(u.last_known_status)
          ? null
          : (pickTemp(u.extruder_target_c, p.extruder_target_c) ?? null),
        bed_actual_c: OFFLINE_LIKE.has(u.last_known_status)
          ? null
          : (pickTemp(u.bed_actual_c, p.bed_actual_c) ?? null),
        bed_target_c: OFFLINE_LIKE.has(u.last_known_status)
          ? null
          : (pickTemp(u.bed_target_c, p.bed_target_c) ?? null),
      }
    }
    return mergeLiveFields(p, u)
  })
}

/** Live Moonraker link for UI chrome (pill highlight, temp strip). */
export function isPrinterMoonrakerLive(
  dbPrinter: Printer,
  live: Map<number, PrinterLiveUpdate>,
): boolean {
  const u = live.get(dbPrinter.id)
  if (!u) return false
  if (isStaleDisconnectedLive(dbPrinter, u)) {
    return dbLooksReachable(dbPrinter.last_known_status)
  }
  if (!u.connected) return false
  if (NOT_MOONRAKER_LIVE_PULSE.has(u.last_known_status)) return false
  return u.ws_live === true || u.connected
}
