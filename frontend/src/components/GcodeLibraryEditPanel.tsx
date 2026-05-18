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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDisplayName(file.display_name)
    setMaterialPresetId(file.material_preset_id != null ? String(file.material_preset_id) : '')
    setColorPresetId(file.material_color_preset_id != null ? String(file.material_color_preset_id) : '')
    setError(null)
  }, [file])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const preset = materialPresetId ? materialPresets.find((p) => String(p.id) === materialPresetId) : null
    try {
      const saved = await apiFetch<GCodeFile>(`/gcode/files/${file.id}`, {
        method: 'PATCH',
        json: {
          display_name: displayName.trim() || file.display_name,
          material_preset_id: materialPresetId ? Number(materialPresetId) : null,
          required_material: preset?.name ?? null,
          material_color_preset_id: colorPresetId ? Number(colorPresetId) : null,
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
          {file.filament_length_mm != null ? ` · ${(file.filament_length_mm / 1000).toFixed(2)} m` : ''}
          {file.filament_mass_grams_estimate == null || file.filament_length_mm == null ? (
            <span className="gcode-metadata-warnings gcode-metadata-warnings--alert">
              {file.filament_mass_grams_estimate == null ? ' Weight missing from file.' : ''}
              {file.filament_length_mm == null ? ' Length missing from file.' : ''}
            </span>
          ) : null}
        </dd>
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
