import type { GCodeFile } from '../types/gcode'
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

export function applyFileMaterialDefaults(
  item: PlannerSessionItem,
  file: GCodeFile,
): PlannerSessionItem {
  const mat = fileDefaultMaterial(file)
  const col = fileDefaultColor(file)
  return {
    ...item,
    matchAnyMaterial: false,
    matchAnyColor: false,
    materialPresetId: mat.id,
    materialPresetName: mat.name,
    materialColorPresetId: col.id,
    materialColorPresetName: col.name,
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
