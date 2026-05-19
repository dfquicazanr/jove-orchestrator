import type { PrinterLiveUpdate } from '../hooks/usePrinterStatusStream'

function pickTemp(
  next: number | null | undefined,
  prev: number | null | undefined,
): number | null {
  if (next === null) return null
  if (typeof next === 'number' && !Number.isNaN(next)) return next
  if (typeof prev === 'number' && !Number.isNaN(prev)) return prev
  return null
}

/** Polling patches from ``POST /live/sync`` overlay the SSE stream (wake-after-power). */
export function mergeLiveStreamMaps(
  sse: Map<number, PrinterLiveUpdate>,
  patches: Map<number, PrinterLiveUpdate>,
): Map<number, PrinterLiveUpdate> {
  if (patches.size === 0) return sse
  const out = new Map(sse)
  for (const [id, patch] of patches) {
    const prev = out.get(id)
    const patchTs = typeof patch.ts === 'number' ? patch.ts : null
    const prevTs = typeof prev?.ts === 'number' ? prev.ts : null
    // Wake/drop poll patches are temporary: never let an older patch override newer SSE.
    if (patchTs !== null && prevTs !== null && patchTs < prevTs) {
      continue
    }
    out.set(id, {
      printer_id: id,
      last_known_status: patch.last_known_status ?? prev?.last_known_status ?? 'offline',
      last_moonraker_error: patch.last_moonraker_error ?? prev?.last_moonraker_error ?? null,
      connected: patch.connected ?? prev?.connected ?? false,
      extruder_actual_c: pickTemp(patch.extruder_actual_c, prev?.extruder_actual_c),
      extruder_target_c: pickTemp(patch.extruder_target_c, prev?.extruder_target_c),
      bed_actual_c: pickTemp(patch.bed_actual_c, prev?.bed_actual_c),
      bed_target_c: pickTemp(patch.bed_target_c, prev?.bed_target_c),
      ts: patch.ts ?? prev?.ts,
      ws_live: patch.ws_live ?? prev?.ws_live,
    })
  }
  return out
}
