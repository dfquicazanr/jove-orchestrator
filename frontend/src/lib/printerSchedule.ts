/** Build timeline clips (printer channel × time) from queue-like rows. */

export type ScheduleJobStatus = 'done' | 'printing' | 'queued' | 'draft' | 'cancelled' | 'error'

export type ScheduleJobInput = {
  id: number | string
  assignedPrinterId: number | null
  status: string
  priority: number
  printTimeSeconds: number | null
  /** Planner session override when slicer metadata is missing. */
  durationOverrideSeconds?: number | null
  label: string
  updatedAt?: string
  gcodeFileId?: number
}

export type TimelineClip = {
  id: string
  sourceId: number | string
  printerId: number | null
  laneKey: string
  label: string
  status: ScheduleJobStatus
  startMs: number
  endMs: number
  missingDuration: boolean
  gcodeFileId?: number
}

export type PrinterLane = {
  key: string
  printerId: number | null
  label: string
}

const FALLBACK_DURATION_MS = 30 * 60 * 1000

function durationMs(job: ScheduleJobInput): { ms: number; missing: boolean } {
  const sec = job.durationOverrideSeconds ?? job.printTimeSeconds
  if (sec == null || sec <= 0) {
    return { ms: FALLBACK_DURATION_MS, missing: true }
  }
  return { ms: sec * 1000, missing: false }
}

function parseTime(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback
  const t = Date.parse(iso)
  return Number.isNaN(t) ? fallback : t
}

function compareQueued(a: ScheduleJobInput, b: ScheduleJobInput): number {
  if (b.priority !== a.priority) return b.priority - a.priority
  const aid = typeof a.id === 'number' ? a.id : 0
  const bid = typeof b.id === 'number' ? b.id : 0
  return aid - bid
}

export function buildPrinterSchedule(
  items: ScheduleJobInput[],
  printers: { id: number; name: string }[],
  nowMs: number = Date.now(),
): { lanes: PrinterLane[]; clips: TimelineClip[] } {
  const printerLanes: PrinterLane[] = printers.map((p) => ({
    key: `p-${p.id}`,
    printerId: p.id,
    label: p.name,
  }))

  const unassigned = items.filter(
    (i) => (i.status === 'draft' || i.status === 'queued') && i.assignedPrinterId == null,
  )
  const lanes: PrinterLane[] = [...printerLanes]
  if (unassigned.length > 0) {
    lanes.unshift({ key: 'unassigned', printerId: null, label: 'Unassigned' })
  }

  const clips: TimelineClip[] = []

  for (const lane of lanes) {
    const laneItems =
      lane.printerId == null
        ? unassigned
        : items.filter((i) => i.assignedPrinterId === lane.printerId && i.status !== 'cancelled')

    const done = laneItems
      .filter((i) => i.status === 'done')
      .sort((a, b) => parseTime(a.updatedAt, 0) - parseTime(b.updatedAt, 0))
    const printing = laneItems.filter((i) => i.status === 'printing')
    const queued = laneItems.filter((i) => i.status === 'queued').sort(compareQueued)
    const drafts = laneItems.filter((i) => i.status === 'draft').sort(compareQueued)

    let futureCursor = nowMs
    for (const job of printing) {
      const { ms, missing } = durationMs(job)
      const start = parseTime(job.updatedAt, nowMs)
      const end = Math.max(start + ms, nowMs)
      clips.push(clip(job, lane, start, end, missing))
      futureCursor = Math.max(futureCursor, end)
    }
    if (printing.length === 0) {
      futureCursor = nowMs
    }

    for (const job of [...queued, ...drafts]) {
      const { ms, missing } = durationMs(job)
      const start = futureCursor
      const end = start + ms
      clips.push(clip(job, lane, start, end, missing))
      futureCursor = end
    }

    let pastEnd = printing.length > 0 ? parseTime(printing[0].updatedAt, nowMs) : nowMs
    const doneDesc = [...done].sort((a, b) => parseTime(b.updatedAt, 0) - parseTime(a.updatedAt, 0))
    for (const job of doneDesc) {
      const { ms, missing } = durationMs(job)
      const end = parseTime(job.updatedAt, pastEnd)
      const start = end - ms
      clips.push(clip(job, lane, start, end, missing))
      pastEnd = start
    }
  }

  return { lanes, clips }
}

function clip(
  job: ScheduleJobInput,
  lane: PrinterLane,
  startMs: number,
  endMs: number,
  missingDuration: boolean,
): TimelineClip {
  return {
    id: `${lane.key}-${job.id}`,
    sourceId: job.id,
    printerId: lane.printerId,
    laneKey: lane.key,
    label: job.label,
    status: job.status as ScheduleJobStatus,
    startMs,
    endMs,
    missingDuration,
    gcodeFileId: job.gcodeFileId,
  }
}

export function scheduleTimeBounds(clips: TimelineClip[], nowMs: number): { startMs: number; endMs: number } {
  let startMs = nowMs - 2 * 3600 * 1000
  let endMs = nowMs + 6 * 3600 * 1000
  for (const c of clips) {
    startMs = Math.min(startMs, c.startMs)
    endMs = Math.max(endMs, c.endMs)
  }
  const pad = 15 * 60 * 1000
  return { startMs: startMs - pad, endMs: endMs + pad }
}

export function formatTimelineTick(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function queueItemToScheduleInput(
  item: {
    id: number
    assigned_printer_id: number | null
    status: string
    priority: number
    updated_at: string
    gcode_file: {
      id: number
      display_name?: string
      original_filename: string
      print_time_seconds: number | null
    }
  },
  durationOverrides?: Map<number, number>,
): ScheduleJobInput {
  const gf = item.gcode_file
  const label = gf.display_name?.trim() || gf.original_filename
  return {
    id: item.id,
    assignedPrinterId: item.assigned_printer_id,
    status: item.status,
    priority: item.priority,
    printTimeSeconds: gf.print_time_seconds,
    durationOverrideSeconds: durationOverrides?.get(gf.id) ?? null,
    label,
    updatedAt: item.updated_at,
    gcodeFileId: gf.id,
  }
}
