const LABELS: Record<string, string> = {
  draft: 'Draft',
  queued: 'Queued',
  printing: 'Printing',
  done: 'Done',
  cancelled: 'Cancelled',
  error: 'Error',
}

export function queueStatusLabel(status: string): string {
  return LABELS[status] ?? status
}
