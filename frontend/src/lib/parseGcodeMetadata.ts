/** Client-side mirror of backend ``gcode_parse`` for upload previews. */

export type GcodeParseField =
  | 'filament_mass_grams'
  | 'filament_length_mm'
  | 'print_time_seconds'
  | 'filament_mass_derived'

export type GcodeParseLineMatch = {
  field: GcodeParseField
  pattern: string
  value: string
  region: 'head' | 'tail'
  lineNumber: number
  line: string
}

export type GcodeMetadataPreview = {
  filament_mass_grams: number | null
  filament_length_mm: number | null
  print_time_seconds: number | null
  parseMatches: GcodeParseLineMatch[]
}

type LineRef = {
  region: 'head' | 'tail'
  lineNumber: number
  text: string
}

type PatternDef = { label: string; re: RegExp }

const FILAMENT_USED_G = /;\s*filament\s+used\s*\[g\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_G_COLON = /;\s*filament\s+used\s*\[g\]:\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_MM = /;\s*total\s+filament\s+used\s*\[mm\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_MM_ALT = /;\s*filament\s+used\s*\[mm\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/i
const FILAMENT_USED_M = /;\s*filament\s+used:\s*([0-9]+(?:\.[0-9]+)?)\s*m\b/i
const FILAMENT_WEIGHT = /;\s*filament\s+weight\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*g/i
const TIME_SECONDS = /;\s*time:\s*([0-9]+(?:\.[0-9]+)?)/i
const EST_PRINT_TIME = /;\s*(?:total\s+)?estimated\s+printing\s+time.*?:\s*(.+)$/i
const BUILD_TIME = /;\s*build\s+time:\s*(\d+:\d{2}(?::\d{2})?)/i
const TOTAL_EST_TIME = /;\s*total\s+estimated\s+time:\s*(.+?)(?:;|$)/i

const GRAM_PATTERNS: PatternDef[] = [
  { label: 'filament used [g]=', re: FILAMENT_USED_G },
  { label: 'filament used [g]:', re: FILAMENT_USED_G_COLON },
  { label: 'filament weight =', re: FILAMENT_WEIGHT },
]

const LENGTH_PATTERNS: PatternDef[] = [
  { label: 'total filament used [mm]=', re: FILAMENT_USED_MM },
  { label: 'filament used [mm]=', re: FILAMENT_USED_MM_ALT },
  { label: 'filament used: …m', re: FILAMENT_USED_M },
]

const TIME_PATTERNS: PatternDef[] = [
  { label: 'TIME:', re: TIME_SECONDS },
  { label: 'estimated printing time', re: EST_PRINT_TIME },
  { label: 'build time:', re: BUILD_TIME },
  { label: 'total estimated time:', re: TOTAL_EST_TIME },
]

function splitLines(region: 'head' | 'tail', chunk: string): LineRef[] {
  if (!chunk) return []
  return chunk.split('\n').map((text, i) => ({
    region,
    lineNumber: i + 1,
    text,
  }))
}

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

function firstLineMatch(
  lines: LineRef[],
  field: GcodeParseField,
  patterns: PatternDef[],
): { match: GcodeParseLineMatch; numeric: number } | null {
  for (const line of lines) {
    for (const pat of patterns) {
      pat.re.lastIndex = 0
      const m = pat.re.exec(line.text)
      if (!m) continue
      let numeric: number | null = null
      if (field === 'print_time_seconds') {
        numeric = pat.label === 'TIME:' ? Math.round(Number(m[1])) : parseDurationToken(m[1])
      } else if (field === 'filament_length_mm' && pat.label === 'filament used: …m') {
        numeric = Number(m[1]) * 1000
      } else {
        numeric = Number(m[1])
      }
      if (numeric == null || Number.isNaN(numeric)) continue
      return {
        numeric,
        match: {
          field,
          pattern: pat.label,
          value: m[1].trim(),
          region: line.region,
          lineNumber: line.lineNumber,
          line: line.text,
        },
      }
    }
  }
  return null
}

export function parseGcodeMetadataText(head: string, tail?: string): GcodeMetadataPreview {
  const max = 512_000
  const headChunk = head.slice(0, max)
  const tailChunk = tail ? tail.slice(-max) : ''
  const lines = [...splitLines('head', headChunk), ...splitLines('tail', tailChunk)]
  const parseMatches: GcodeParseLineMatch[] = []

  let grams: number | null = null
  const gHit = firstLineMatch(lines, 'filament_mass_grams', GRAM_PATTERNS)
  if (gHit) {
    grams = gHit.numeric
    parseMatches.push(gHit.match)
  }

  let lengthMm: number | null = null
  const lenHit = firstLineMatch(lines, 'filament_length_mm', LENGTH_PATTERNS)
  if (lenHit) {
    lengthMm = lenHit.numeric
    parseMatches.push(lenHit.match)
  }

  let printSec: number | null = null
  const timeHit = firstLineMatch(lines, 'print_time_seconds', TIME_PATTERNS)
  if (timeHit) {
    printSec = timeHit.numeric
    parseMatches.push(timeHit.match)
  }

  return {
    filament_mass_grams: grams,
    filament_length_mm: lengthMm,
    print_time_seconds: printSec,
    parseMatches,
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

export function fieldLabel(field: GcodeParseField): string {
  switch (field) {
    case 'filament_mass_grams':
      return 'Weight'
    case 'filament_length_mm':
      return 'Length'
    case 'print_time_seconds':
      return 'Print time'
    case 'filament_mass_derived':
      return 'Weight (derived)'
  }
}
