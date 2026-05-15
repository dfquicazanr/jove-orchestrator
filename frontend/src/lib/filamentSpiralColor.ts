/**
 * Map free-text ``loaded_color`` (e.g. "opaque black", "silk gold") to a spiral stroke color.
 * Falls back to a neutral green when unknown.
 */

/** Background of ``.filament-zone`` — used for contrast checks on the spiral. */
export const FILAMENT_ZONE_BG = '#101824'

export function filamentSpiralColor(loadedColor: string): string {
  const raw = loadedColor.trim()
  if (!raw || raw === '—' || raw === '-' || raw === '–') {
    return '#9ccc65'
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) {
    return raw
  }

  const s = raw.toLowerCase()

  const rules: { test: (t: string) => boolean; color: string }[] = [
    { test: (t) => /\b(clear|transparent|crystal)\b/i.test(t) || t.includes('clear'), color: '#81d4fa' },
    { test: (t) => /\b(navy|indigo)\b/i.test(t), color: '#3949ab' },
    { test: (t) => /\b(turquoise|aqua|cyan)\b/i.test(t), color: '#26c6da' },
    { test: (t) => /\b(teal)\b/i.test(t), color: '#00897b' },
    { test: (t) => /\b(blue)\b/i.test(t), color: '#42a5f5' },
    { test: (t) => /\b(purple|violet|lavender)\b/i.test(t), color: '#ab47bc' },
    { test: (t) => /\b(pink|magenta|rose)\b/i.test(t), color: '#ec407a' },
    { test: (t) => /\b(red|cherry|burgundy|maroon)\b/i.test(t), color: '#ef5350' },
    { test: (t) => /\b(orange|amber|tangerine)\b/i.test(t), color: '#ffa726' },
    { test: (t) => /\b(yellow|lemon|canary)\b/i.test(t), color: '#ffee58' },
    { test: (t) => /\b(gold|silk|bronze|brass|copper)\b/i.test(t), color: '#ffca28' },
    { test: (t) => /\b(lime)\b/i.test(t), color: '#c0ca33' },
    { test: (t) => /\b(green|olive|mint)\b/i.test(t), color: '#66bb6a' },
    { test: (t) => /\b(brown|wood|tan|beige)\b/i.test(t), color: '#a1887f' },
    { test: (t) => /\b(gray|grey|silver|chrome|steel)\b/i.test(t), color: '#90a4ae' },
    { test: (t) => /\b(black|charcoal|carbon)\b/i.test(t), color: '#bdbdbd' },
    { test: (t) => /\b(white|ivory|natural)\b/i.test(t), color: '#eceff1' },
  ]

  for (const { test, color } of rules) {
    if (test(s)) return color
  }

  return '#9ccc65'
}

function expandHex3(h: string): [number, number, number] | null {
  if (h.length !== 3) return null
  const r = parseInt(h[0] + h[0], 16)
  const g = parseInt(h[1] + h[1], 16)
  const b = parseInt(h[2] + h[2], 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return null
  return [r, g, b]
}

function expandHex6(h: string): [number, number, number] | null {
  if (h.length !== 6) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return null
  return [r, g, b]
}

/** Parse ``#rgb``, ``#rrggbb``, ``#rrggbbaa``, or ``rgb(...)`` / ``rgba(...)``. */
export function parseCssColorToRgb(input: string): [number, number, number] | null {
  const s = input.trim()
  const hex3 = /^#([0-9a-f]{3})$/i.exec(s)
  if (hex3) return expandHex3(hex3[1].toLowerCase())
  const hex6 = /^#([0-9a-f]{6})$/i.exec(s)
  if (hex6) return expandHex6(hex6[1].toLowerCase())
  const hex8 = /^#([0-9a-f]{8})$/i.exec(s)
  if (hex8) return expandHex6(hex8[1].toLowerCase().slice(0, 6))
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s)
  if (rgba) {
    const r = Math.min(255, Math.max(0, Math.round(Number(rgba[1]))))
    const g = Math.min(255, Math.max(0, Math.round(Number(rgba[2]))))
    const b = Math.min(255, Math.max(0, Math.round(Number(rgba[3]))))
    if ([r, g, b].some((n) => Number.isNaN(n))) return null
    return [r, g, b]
  }
  return null
}

function relativeLuminance(rgb: [number, number, number]): number {
  const linear = rgb.map((c) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/**
 * True when spiral stroke ``fg`` is hard to see on the filament card background
 * (contrast ratio below ~2.75). Then the UI draws a light outline behind the spiral.
 */
export function filamentSpiralLowContrastOnZone(fg: string, bg = FILAMENT_ZONE_BG): boolean {
  const a = parseCssColorToRgb(fg)
  const b = parseCssColorToRgb(bg)
  if (!a || !b) return true
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  const light = Math.max(l1, l2)
  const dark = Math.min(l1, l2)
  const ratio = (light + 0.05) / (dark + 0.05)
  return ratio < 2.75
}
