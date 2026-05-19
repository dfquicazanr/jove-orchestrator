import type { PrinterLiveUpdate } from '../hooks/usePrinterStatusStream'
import type { PrinterControlAction } from './printerControlActions'
import type { Printer } from '../types/printer'

const NOT_COMMAND_READY = new Set(['offline', 'powered_off'])

/**
 * Printer can accept Moonraker motion/heat/print commands.
 * Moonraker may be connected (temps updating) while Klipper is still ``offline`` — those
 * printers are excluded from bulk actions and per-card Motion / Heat controls.
 */
export function isPrinterMoonrakerReachable(
  printer: Printer,
  live: Map<number, PrinterLiveUpdate>,
): boolean {
  if (NOT_COMMAND_READY.has(printer.last_known_status)) return false
  const u = live.get(printer.id)
  if (u?.connected === false) return false
  return true
}

/** Farm control actions that call Moonraker (not Home Assistant mains power). */
export function controlActionNeedsMoonraker(action: PrinterControlAction): boolean {
  return action !== 'power_on' && action !== 'power_off'
}
