import type { GCodeFile } from '../types/gcode'
import type { Printer } from '../types/printer'
import type { PlannerSessionItem } from '../types/plannerSession'
import {
  colorsMatch,
  materialsMatch,
  requiredColor,
  requiredMaterial,
} from './plannerRequirements'
import { printerStatusLabel } from './printerStatusLabels'

function printerReady(p: Printer): boolean {
  return p.last_known_status === 'ready' || p.last_known_status === 'finished_awaiting_cleanup'
}

function filamentNeed(file: GCodeFile, wasteFactor: number): number | null {
  const est = file.filament_mass_grams_estimate
  if (est == null) return null
  return est * wasteFactor
}

/** Human-readable reason this printer cannot take the job, or null if it can. */
export function incompatibilityReason(
  printer: Printer,
  file: GCodeFile,
  item: PlannerSessionItem,
  wasteFactor: number,
  remainingFilamentGrams: number = printer.remaining_filament_grams,
): string | null {
  if (!printerReady(printer)) {
    return `Status: ${printerStatusLabel(printer.last_known_status)} (needs ready or print finished)`
  }

  const loadedMaterial = printer.loaded_material.trim()
  if (!loadedMaterial) {
    return 'No material set on printer (update on Farm)'
  }

  const reqM = requiredMaterial(file, item)
  if (!materialsMatch(loadedMaterial, reqM)) {
    return `Material: job needs “${reqM}”, loaded “${loadedMaterial}”`
  }

  const reqC = requiredColor(file, item)
  if (!colorsMatch(printer.loaded_color, reqC)) {
    const loaded = printer.loaded_color.trim() || '(not set)'
    return `Color: job needs “${reqC}”, loaded “${loaded}”`
  }

  const need = filamentNeed(file, wasteFactor)
  if (need != null && remainingFilamentGrams < need) {
    return `Filament: need ~${Math.ceil(need)} g, ${Math.floor(remainingFilamentGrams)} g left on spool`
  }
  return null
}

export function printersWithoutLoadedMaterial(printers: Printer[]): Printer[] {
  return printers.filter((p) => !p.loaded_material.trim())
}
