import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import type { Printer } from '../types/printer'

type Props = {
  open: boolean
  printer: Printer
  onClose: () => void
  onSaved: () => void
}

export function PrinterFilamentModal({ open, printer, onClose, onSaved }: Props) {
  const [material, setMaterial] = useState('')
  const [color, setColor] = useState('')
  const [grams, setGrams] = useState('0')
  const [asNewRoll, setAsNewRoll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setAsNewRoll(false)
    setMaterial(printer.loaded_material)
    setColor(printer.loaded_color)
    setGrams(String(printer.remaining_filament_grams))
  }, [open, printer])

  if (!open) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const g = Number(grams)
    if (Number.isNaN(g) || g < 0) {
      setError('Weight must be a non-negative number.')
      return
    }
    setBusy(true)
    try {
      const path = asNewRoll ? `/printers/${printer.id}/roll` : `/printers/${printer.id}/filament`
      await apiFetch<Printer>(path, {
        method: 'PUT',
        json: {
          loaded_material: material.trim(),
          loaded_color: color.trim(),
          remaining_filament_grams: g,
        },
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fil-modal-title">
        <div className="modal-head">
          <h2 id="fil-modal-title">Loaded filament</h2>
          <button type="button" className="linkish" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={onSubmit}>
          <p className="muted small">
            Material, color, and weight for what is loaded on <strong>{printer.name}</strong>. Connection settings are
            under “Printer”.
          </p>
          {error ? <p className="error">{error}</p> : null}

          <label>
            Material
            <input value={material} onChange={(e) => setMaterial(e.target.value)} maxLength={64} placeholder="PLA" />
          </label>
          <label>
            Color
            <input value={color} onChange={(e) => setColor(e.target.value)} maxLength={128} placeholder="opaque black" />
          </label>
          <label>
            {asNewRoll ? 'Full spool weight (grams)' : 'Remaining filament (grams)'}
            <input type="number" min={0} step={0.1} value={grams} onChange={(e) => setGrams(e.target.value)} />
          </label>

          <label className="checkbox">
            <input type="checkbox" checked={asNewRoll} onChange={(e) => setAsNewRoll(e.target.checked)} />
            New spool / roll change (uses roll endpoint)
          </label>

          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
