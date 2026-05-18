/** Client-side filament reconciliation (mirrors backend filament_estimate). */

export const DEFAULT_FILAMENT_DIAMETER_MM = 1.75

export type FilamentReconcileResult = {
  massGrams: number | null
  lengthMm: number | null
  massFromDensity: boolean
  lengthFromDensity: boolean
}

export type GcodeFilamentPreview = {
  filament_mass_grams: number | null
  filament_length_mm: number | null
}

function crossSectionMm2(diameterMm: number): number {
  return Math.PI * (diameterMm / 2) ** 2
}

export function massGFromLengthMm(
  lengthMm: number,
  densityGcm3: number,
  diameterMm: number = DEFAULT_FILAMENT_DIAMETER_MM,
): number {
  const volumeMm3 = crossSectionMm2(diameterMm) * lengthMm
  return (volumeMm3 / 1000) * densityGcm3
}

export function lengthMmFromMassG(
  massG: number,
  densityGcm3: number,
  diameterMm: number = DEFAULT_FILAMENT_DIAMETER_MM,
): number {
  const volumeMm3 = (massG / densityGcm3) * 1000
  return volumeMm3 / crossSectionMm2(diameterMm)
}

export function reconcileFilament(
  massGrams: number | null | undefined,
  lengthMm: number | null | undefined,
  densityGcm3: number | null | undefined,
  diameterMm: number = DEFAULT_FILAMENT_DIAMETER_MM,
): FilamentReconcileResult {
  let outMass = massGrams ?? null
  let outLength = lengthMm ?? null
  let massFromDensity = false
  let lengthFromDensity = false

  if (densityGcm3 != null && densityGcm3 > 0) {
    if (outMass == null && outLength != null && outLength > 0) {
      outMass = massGFromLengthMm(outLength, densityGcm3, diameterMm)
      massFromDensity = true
    }
    if (outLength == null && outMass != null && outMass > 0) {
      outLength = lengthMmFromMassG(outMass, densityGcm3, diameterMm)
      lengthFromDensity = true
    }
  }

  return { massGrams: outMass, lengthMm: outLength, massFromDensity, lengthFromDensity }
}

export type FilamentMetadataWarning = {
  id: string
  message: string
  detail?: string
}

/** Warnings for slicer metadata missing from the file (before/after density fill). */
export function filamentMetadataWarnings(
  raw: GcodeFilamentPreview | null,
  reconciled: FilamentReconcileResult,
): FilamentMetadataWarning[] {
  if (!raw) return []
  const warnings: FilamentMetadataWarning[] = []
  if (raw.filament_mass_grams == null && reconciled.massGrams == null) {
    warnings.push({
      id: 'missing-mass',
      message: 'Weight missing',
      detail: 'Not found in G-code — set a default density on the material to estimate',
    })
  } else if (raw.filament_mass_grams == null && reconciled.massFromDensity) {
    warnings.push({
      id: 'mass-from-density',
      message: 'Est. from density',
      detail: 'Weight estimated from length and material density',
    })
  }
  if (raw.filament_length_mm == null && reconciled.lengthMm == null) {
    warnings.push({
      id: 'missing-length',
      message: 'Length missing',
      detail: 'Not found in G-code — set a default density on the material to estimate',
    })
  } else if (raw.filament_length_mm == null && reconciled.lengthFromDensity) {
    warnings.push({
      id: 'length-from-density',
      message: 'Est. from density',
      detail: 'Length estimated from weight and material density',
    })
  }
  return warnings
}

export function densityForMaterialPreset(
  materialPresets: { id: number; default_density_g_cm3?: number | null }[],
  materialPresetId: string,
): number | null {
  if (!materialPresetId) return null
  const id = Number(materialPresetId)
  const preset = materialPresets.find((p) => p.id === id)
  const d = preset?.default_density_g_cm3
  return d != null && d > 0 ? d : null
}
