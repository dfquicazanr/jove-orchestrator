/** Klipper print job phase derived from ``last_known_status``. */
export type PrintJobPhase = 'idle' | 'printing' | 'paused'

export function printJobPhase(status: string): PrintJobPhase {
  if (status === 'paused') return 'paused'
  if (status === 'printing') return 'printing'
  return 'idle'
}

/** Show Pause / Resume / Cancel when a job is active on the printer. */
export function showPrintJobControls(status: string): boolean {
  return printJobPhase(status) !== 'idle'
}
