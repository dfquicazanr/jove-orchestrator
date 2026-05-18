import { apiUpload } from '../api/upload'
import type { GCodeFile } from '../types/gcode'

export type GcodeUploadMeta = {
  display_name?: string | null
  copies: number
  required_material: string | null
  required_color: string | null
  material_preset_id: number | null
  material_color_preset_id?: number | null
  enqueue: boolean
}

export async function uploadGcodeFile(file: File, meta: GcodeUploadMeta): Promise<GCodeFile> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('metadata_json', JSON.stringify(meta))
  return apiUpload<GCodeFile>('/gcode/upload', fd)
}

export function parseCopies(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 10_000) return null
  return n
}
