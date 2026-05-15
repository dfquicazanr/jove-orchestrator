import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'

type QueueItem = {
  id: number
  gcode_file_id: number
  copy_index: number
  priority: number
  assigned_printer_id: number | null
  status: string
  created_at: string
  updated_at: string
}

export function QueuePage() {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch<QueueItem[]>('/queue/items')
        if (!cancelled) setItems(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load queue')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page">
      <h1>Queue</h1>
      <p className="muted">Print queue items (read-only in UI for now).</p>
      {error ? <p className="error">{error}</p> : null}
      {!items ? <p>Loading…</p> : null}
      {items && items.length === 0 ? <p className="muted">Queue is empty.</p> : null}
      {items && items.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>File</th>
              <th>Copy</th>
              <th>Printer</th>
              <th>Status</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id}>
                <td>{q.id}</td>
                <td>{q.gcode_file_id}</td>
                <td>{q.copy_index}</td>
                <td>{q.assigned_printer_id ?? '—'}</td>
                <td>
                  <span className={`pill ${q.status}`}>{q.status}</span>
                </td>
                <td>{q.priority}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
