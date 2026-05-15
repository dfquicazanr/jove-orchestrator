export type GCodeFileBrief = {
  id: number
  original_filename: string
  filament_mass_grams_estimate: number | null
  required_material: string | null
  required_color: string | null
}

export type QueueItem = {
  id: number
  gcode_file_id: number
  copy_index: number
  priority: number
  assigned_printer_id: number | null
  status: string
  created_at: string
  updated_at: string
  gcode_file: GCodeFileBrief
  assigned_printer_name: string | null
}

export type GCodeUploadResult = {
  id: number
  original_filename: string
  filament_mass_grams_estimate: number | null
  required_material: string | null
  required_color: string | null
  total_copies_requested: number
  created_at: string
}
