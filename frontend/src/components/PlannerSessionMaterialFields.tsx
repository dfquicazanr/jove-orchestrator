import type { GCodeFile } from '../types/gcode'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import type { PlannerSessionItem } from '../types/plannerSession'
import {
  applyFileMaterialDefaults,
  fileDefaultColor,
  fileDefaultMaterial,
} from '../lib/plannerRequirements'

type Props = {
  item: PlannerSessionItem
  file: GCodeFile
  materials: MaterialPreheatPreset[]
  disabled?: boolean
  onChange: (item: PlannerSessionItem) => void
}

function fileMaterialLabel(file: GCodeFile): string {
  const d = fileDefaultMaterial(file)
  return d.name ? `From file (${d.name})` : 'From file'
}

function fileColorLabel(file: GCodeFile): string {
  const d = fileDefaultColor(file)
  return d.name ? `From file (${d.name})` : 'From file'
}

export function PlannerSessionMaterialFields({
  item,
  file,
  materials,
  disabled,
  onChange,
}: Props) {
  const materialKey = item.matchAnyMaterial
    ? 'any'
    : item.materialPresetId != null
      ? `preset:${item.materialPresetId}`
      : 'file'

  const colorKey = item.matchAnyColor
    ? 'any'
    : item.materialColorPresetId != null
      ? `preset:${item.materialColorPresetId}`
      : 'file'

  const activeMaterial =
    item.materialPresetId != null
      ? materials.find((m) => m.id === item.materialPresetId)
      : item.materialPresetName
        ? materials.find((m) => m.name === item.materialPresetName)
        : materials.find((m) => m.id === file.material_preset_id)

  const colorOptions = activeMaterial?.color_presets ?? []

  function setMaterial(value: string) {
    if (value === 'any') {
      onChange({ ...item, matchAnyMaterial: true, matchAnyColor: item.matchAnyColor })
      return
    }
    if (value === 'file') {
      onChange(applyFileMaterialDefaults(item, file))
      return
    }
    const id = Number(value.replace('preset:', ''))
    const preset = materials.find((m) => m.id === id)
    if (!preset) return
    const defaultColor = preset.color_presets?.find((c) => c.is_default) ?? preset.color_presets?.[0]
    onChange({
      ...item,
      matchAnyMaterial: false,
      materialPresetId: preset.id,
      materialPresetName: preset.name,
      materialColorPresetId: defaultColor?.id ?? null,
      materialColorPresetName: defaultColor?.name ?? null,
      matchAnyColor: defaultColor ? false : item.matchAnyColor,
    })
  }

  function setColor(value: string) {
    if (value === 'any') {
      onChange({
        ...item,
        matchAnyColor: true,
        materialColorPresetId: null,
        materialColorPresetName: null,
      })
      return
    }
    if (value === 'file') {
      const col = fileDefaultColor(file)
      onChange({
        ...item,
        matchAnyColor: false,
        materialColorPresetId: col.id,
        materialColorPresetName: col.name,
      })
      return
    }
    const id = Number(value.replace('preset:', ''))
    const color = colorOptions.find((c) => c.id === id)
    if (!color) return
    onChange({
      ...item,
      matchAnyColor: false,
      materialColorPresetId: color.id,
      materialColorPresetName: color.name,
    })
  }

  return (
    <div className="planner-session-material-fields">
      <label className="planner-session-inline-label">
        <span className="muted small">Material</span>
        <select
          value={materialKey}
          disabled={disabled}
          onChange={(e) => setMaterial(e.target.value)}
        >
          <option value="file">{fileMaterialLabel(file)}</option>
          {materials.map((m) => (
            <option key={m.id} value={`preset:${m.id}`}>
              {m.name}
            </option>
          ))}
          <option value="any">Any</option>
        </select>
      </label>
      <label className="planner-session-inline-label">
        <span className="muted small">Color</span>
        <select
          value={colorKey}
          disabled={disabled || item.matchAnyMaterial}
          onChange={(e) => setColor(e.target.value)}
        >
          <option value="file">{fileColorLabel(file)}</option>
          {colorOptions.map((c) => (
            <option key={c.id} value={`preset:${c.id}`}>
              {c.name}
            </option>
          ))}
          <option value="any">Any</option>
        </select>
      </label>
    </div>
  )
}

