import type { GCodeFile } from '../types/gcode'

export function defaultGcodeDisplayName(filename: string): string {
  const name = filename.trim() || 'job'
  const lower = name.toLowerCase()
  for (const ext of ['.gcode.gz', '.gcode.3mf', '.gcode', '.nc']) {
    if (lower.endsWith(ext)) return name.slice(0, -ext.length)
  }
  const dot = name.lastIndexOf('.')
  if (dot > 0) return name.slice(0, dot)
  return name
}

export function gcodeFileLabel(file: Pick<GCodeFile, 'display_name' | 'original_filename'>): string {
  return file.display_name?.trim() || file.original_filename
}

export function gcodeMaterialColorLabel(
  file: Pick<GCodeFile, 'material_preset_name' | 'required_material' | 'material_color_preset_name' | 'required_color'>,
): string {
  const mat = file.material_preset_name?.trim() || file.required_material?.trim()
  const color = file.material_color_preset_name?.trim() || file.required_color?.trim()
  const parts = [mat, color].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}
