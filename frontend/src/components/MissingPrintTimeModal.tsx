import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import { formatPrintTime } from '../lib/formatGcodeMeta'
import type { GCodeFile } from '../types/gcode'

type Props = {
  files: GCodeFile[]
  open: boolean
  onClose: () => void
  onSaved: (updated: GCodeFile[]) => void
}

function parseDurationSeconds(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 1) return null
  return n
}

export function MissingPrintTimeModal({ files, open, onClose, onSaved }: Props) {
  const [values, setValues] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const init: Record<number, string> = {}
    for (const f of files) init[f.id] = ''
    setValues(init)
    setError(null)
  }, [open, files])

  if (!open || files.length === 0) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const updates: { file: GCodeFile; seconds: number }[] = []
    for (const f of files) {
      const sec = parseDurationSeconds(values[f.id] ?? '')
      if (sec == null) {
        setError(`Enter print duration in seconds for “${f.display_name}”.`)
        return
      }
      updates.push({ file: f, seconds: sec })
    }
    setError(null)
    setBusy(true)
    try {
      const saved: GCodeFile[] = []
      for (const { file, seconds } of updates) {
        const row = await apiFetch<GCodeFile>(`/gcode/files/${file.id}`, {
          method: 'PATCH',
          json: { print_time_seconds: seconds },
        })
        saved.push(row)
      }
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save print times')
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
      <div className="modal missing-print-time-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Print duration required</h2>
          <button type="button" className="linkish" disabled={busy} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={(e) => void handleSubmit(e)}>
          <p className="muted small">
            These files have no slicer print time. Enter an estimate in seconds so the schedule can be
            drawn.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <ul className="missing-print-time-list">
            {files.map((f) => (
              <li key={f.id}>
                <div className="missing-print-time-file">
                  <strong>{f.display_name}</strong>
                  <span className="muted small">{f.original_filename}</span>
                </div>
                <label>
                  Duration (seconds)
                  <input
                    type="number"
                    min={1}
                    step={60}
                    required
                    disabled={busy}
                    value={values[f.id] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                  />
                </label>
                {values[f.id] ? (
                  <span className="muted small">≈ {formatPrintTime(parseDurationSeconds(values[f.id] ?? ''))}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save & continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
