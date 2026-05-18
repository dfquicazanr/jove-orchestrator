import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import { gcodeFileLabel, gcodeMaterialColorLabel } from '../lib/gcodeLabels'
import type { GCodeFile } from '../types/gcode'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { ColorPresetSelect } from './ColorPresetSelect'

type Props = {
  file: GCodeFile
  materialPresets: MaterialPreheatPreset[]
  busy: boolean
  onSaved: (file: GCodeFile) => void
  onCancel: () => void
}

export function GcodeLibraryEditPanel({ file, materialPresets, busy, onSaved, onCancel }: Props) {
  const [displayName, setDisplayName] = useState(file.display_name)
  const [materialPresetId, setMaterialPresetId] = useState(file.material_preset_id != null ? String(file.material_preset_id) : '')
  const [colorPresetId, setColorPresetId] = useState(
    file.material_color_preset_id != null ? String(file.material_color_preset_id) : '',
  )
  const [copies, setCopies] = useState(String(file.total_copies_requested))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(file.display_name)
    setMaterialPresetId(file.material_preset_id != null ? String(file.material_preset_id) : '')
    setColorPresetId(file.material_color_preset_id != null ? String(file.material_color_preset_id) : '')
    setCopies(String(file.total_copies_requested))
    setError(null)
  }, [file])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const n = Number(copies)
    if (!Number.isInteger(n) || n < 1) {
      setError('Default copies must be a positive whole number.')
      return
    }
    const preset = materialPresetId ? materialPresets.find((p) => String(p.id) === materialPresetId) : null
    try {
      const saved = await apiFetch<GCodeFile>(`/gcode/files/${file.id}`, {
        method: 'PATCH',
        json: {
          display_name: displayName.trim() || file.display_name,
          material_preset_id: materialPresetId ? Number(materialPresetId) : null,
          required_material: preset?.name ?? null,
          material_color_preset_id: colorPresetId ? Number(colorPresetId) : null,
          total_copies_requested: n,
        },
      })
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <form className="gcode-library-edit" onSubmit={(e) => void onSubmit(e)}>
      <p className="muted small" title={file.original_filename}>
        Stored as: {file.original_filename}
      </p>
      {error ? <p className="error">{error}</p> : null}
      <label>
        Friendly name
        <input value={displayName} maxLength={256} disabled={busy} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <ColorPresetSelect
        materialPresets={materialPresets}
        materialPresetId={materialPresetId}
        value={colorPresetId}
        disabled={busy}
        allowEmptyMaterial
        onMaterialPresetIdChange={setMaterialPresetId}
        onColorPresetIdChange={setColorPresetId}
      />
      <label>
        Default copies
        <input type="number" min={1} value={copies} disabled={busy} onChange={(e) => setCopies(e.target.value)} />
      </label>
      <p className="muted small">
        Saving updates every print kit that includes this file (material and color).
      </p>
      <div className="btn-row">
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

export function GcodeLibraryDetailView({
  file,
  busy,
  onEdit,
  onAddQueue,
  onDelete,
}: {
  file: GCodeFile
  busy: boolean
  onEdit: () => void
  onAddQueue: () => void
  onDelete: () => void
}) {
  return (
    <>
      <h3 className="gcode-library-detail-title">{gcodeFileLabel(file)}</h3>
      <p className="muted small" title={file.original_filename}>
        {file.original_filename}
      </p>
      <dl className="gcode-library-detail-dl">
        <dt>Material</dt>
        <dd>{gcodeMaterialColorLabel(file)}</dd>
        <dt>Filament (est.)</dt>
        <dd>
          {file.filament_mass_grams_estimate != null ? `${file.filament_mass_grams_estimate.toFixed(1)} g` : '—'}
        </dd>
        <dt>Default copies</dt>
        <dd>{file.total_copies_requested}</dd>
        <dt>Queue jobs</dt>
        <dd>{file.queue_item_count}</dd>
      </dl>
      <div className="gcode-library-detail-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={onEdit}>
          Edit…
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={onAddQueue}>
          Add to queue…
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  )
}
