import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { MOCK_PREHEAT_PRESETS } from '../types/materialPreheat'
import type { Printer } from '../types/printer'
import { ColorPresetSelect } from './ColorPresetSelect'

type Props = {
  open: boolean
  printer: Printer
  onClose: () => void
  onSaved: () => void
}

function findMaterialId(presets: MaterialPreheatPreset[], loadedMaterial: string): string {
  const norm = loadedMaterial.trim().toLowerCase()
  if (!norm) return ''
  const hit = presets.find((p) => p.name.toLowerCase() === norm)
  return hit ? String(hit.id) : ''
}

function findColorId(presets: MaterialPreheatPreset[], materialId: string, loadedColor: string): string {
  const norm = loadedColor.trim().toLowerCase()
  if (!norm || !materialId) return ''
  const material = presets.find((p) => String(p.id) === materialId)
  const hit = material?.color_presets?.find((c) => c.name.toLowerCase() === norm)
  return hit ? String(hit.id) : ''
}

export function PrinterFilamentModal({ open, printer, onClose, onSaved }: Props) {
  const [materialPresets, setMaterialPresets] = useState<MaterialPreheatPreset[]>([])
  const [materialPresetId, setMaterialPresetId] = useState('')
  const [colorPresetId, setColorPresetId] = useState('')
  const [grams, setGrams] = useState('0')
  const [asNewRoll, setAsNewRoll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPresets = useCallback(async () => {
    try {
      const data = await apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat')
      setMaterialPresets(data)
    } catch {
      setMaterialPresets(MOCK_PREHEAT_PRESETS)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setError(null)
    setAsNewRoll(false)
    setGrams(String(printer.remaining_filament_grams))
    void loadPresets().then(() => {
      setMaterialPresetId(findMaterialId(materialPresets, printer.loaded_material))
      setColorPresetId('')
    })
  }, [open, printer, loadPresets])

  useEffect(() => {
    if (!open || materialPresets.length === 0) return
    const mid = findMaterialId(materialPresets, printer.loaded_material)
    setMaterialPresetId(mid)
    setColorPresetId(findColorId(materialPresets, mid, printer.loaded_color))
  }, [open, printer.loaded_material, printer.loaded_color, materialPresets])

  if (!open) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const g = Number(grams)
    if (Number.isNaN(g) || g < 0) {
      setError('Weight must be a non-negative number.')
      return
    }
    const preset = materialPresetId ? materialPresets.find((p) => String(p.id) === materialPresetId) : null
    const color = colorPresetId
      ? preset?.color_presets?.find((c) => String(c.id) === colorPresetId)
      : null
    const loaded_material = preset?.name ?? ''
    const loaded_color = color?.name ?? ''

    setBusy(true)
    try {
      const path = asNewRoll ? `/printers/${printer.id}/roll` : `/printers/${printer.id}/filament`
      await apiFetch<Printer>(path, {
        method: 'PUT',
        json: {
          loaded_material,
          loaded_color,
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
            Material and optional color for <strong>{printer.name}</strong>. Planner matching uses material only
            today; color is stored for your reference.
          </p>
          {error ? <p className="error">{error}</p> : null}

          <ColorPresetSelect
            materialPresets={materialPresets}
            materialPresetId={materialPresetId}
            value={colorPresetId}
            disabled={busy}
            allowEmptyMaterial
            materialLabel="Material"
            colorLabel="Color (optional)"
            onMaterialPresetIdChange={(id) => {
              setMaterialPresetId(id)
              setColorPresetId('')
            }}
            onColorPresetIdChange={setColorPresetId}
          />

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
