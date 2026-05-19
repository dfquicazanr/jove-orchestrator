import {
  densityForMaterialPreset,
  reconcileFilament,
  type FilamentReconcileResult,
} from './filamentEstimate'
import { materialsMatch, colorsMatch } from './plannerRequirements'
import { parseGcodeFilePreview, type GcodeMetadataPreview } from './parseGcodeMetadata'
import { printerStatusLabel } from './printerStatusLabels'
import {
  printerAcceptsDropPrint,
  wakePlanForDropPrint,
  type DropPrintWakePlan,
} from './dropPrintWake'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import type { Printer } from '../types/printer'

export type DropPrintWarning = {
  id: string
  message: string
}

export type DropPrintMassSource = 'gcode' | 'estimated' | 'unknown'

export type DropPrintPreview = {
  file: File
  printer: Printer
  wakePlan: DropPrintWakePlan
  metadata: GcodeMetadataPreview
  reconciled: FilamentReconcileResult
  massSource: DropPrintMassSource
  requiredGrams: number | null
  remainingGrams: number
  afterPrintGrams: number | null
  insufficientFilament: boolean
  fileMaterial: string | null
  fileColor: string | null
  warnings: DropPrintWarning[]
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function presetForLoadedMaterial(
  presets: MaterialPreheatPreset[],
  loadedMaterial: string,
): MaterialPreheatPreset | null {
  const n = norm(loadedMaterial)
  if (!n) return null
  return presets.find((p) => norm(p.name) === n) ?? null
}

function massSourceFrom(
  raw: GcodeMetadataPreview,
  reconciled: FilamentReconcileResult,
): DropPrintMassSource {
  if (raw.filament_mass_grams != null) return 'gcode'
  if (reconciled.massFromDensity && reconciled.massGrams != null) return 'estimated'
  return 'unknown'
}

export { printerAcceptsDropPrint, printerReadyForDropPrint } from './dropPrintWake'

export function rejectReasonBeforeDropPrint(printer: Printer): string | null {
  if (!printerAcceptsDropPrint(printer)) {
    if (
      (printer.last_known_status === 'powered_off' ||
        printer.last_known_status === 'offline') &&
      !printer.ha_power_entity_id?.trim()
    ) {
      return `${printer.name} is ${printerStatusLabel(printer.last_known_status)} and has no Home Assistant power control — link power under Edit → Connection.`
    }
    if (!printer.moonraker_base_url?.trim()) {
      return `${printer.name} has no Moonraker URL configured.`
    }
    return `${printer.name} is ${printerStatusLabel(printer.last_known_status)} — drop print needs Ready, or Powered off with HA power configured.`
  }
  if (!printer.loaded_material.trim()) {
    return `Set loaded material on ${printer.name} (Edit → Filament) before printing.`
  }
  return null
}

export async function prepareDropPrint(
  printer: Printer,
  file: File,
  materialPresets: MaterialPreheatPreset[],
): Promise<DropPrintPreview> {
  const metadata = await parseGcodeFilePreview(file)
  const preset = presetForLoadedMaterial(materialPresets, printer.loaded_material)
  const density = preset
    ? densityForMaterialPreset(materialPresets, String(preset.id)) ??
      (preset.default_density_g_cm3 != null && preset.default_density_g_cm3 > 0
        ? preset.default_density_g_cm3
        : null)
    : null

  const reconciled = reconcileFilament(
    metadata.filament_mass_grams,
    metadata.filament_length_mm,
    density,
  )

  const massSource = massSourceFrom(metadata, reconciled)
  const requiredGrams = reconciled.massGrams
  const remainingGrams = printer.remaining_filament_grams
  const afterPrintGrams =
    requiredGrams != null ? Math.max(0, remainingGrams - requiredGrams) : null
  const insufficientFilament =
    requiredGrams != null && remainingGrams < requiredGrams

  const fileMaterial = metadata.material_comment
  const fileColor = metadata.color_comment

  const wakePlan = wakePlanForDropPrint(printer)
  const warnings: DropPrintWarning[] = []

  if (wakePlan === 'power_on') {
    warnings.push({
      id: 'wake-printer',
      message:
        'Printer is off. Confirming will turn on mains power (Home Assistant), wait until Moonraker is up and the printer is Ready, then start this print.',
    })
  }

  if (massSource === 'unknown') {
    warnings.push({
      id: 'unknown-mass',
      message:
        'Could not determine filament usage from this file. Set material density under Materials if the file only has length.',
    })
  } else if (massSource === 'estimated') {
    warnings.push({
      id: 'estimated-mass',
      message: `Weight estimated from filament length and ${preset?.name ?? 'material'} density (${density} g/cm³).`,
    })
  }

  if (insufficientFilament && requiredGrams != null) {
    warnings.push({
      id: 'low-filament',
      message: `Spool may be short: need ~${Math.ceil(requiredGrams)} g, ${Math.floor(remainingGrams)} g tracked on this printer.`,
    })
  }

  if (fileMaterial && !materialsMatch(printer.loaded_material, fileMaterial)) {
    warnings.push({
      id: 'material-mismatch',
      message: `File material “${fileMaterial}” does not match loaded “${printer.loaded_material.trim()}”.`,
    })
  }

  if (fileColor && !colorsMatch(printer.loaded_color, fileColor)) {
    const loaded = printer.loaded_color.trim() || '(not set)'
    warnings.push({
      id: 'color-mismatch',
      message: `File color “${fileColor}” does not match loaded “${loaded}”.`,
    })
  }

  if (!printer.moonraker_base_url?.trim()) {
    warnings.push({
      id: 'no-moonraker',
      message: 'Moonraker URL is not configured for this printer.',
    })
  }

  return {
    file,
    printer,
    wakePlan,
    metadata,
    reconciled,
    massSource,
    requiredGrams,
    remainingGrams,
    afterPrintGrams,
    insufficientFilament,
    fileMaterial,
    fileColor,
    warnings,
  }
}
