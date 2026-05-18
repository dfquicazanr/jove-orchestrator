import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api/client'
import { PrintTimeline } from '../components/PrintTimeline'
import { buildPrinterSchedule, queueItemToScheduleInput } from '../lib/printerSchedule'
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
    const id = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(id)
  }, [load])

  const { lanes, clips } = useMemo(() => {
    if (!items) return { lanes: [], clips: [] }
    const inputs = items.map((i) => queueItemToScheduleInput(i))
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
