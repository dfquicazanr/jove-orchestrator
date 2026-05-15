import { useRef, useState, type FormEvent } from 'react'
import { apiUpload } from '../api/upload'
import type { Printer } from '../types/printer'

type PrintResult = {
  ok: boolean
  message?: string | null
  moonraker_path?: string | null
  print_started?: boolean
  print_queued?: boolean
}

type Props = {
  open: boolean
  printer: Printer
  onClose: () => void
}

export function SendGcodeModal({ open, printer, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  if (!open) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Choose a G-code file first.')
      return
    }
    setError(null)
    setSuccess(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file, file.name)
      const res = await apiUpload<PrintResult>(`/printers/${printer.id}/gcode/print`, fd)
      const parts: string[] = []
      if (res.print_started) {
        parts.push('Print started on the printer.')
      } else if (res.print_queued) {
        parts.push('Print queued on the printer.')
      } else if (res.moonraker_path) {
        parts.push(`Uploaded as “${res.moonraker_path}”.`)
      } else {
        parts.push('Uploaded to Moonraker.')
      }
      if (res.message) parts.push(res.message)
      setSuccess(parts.join(' '))
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="send-gcode-title">
        <div className="modal-head">
          <h2 id="send-gcode-title">Send G-code</h2>
          <button type="button" className="linkish" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={onSubmit}>
          <p className="muted small">
            Upload to <strong>{printer.name}</strong> via Moonraker and start printing immediately.
          </p>
          {error ? <p className="error">{error}</p> : null}
          {success ? <p className="success subtle">{success}</p> : null}

          <label>
            G-code file
            <input
              ref={inputRef}
              type="file"
              accept=".gcode,.gco,.bgcode"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
                setSuccess(null)
              }}
            />
          </label>

          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={busy || !file}>
              {busy ? 'Sending…' : 'Upload & print'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
