import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import { parseCopies } from '../lib/gcodeUpload'
import type { GCodeFile } from '../types/gcode'
import type { QueueItem } from '../types/queue'

type Props = {
  file: GCodeFile | null
  open: boolean
  onClose: () => void
  onAdded: (items: QueueItem[]) => void | Promise<void>
}

export function GcodeAddToQueueModal({ file, open, onClose, onAdded }: Props) {
  const [copies, setCopies] = useState('1')
  const [priority, setPriority] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !file) return
    setCopies('1')
    setPriority('0')
    setError(null)
  }, [open, file])

  if (!open || !file) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const n = parseCopies(copies)
    if (n === null) {
      setError('Copies must be a whole number from 1 to 10000.')
      return
    }
    const pri = Number(priority)
    if (Number.isNaN(pri)) {
      setError('Priority must be a number.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const items = await apiFetch<QueueItem[]>('/queue/items', {
        method: 'POST',
        json: { gcode_file_id: file.id, copies: n, priority: pri },
      })
      await onAdded(items)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to queue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (!busy && ev.target === ev.currentTarget) onClose()
      }}
    >
      <div className="modal gcode-add-queue-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Add to queue</h2>
          <button type="button" className="linkish" disabled={busy} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={(e) => void handleSubmit(e)}>
          <p className="muted small">
            Create <strong>draft</strong> jobs for <strong>{file.original_filename}</strong>. Use the Queue tab
            planner to assign printers.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <label>
            Copies
            <input
              type="number"
              min={1}
              max={10000}
              value={copies}
              disabled={busy}
              onChange={(e) => setCopies(e.target.value)}
            />
          </label>
          <label>
            Priority
            <input
              type="number"
              value={priority}
              disabled={busy}
              onChange={(e) => setPriority(e.target.value)}
            />
          </label>
          <div className="farm-bulk-confirm-actions">
            <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? '…' : 'Add drafts'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
