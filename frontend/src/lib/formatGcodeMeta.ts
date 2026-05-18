/** Format slicer-derived metadata for display in library and queue tables. */

export function formatFilamentKg(grams: number | null | undefined): string {
  if (grams == null || Number.isNaN(grams)) return '—'
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`
  return `${(grams / 1000).toFixed(3)} kg`
}

export function formatFilamentMeters(mm: number | null | undefined): string {
  if (mm == null || Number.isNaN(mm)) return '—'
  const m = mm / 1000
  if (m >= 100) return `${m.toFixed(0)} m`
  if (m >= 10) return `${m.toFixed(1)} m`
  return `${m.toFixed(2)} m`
}

/** Format duration as `Xh Ym` (e.g. `1h 3m`, `0h 45m`). */
export function formatPrintTime(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0 && m === 0) return '<1m'
  return `${h}h ${m}m`
}

export function formatFilamentGrams(grams: number | null | undefined): string {
  if (grams == null || Number.isNaN(grams)) return '—'
  if (grams >= 100) return `${grams.toFixed(0)} g`
  if (grams >= 10) return `${grams.toFixed(1)} g`
  return `${grams.toFixed(2)} g`
}
