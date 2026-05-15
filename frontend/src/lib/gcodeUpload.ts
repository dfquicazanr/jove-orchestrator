import { apiUpload } from '../api/upload'
import type { GCodeUploadResult } from '../types/queue'

export type GcodeUploadMeta = {
  copies: number
  required_material: string | null
  required_color: string | null
}

export async function uploadGcodeFile(file: File, meta: GcodeUploadMeta): Promise<GCodeUploadResult> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  fd.append('metadata_json', JSON.stringify(meta))
  return apiUpload<GCodeUploadResult>('/gcode/upload', fd)
}

export function parseCopies(raw: string): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 10_000) return null
  return n
}
