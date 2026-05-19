import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api/client'
import { PrintTimeline } from '../components/PrintTimeline'
import { buildPrinterSchedule, queueItemToScheduleInput, type ScheduleJobInput } from '../lib/printerSchedule'
import type { Printer } from '../types/printer'
import type { QueueItem } from '../types/queue'

export function DashboardPage() {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [printers, setPrinters] = useState<Printer[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [timeline, printerRows] = await Promise.all([
        apiFetch<QueueItem[]>('/queue/timeline'),
        apiFetch<Printer[]>('/printers'),
      ])
      setItems(timeline)
      setPrinters(printerRows)
    } catch (e) {
      setItems(null)
      setError(e instanceof Error ? e.message : 'Failed to load schedule')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const { lanes, clips } = useMemo(() => {
    if (!items) return { lanes: [], clips: [] }
    const inputs: ScheduleJobInput[] = items.map((i) => queueItemToScheduleInput(i))
    const activeQueuePrinters = new Set(
      items
        .filter((i) => i.status === 'printing' && i.assigned_printer_id != null)
        .map((i) => i.assigned_printer_id as number),
    )
    // Drop-print / direct Moonraker starts are not always represented in queue timeline rows.
    // Show a synthetic in-progress clip from printer live status when queue has no active row.
    for (const p of printers) {
      if (activeQueuePrinters.has(p.id)) continue
      if (p.last_known_status !== 'printing' && p.last_known_status !== 'paused') continue
      inputs.push({
        id: `live-${p.id}`,
        assignedPrinterId: p.id,
        status: 'printing',
        priority: 0,
        printTimeSeconds: null,
        label: p.last_known_status === 'paused' ? 'Live print (paused)' : 'Live print',
        updatedAt: p.updated_at,
      })
    }
    return buildPrinterSchedule(inputs, printers)
  }, [items, printers])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            Timeline of scheduled, in-progress, and completed prints. Scroll left to see finished jobs.
          </p>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <section className="card print-timeline-card">
        {!items ? <p>Loading schedule…</p> : null}
        {items ? (
          <PrintTimeline
            lanes={lanes}
            clips={clips}
            emptyMessage="No queued, printing, or completed jobs yet."
          />
        ) : null}
      </section>
    </div>
  )
}
