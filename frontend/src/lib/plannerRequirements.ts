import type { GCodeFile } from '../types/gcode'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import type { PlannerSessionItem } from '../types/plannerSession'

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Material required for planner matching, or null if any material is accepted. */
export function requiredMaterial(file: GCodeFile, item: PlannerSessionItem): string | null {
  if (item.matchAnyMaterial) return null
  if (item.materialPresetName?.trim()) return item.materialPresetName.trim()
  return file.material_preset_name?.trim() || file.required_material?.trim() || null
}

/** Color required for planner matching, or null if any color is accepted. */
export function requiredColor(file: GCodeFile, item: PlannerSessionItem): string | null {
  if (item.matchAnyColor) return null
  if (item.materialColorPresetName?.trim()) return item.materialColorPresetName.trim()
  if (item.printKitId != null && item.materialPresetId != null && item.materialColorPresetId == null) {
    return null
  }
  return file.material_color_preset_name?.trim() || file.required_color?.trim() || null
}

export function materialLabel(file: GCodeFile, item: PlannerSessionItem): string {
  if (item.matchAnyMaterial) return 'Any'
  const req = requiredMaterial(file, item)
  if (req) return req
  return 'Any'
}

export function colorLabel(file: GCodeFile, item: PlannerSessionItem): string {
  if (item.matchAnyColor) return 'Any'
  const req = requiredColor(file, item)
  if (req) return req
  return '—'
}

export function fileDefaultMaterial(file: GCodeFile): { id: number | null; name: string | null } {
  return {
    id: file.material_preset_id,
    name: file.material_preset_name?.trim() || file.required_material?.trim() || null,
  }
}

export function fileDefaultColor(file: GCodeFile): { id: number | null; name: string | null } {
  return {
    id: file.material_color_preset_id,
    name: file.material_color_preset_name?.trim() || file.required_color?.trim() || null,
  }
}

/** Default color for a material preset (is_default, else first in list). */
export function defaultColorForMaterialPreset(
  materials: MaterialPreheatPreset[],
  materialPresetId: number | null,
): { id: number | null; name: string | null } {
  if (materialPresetId == null) return { id: null, name: null }
  const preset = materials.find((m) => m.id === materialPresetId)
  const colors = preset?.color_presets ?? []
  if (colors.length === 0) return { id: null, name: null }
  const pick = colors.find((c) => c.is_default) ?? colors[0]
  return { id: pick.id, name: pick.name }
}

/** When no color preset is set on the row, accept any loaded filament color. */
export function resolveSessionItemColor(item: PlannerSessionItem): PlannerSessionItem {
  if (item.matchAnyColor || item.materialColorPresetId != null) return item
  return {
    ...item,
    matchAnyColor: true,
    materialColorPresetId: null,
    materialColorPresetName: null,
  }
}

export function applyFileMaterialDefaults(
  item: PlannerSessionItem,
  file: GCodeFile,
): PlannerSessionItem {
  const mat = fileDefaultMaterial(file)
  const col = fileDefaultColor(file)
  const hasFileColor = col.id != null
  return {
    ...item,
    matchAnyMaterial: false,
    matchAnyColor: !hasFileColor,
    materialPresetId: mat.id,
    materialPresetName: mat.name,
    materialColorPresetId: hasFileColor ? col.id : null,
    materialColorPresetName: hasFileColor ? col.name : null,
  }
}

export function normalizePlannerSessionItem(
  item: Partial<PlannerSessionItem> & Pick<PlannerSessionItem, 'sessionId' | 'gcodeFileId' | 'displayName' | 'originalFilename'>,
): PlannerSessionItem {
  return {
    sessionId: item.sessionId,
    gcodeFileId: item.gcodeFileId,
    originalFilename: item.originalFilename,
    displayName: item.displayName,
    printTimeSeconds: item.printTimeSeconds ?? null,
    priority: item.priority ?? 0,
    materialPresetId: item.materialPresetId ?? null,
    materialPresetName: item.materialPresetName ?? null,
    materialColorPresetId: item.materialColorPresetId ?? null,
    materialColorPresetName: item.materialColorPresetName ?? null,
    matchAnyMaterial: item.matchAnyMaterial ?? false,
    matchAnyColor: item.matchAnyColor ?? false,
    printKitId: item.printKitId ?? null,
    kitRunIndex: item.kitRunIndex ?? null,
    copyLabel: item.copyLabel ?? '',
  }
}

export function materialsMatch(printerMaterial: string, required: string | null): boolean {
  if (!required) return true
  return norm(printerMaterial) === norm(required)
}

export function colorsMatch(printerColor: string, required: string | null): boolean {
  if (!required) return true
  return norm(printerColor) === norm(required)
}
