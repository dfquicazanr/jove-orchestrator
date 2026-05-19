import { useState, type FormEvent } from 'react'
import { apiUpload } from '../api/upload'
import type { DropPrintPreview } from '../lib/dropPrintPrepare'
import {
  wakePrinterAndWaitReady,
  type WakeProgress,
} from '../lib/dropPrintWake'
import type { PrinterLiveUpdate } from '../hooks/usePrinterStatusStream'
import {
  formatFilamentGrams,
  formatFilamentMeters,
  formatPrintTime,
} from '../lib/formatGcodeMeta'
import { printerStatusLabel } from '../lib/printerStatusLabels'

type PrintResult = {
  ok: boolean
  message?: string | null
  moonraker_path?: string | null
  print_started?: boolean
  print_queued?: boolean
  remaining_filament_grams?: number | null
}

type Props = {
  preview: DropPrintPreview
  onClose: () => void
  onPrinted: (printerId: number, remainingFilamentGrams: number | null) => void
  /** Refresh farm DB/SSE after wake pings or print (printer was off). */
  onFarmRefresh?: () => void
  /** Apply live/sync patches to farm cards during wake polling. */
  onLivePatch?: (live: PrinterLiveUpdate) => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function massLabel(preview: DropPrintPreview): string {
  const g = preview.requiredGrams
  if (g == null) return '—'
  const base = formatFilamentGrams(g)
  if (preview.massSource === 'gcode') return `${base} (from G-code)`
  if (preview.massSource === 'estimated') return `${base} (estimated)`
  return base
}

export function DropPrintConfirmModal({
  preview,
  onClose,
  onPrinted,
  onFarmRefresh,
  onLivePatch,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<WakeProgress | null>(null)

  const { file, printer, metadata, reconciled, warnings, wakePlan } = preview
  const needsWake = wakePlan === 'power_on'
  const loadedMaterial = printer.loaded_material.trim() || '—'
  const loadedColor = printer.loaded_color.trim() || '—'

  async function uploadAndPrint() {
    setProgress({ phase: 'uploading', message: 'Uploading G-code and starting print…' })
    const fd = new FormData()
    fd.append('file', file, file.name)
    if (preview.requiredGrams != null && preview.requiredGrams > 0) {
      fd.append('filament_used_grams', String(preview.requiredGrams))
    }
    const res = await apiUpload<PrintResult>(`/printers/${printer.id}/gcode/print`, fd)
    onPrinted(printer.id, res.remaining_filament_grams ?? preview.afterPrintGrams)
    onClose()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    setProgress(null)
    try {
      if (needsWake) {
        await wakePrinterAndWaitReady(printer.id, setProgress, onLivePatch)
        onFarmRefresh?.()
      }
      await uploadAndPrint()
      onFarmRefresh?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start print')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal drop-print-modal" role="dialog" aria-modal="true" aria-labelledby="drop-print-title">
        <div className="modal-head">
          <h2 id="drop-print-title">Start print on {printer.name}?</h2>
          <button type="button" className="linkish" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={(e) => void onSubmit(e)}>
          <p className="muted small">
            {needsWake
              ? 'Turns on printer power if needed, waits for Ready, then uploads to Moonraker and starts the job.'
              : 'Upload to Moonraker and start printing. Filament on this printer will be updated when usage is known.'}
          </p>

          {busy && progress ? (
            <p className="drop-print-progress" role="status">
              {progress.message}
            </p>
          ) : null}

          {error ? <p className="error">{error}</p> : null}

          {warnings.length > 0 ? (
            <ul className="drop-print-warnings" role="list">
              {warnings.map((w) => (
                <li key={w.id} className={w.id === 'low-filament' ? 'drop-print-warning--strong' : undefined}>
                  {w.message}
                </li>
              ))}
            </ul>
          ) : null}

          <dl className="drop-print-summary">
            <div>
              <dt>File</dt>
              <dd title={file.name}>
                {file.name}
                <span className="muted small"> · {formatFileSize(file.size)}</span>
              </dd>
            </div>
            <div>
              <dt>Printer status</dt>
              <dd>{printerStatusLabel(printer.last_known_status)}</dd>
            </div>
            <div>
              <dt>Est. duration</dt>
              <dd>{formatPrintTime(metadata.print_time_seconds)}</dd>
            </div>
            <div>
              <dt>Filament needed</dt>
              <dd>{massLabel(preview)}</dd>
            </div>
            {reconciled.lengthMm != null ? (
              <div>
                <dt>Filament length</dt>
                <dd>
                  {formatFilamentMeters(reconciled.lengthMm)}
                  {metadata.filament_length_mm == null && reconciled.lengthFromDensity
                    ? ' (estimated)'
                    : metadata.filament_length_mm != null
                      ? ' (from G-code)'
                      : ''}
                </dd>
              </div>
            ) : null}
            {preview.fileMaterial ? (
              <div>
                <dt>File material</dt>
                <dd>{preview.fileMaterial}</dd>
              </div>
            ) : null}
            {preview.fileColor ? (
              <div>
                <dt>File color</dt>
                <dd>{preview.fileColor}</dd>
              </div>
            ) : null}
            <div>
              <dt>Loaded material</dt>
              <dd>{loadedMaterial}</dd>
            </div>
            <div>
              <dt>Loaded color</dt>
              <dd>{loadedColor}</dd>
            </div>
            <div>
              <dt>On spool now</dt>
              <dd>{formatFilamentGrams(preview.remainingGrams)}</dd>
            </div>
            {preview.afterPrintGrams != null ? (
              <div>
                <dt>After print (est.)</dt>
                <dd className={preview.insufficientFilament ? 'drop-print-after--low' : undefined}>
                  {formatFilamentGrams(preview.afterPrintGrams)}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="btn-row">
            <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy
                ? progress?.phase === 'uploading'
                  ? 'Starting print…'
                  : 'Working…'
                : needsWake
                  ? 'Power on & print'
                  : 'Start print'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
