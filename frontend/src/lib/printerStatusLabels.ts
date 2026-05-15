/**
 * Human-readable labels for ``last_known_status``.
 * Values match backend ``PrinterStatus`` in ``backend/app/models/printer.py``:
 * ``offline``, ``powered_off``, ``ready``, ``printing``, ``paused``,
 * ``finished_awaiting_cleanup``, ``error``.
 */
const LABELS: Record<string, string> = {
  offline: 'Offline',
  powered_off: 'Powered off',
  ready: 'Ready to print',
  printing: 'Printing',
  paused: 'Paused',
  finished_awaiting_cleanup: 'Print finished',
  error: 'Error',
}

export function printerStatusLabel(status: string): string {
  return LABELS[status] ?? status.replace(/_/g, ' ')
}
