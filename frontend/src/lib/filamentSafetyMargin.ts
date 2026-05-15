/** API waste_factor (1.0–2.0) ↔ UI extra-headroom percent (0–100). */

export function percentToWasteFactor(percent: number): number {
  return 1 + percent / 100
}

export function wasteFactorToPercent(wasteFactor: number): number {
  return Math.round((wasteFactor - 1) * 100)
}

export function parseSafetyMarginPercent(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) return null
  return n
}
