import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import type { MaterialPreheatPreset } from '../types/materialPreheat'

type Row = {
  key: string
  name: string
  hotend_c: string
  bed_c: string
}

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (presets: MaterialPreheatPreset[]) => void
}

function toRows(presets: MaterialPreheatPreset[]): Row[] {
  return presets.map((p) => ({
    key: String(p.id),
    name: p.name,
    hotend_c: String(p.hotend_c),
    bed_c: String(p.bed_c),
  }))
}

function newRow(): Row {
  return { key: `new-${crypto.randomUUID()}`, name: '', hotend_c: '200', bed_c: '60' }
}

export function MaterialPreheatSettingsModal({ open, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    void (async () => {
      try {
        const presets = await apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat')
        setRows(toRows(presets))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load presets')
        setRows([newRow()])
      }
    })()
  }, [open])

  if (!open) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed: { name: string; hotend_c: number; bed_c: number; sort_order: number }[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const name = row.name.trim()
      if (!name) {
        setError(`Row ${i + 1}: name is required.`)
        return
      }
      const hotend = Number(row.hotend_c)
      const bed = Number(row.bed_c)
      if (Number.isNaN(hotend) || hotend < 0 || hotend > 400) {
        setError(`Row ${i + 1}: hotend must be 0–400°C.`)
        return
      }
      if (Number.isNaN(bed) || bed < 0 || bed > 150) {
        setError(`Row ${i + 1}: bed must be 0–150°C.`)
        return
      }
      parsed.push({ name, hotend_c: hotend, bed_c: bed, sort_order: i })
    }

    if (parsed.length === 0) {
      setError('Add at least one material preset.')
      return
    }

    const names = parsed.map((p) => p.name.toLowerCase())
    if (new Set(names).size !== names.length) {
      setError('Each material name must be unique.')
      return
    }

    setBusy(true)
    try {
      const saved = await apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat', {
        method: 'PUT',
        json: { presets: parsed },
      })
      onSaved(saved)
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
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="preheat-settings-title">
        <div className="modal-head">
          <h2 id="preheat-settings-title">Material preheat presets</h2>
          <button type="button" className="linkish" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={onSubmit}>
          <p className="muted small">
            These temperatures are used for the preheat buttons in Farm <strong>Controls</strong> view.
          </p>
          {error ? <p className="error">{error}</p> : null}

          <div className="preheat-presets-table-wrap">
            <table className="table preheat-presets-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Hotend (°C)</th>
                  <th>Bed (°C)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.key}>
                    <td>
                      <input
                        value={row.name}
                        onChange={(e) => {
                          const name = e.target.value
                          setRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, name } : r)),
                          )
                        }}
                        placeholder="PLA"
                        maxLength={64}
                        disabled={busy}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={400}
                        value={row.hotend_c}
                        onChange={(e) => {
                          const hotend_c = e.target.value
                          setRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, hotend_c } : r)),
                          )
                        }}
                        disabled={busy}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={150}
                        value={row.bed_c}
                        onChange={(e) => {
                          const bed_c = e.target.value
                          setRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, bed_c } : r)),
                          )
                        }}
                        disabled={busy}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm secondary"
                        disabled={busy || rows.length <= 1}
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn sm secondary"
            disabled={busy}
            onClick={() => setRows((prev) => [...prev, newRow()])}
          >
            Add material
          </button>

          <div className="btn-row">
            <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save presets'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
