/** Client-side mirror of backend ``gcode_parse`` for upload previews. */

export type GcodeMetadataPreview = {
  filament_mass_grams: number | null
  filament_length_mm: number | null
  print_time_seconds: number | null
}

const FILAMENT_USED_G = /;\s*filament\s+used\s*\[g\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_G_COLON = /;\s*filament\s+used\s*\[g\]:\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_MM = /;\s*total\s+filament\s+used\s*\[mm\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_MM_ALT = /;\s*filament\s+used\s*\[mm\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_M = /;\s*filament\s+used:\s*([0-9]+(?:\.[0-9]+)?)\s*m\b/i
const FILAMENT_WEIGHT = /;\s*filament\s+weight\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*g/i
const TIME_SECONDS = /;\s*time:\s*([0-9]+(?:\.[0-9]+)?)/i
const EST_PRINT_TIME = /;\s*(?:total\s+)?estimated\s+printing\s+time.*?:\s*(.+)$/im
const BUILD_TIME = /;\s*build\s+time:\s*(\d+:\d{2}(?::\d{2})?)/i
const TOTAL_EST_TIME = /;\s*total\s+estimated\s+time:\s*(.+?)(?:;|$)/i

function parseDurationToken(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (!t) return null

  const hms = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(t)
  if (hms) {
    const h = Number(hms[1])
    const mi = Number(hms[2])
    const s = Number(hms[3] ?? 0)
    return h * 3600 + mi * 60 + s
  }

  let total = 0
  let found = false
  for (const part of t.matchAll(/(\d+)\s*([dhms])/g)) {
    found = true
    const n = Number(part[1])
    const unit = part[2]
    if (unit === 'd') total += n * 86400
    else if (unit === 'h') total += n * 3600
    else if (unit === 'm') total += n * 60
    else if (unit === 's') total += n
  }
  return found ? total : null
}

function printTimeSecondsFromText(chunk: string): number | null {
  const timeM = TIME_SECONDS.exec(chunk)
  if (timeM) return Math.round(Number(timeM[1]))

  for (const pat of [EST_PRINT_TIME, BUILD_TIME, TOTAL_EST_TIME]) {
    pat.lastIndex = 0
    const m = pat.exec(chunk)
    if (m) {
      const sec = parseDurationToken(m[1])
      if (sec != null) return sec
    }
  }
  return null
}

export function parseGcodeMetadataText(head: string, tail?: string): GcodeMetadataPreview {
  const max = 512_000
  const combined = tail ? `${head.slice(0, max)}\n${tail.slice(-max)}` : head.slice(0, max)

  let grams: number | null = null
  const g1 = FILAMENT_USED_G.exec(combined)
  if (g1) grams = Number(g1[1])
  else {
    const g2 = FILAMENT_USED_G_COLON.exec(combined)
    if (g2) grams = Number(g2[1])
    else {
      const gw = FILAMENT_WEIGHT.exec(combined)
      if (gw) grams = Number(gw[1])
    }
  }

  let lengthMm: number | null = null
  const mm1 = FILAMENT_USED_MM.exec(combined)
  if (mm1) lengthMm = Number(mm1[1])
  else {
    const mm2 = FILAMENT_USED_MM_ALT.exec(combined)
    if (mm2) lengthMm = Number(mm2[1])
    else {
      const meters = FILAMENT_USED_M.exec(combined)
      if (meters) lengthMm = Number(meters[1]) * 1000
    }
  }

  if (grams == null && lengthMm != null) {
    grams = Math.round(lengthMm * (2.4 / 1000) * 100) / 100
  }

  let printSec = printTimeSecondsFromText(combined)
  if (printSec == null && tail) {
    printSec = printTimeSecondsFromText(tail)
  }

  return {
    filament_mass_grams: grams,
    filament_length_mm: lengthMm,
    print_time_seconds: printSec,
  }
}

const HEAD_BYTES = 512_000
const TAIL_BYTES = 65_536

/** Read file head + tail in the browser and extract slicer comment metadata. */
export async function parseGcodeFilePreview(file: File): Promise<GcodeMetadataPreview> {
  const headEnd = Math.min(file.size, HEAD_BYTES)
  const tailStart = Math.max(0, file.size - TAIL_BYTES)
  const head = await file.slice(0, headEnd).text()
  const tail = file.size > TAIL_BYTES ? await file.slice(tailStart).text() : ''
  return parseGcodeMetadataText(head, tail || undefined)
}
