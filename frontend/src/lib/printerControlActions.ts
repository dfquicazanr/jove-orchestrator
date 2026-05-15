export type PrinterControlAction =
  | 'home'
  | 'home_xy'
  | `preheat:${number}`
  | 'cooldown'
  | 'cancel_print'
  | 'pause_print'
  | 'resume_print'
  | 'power_on'
  | 'power_off'

export function preheatControlAction(presetId: number): `preheat:${number}` {
  return `preheat:${presetId}`
}

export function parsePreheatPresetId(action: PrinterControlAction): number | null {
  if (typeof action !== 'string' || !action.startsWith('preheat:')) return null
  const id = Number(action.slice(8))
  return Number.isFinite(id) ? id : null
}
