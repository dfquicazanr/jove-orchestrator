import {
  densityForMaterialPreset,
  reconcileFilament,
} from './filamentEstimate'
import { colorLabel, materialLabel } from './plannerRequirements'
import type { GCodeFile } from '../types/gcode'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import type { PlannerSessionItem } from '../types/plannerSession'

export type PlannerSessionMaterialRow = {
  material: string
  count: number
  colors: { label: string; count: number }[]
}

export type PlannerSessionSummary = {
  jobCount: number
  totalPrintSeconds: number
  jobsMissingDuration: number
  totalMassGrams: number | null
  totalLengthMm: number | null
  jobsMissingFilament: number
  materials: PlannerSessionMaterialRow[]
}

function itemPrintSeconds(item: PlannerSessionItem, file: GCodeFile | undefined): number | null {
  if (item.printTimeSeconds != null && item.printTimeSeconds > 0) return item.printTimeSeconds
  if (file?.print_time_seconds != null && file.print_time_seconds > 0) return file.print_time_seconds
  return null
}

export function computePlannerSessionSummary(
  session: PlannerSessionItem[],
  filesById: Map<number, GCodeFile>,
  materials: MaterialPreheatPreset[],
): PlannerSessionSummary {
  let totalPrintSeconds = 0
  let jobsMissingDuration = 0
  let totalMassGrams = 0
  let totalLengthMm = 0
  let massKnown = 0
  let lengthKnown = 0
  let jobsMissingFilament = 0

  const materialMap = new Map<string, Map<string, number>>()

  for (const item of session) {
    const file = filesById.get(item.gcodeFileId)
    const sec = itemPrintSeconds(item, file)
    if (sec != null) totalPrintSeconds += sec
    else jobsMissingDuration += 1

    const mat = materialLabel(file ?? ({} as GCodeFile), item)
    const col = colorLabel(file ?? ({} as GCodeFile), item)
    let colors = materialMap.get(mat)
    if (!colors) {
      colors = new Map()
      materialMap.set(mat, colors)
    }
    colors.set(col, (colors.get(col) ?? 0) + 1)

    if (!file) {
      jobsMissingFilament += 1
      continue
    }

    const density = densityForMaterialPreset(
      materials,
      item.materialPresetId != null ? String(item.materialPresetId) : '',
    )
    const reconciled = reconcileFilament(
      file.filament_mass_grams_estimate,
      file.filament_length_mm,
      density,
    )
    if (reconciled.massGrams != null) {
      totalMassGrams += reconciled.massGrams
      massKnown += 1
    }
    if (reconciled.lengthMm != null) {
      totalLengthMm += reconciled.lengthMm
      lengthKnown += 1
    }
    if (reconciled.massGrams == null && reconciled.lengthMm == null) {
      jobsMissingFilament += 1
    }
  }

  const materialsList: PlannerSessionMaterialRow[] = [...materialMap.entries()]
    .map(([material, colors]) => ({
      material,
      count: [...colors.values()].reduce((a, b) => a + b, 0),
      colors: [...colors.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => b.count - a.count || a.material.localeCompare(b.material))

  return {
    jobCount: session.length,
    totalPrintSeconds,
    jobsMissingDuration,
    totalMassGrams: massKnown > 0 ? totalMassGrams : null,
    totalLengthMm: lengthKnown > 0 ? totalLengthMm : null,
    jobsMissingFilament,
    materials: materialsList,
  }
}
