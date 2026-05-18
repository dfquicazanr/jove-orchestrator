import type { MaterialColorPreset, MaterialPreheatPreset } from '../types/materialPreheat'

type Props = {
  materialPresets: MaterialPreheatPreset[]
  materialPresetId: string
  value: string
  disabled?: boolean
  onMaterialPresetIdChange: (id: string) => void
  onColorPresetIdChange: (id: string) => void
  materialLabel?: string
  colorLabel?: string
  allowEmptyMaterial?: boolean
}

export function ColorPresetSelect({
  materialPresets,
  materialPresetId,
  value,
  disabled,
  onMaterialPresetIdChange,
  onColorPresetIdChange,
  materialLabel = 'Material',
  colorLabel = 'Color (optional)',
  allowEmptyMaterial = false,
}: Props) {
  const material = materialPresets.find((p) => String(p.id) === materialPresetId)
  const colors: MaterialColorPreset[] = material?.color_presets ?? []

  return (
    <div className="color-preset-select-row">
      <label>
        {materialLabel}
        <select
          value={materialPresetId}
          disabled={disabled}
          onChange={(e) => {
            onMaterialPresetIdChange(e.target.value)
            onColorPresetIdChange('')
          }}
        >
          {allowEmptyMaterial ? <option value="">— None —</option> : null}
          {materialPresets.length === 0 ? (
            <option value="">No materials defined</option>
          ) : (
            materialPresets.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))
          )}
        </select>
      </label>
      <label>
        {colorLabel}
        <select
          value={value}
          disabled={disabled || !materialPresetId || colors.length === 0}
          onChange={(e) => onColorPresetIdChange(e.target.value)}
        >
          <option value="">— None —</option>
          {colors.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {material ? `${material.name} · ${c.name}` : c.name}
              {c.hex ? ` (${c.hex})` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
