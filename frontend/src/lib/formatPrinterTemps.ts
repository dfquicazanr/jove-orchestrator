/** Pretty-print actual / target °C lines for printer cards (Moonraker `extruder` / `heater_bed`). */
export function formatHeaterActualTarget(
  actual: number | null | undefined,
  target: number | null | undefined,
): string {
  const aOk = typeof actual === 'number' && !Number.isNaN(actual)
  const tOk = typeof target === 'number' && !Number.isNaN(target)
  if (aOk && tOk) {
    return `${round1(actual)} → ${round1(target)}`
  }
  if (aOk) return `${round1(actual)}`
  if (tOk) return `→ ${round1(target)}`
  return '—'
}

export function printerHasRenderableTemps(printer: {
  extruder_actual_c?: number | null
  extruder_target_c?: number | null
  bed_actual_c?: number | null
  bed_target_c?: number | null
}): boolean {
  const vals = [
    printer.extruder_actual_c,
    printer.extruder_target_c,
    printer.bed_actual_c,
    printer.bed_target_c,
  ]
  return vals.some((v) => typeof v === 'number' && !Number.isNaN(v))
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}
