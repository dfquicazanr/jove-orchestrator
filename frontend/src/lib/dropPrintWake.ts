import { apiFetch } from '../api/client'
import type { PrinterLiveUpdate } from '../hooks/usePrinterStatusStream'
import { printerStatusLabel } from './printerStatusLabels'
import type { Printer } from '../types/printer'

const POLL_INTERVAL_MS = 3000
const MAX_WAIT_MS = 5 * 60 * 1000
/** Delay after HA power-on before first Moonraker poll (board boot). */
const POWER_ON_SETTLE_MS = 8000

export type DropPrintWakePlan = 'none' | 'power_on'

export type WakeProgress = {
  phase: 'power_on' | 'waiting_moonraker' | 'waiting_ready' | 'ready' | 'uploading'
  message: string
}

export type PrinterLiveSyncResponse = {
  ok: boolean
  message?: string | null
  printer: Printer
  live: PrinterLiveUpdate
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Printer is off/unreachable but can be woken via Home Assistant mains power. */
export function printerCanWakeForDropPrint(printer: Printer): boolean {
  const offLike =
    printer.last_known_status === 'powered_off' || printer.last_known_status === 'offline'
  return (
    offLike &&
    Boolean(printer.ha_power_entity_id?.trim()) &&
    Boolean(printer.moonraker_base_url?.trim())
  )
}

export function printerReadyForDropPrint(printer: Printer): boolean {
  return printer.last_known_status === 'ready'
}

export function printerAcceptsDropPrint(printer: Printer): boolean {
  return printerReadyForDropPrint(printer) || printerCanWakeForDropPrint(printer)
}

export function wakePlanForDropPrint(printer: Printer): DropPrintWakePlan {
  if (printerReadyForDropPrint(printer)) return 'none'
  if (printerCanWakeForDropPrint(printer)) return 'power_on'
  return 'none'
}

/** Turn on HA power, poll Moonraker until reachable, then wait for ``ready`` status. */
export async function wakePrinterAndWaitReady(
  printerId: number,
  onProgress?: (progress: WakeProgress) => void,
  onLivePatch?: (live: PrinterLiveUpdate) => void,
): Promise<Printer> {
  onProgress?.({ phase: 'power_on', message: 'Turning on printer power…' })
  await apiFetch<{ ok: boolean }>(`/printers/${printerId}/power/on`, { method: 'POST' })

  onProgress?.({ phase: 'waiting_moonraker', message: 'Power on sent — waiting for boot…' })
  await sleep(POWER_ON_SETTLE_MS)

  const deadline = Date.now() + MAX_WAIT_MS
  let moonrakerUp = false
  let lastLiveStatus = 'offline'
  let lastSyncMessage: string | null = null

  while (Date.now() < deadline) {
    const sync = await apiFetch<PrinterLiveSyncResponse>(`/printers/${printerId}/live/sync`, {
      method: 'POST',
    })
    onLivePatch?.(sync.live)
    const liveStatus = sync.live.last_known_status || sync.printer.last_known_status
    const liveConnected = sync.live.connected ?? sync.ok
    lastLiveStatus = liveStatus
    lastSyncMessage = sync.message?.trim() ? sync.message : null

    if (liveConnected) {
      moonrakerUp = true
      if (liveStatus === 'ready') {
        onProgress?.({ phase: 'ready', message: 'Printer is ready.' })
        return { ...sync.printer, last_known_status: liveStatus }
      }
      onProgress?.({
        phase: 'waiting_ready',
        message: `Moonraker online (${printerStatusLabel(liveStatus)}) — waiting for Ready…`,
      })
    } else if (!moonrakerUp) {
      onProgress?.({
        phase: 'waiting_moonraker',
        message: sync.message?.trim()
          ? `Waiting for Moonraker… (${sync.message})`
          : 'Waiting for Moonraker…',
      })
    }

    await sleep(POLL_INTERVAL_MS)
  }

  const statusLabel = printerStatusLabel(lastLiveStatus)
  const detail = lastSyncMessage ? ` Last Moonraker message: ${lastSyncMessage}` : ''
  throw new Error(
    `Printer did not reach Ready in time after power on (last status: ${statusLabel}).${detail}`,
  )
}
