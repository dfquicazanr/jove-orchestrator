export type GCodeFileBrief = {
  id: number
  original_filename: string
  display_name: string
  filament_mass_grams_estimate: number | null
  filament_length_mm: number | null
  print_time_seconds: number | null
  required_material: string | null
  required_color: string | null
  material_preset_id: number | null
  material_preset_name: string | null
}

export type QueueItem = {
  id: number
  gcode_file_id: number
  copy_index: number
  priority: number
  assigned_printer_id: number | null
  status: string
  print_kit_id: number | null
  kit_run_index: number | null
  material_preset_id: number | null
  material_preset_name: string | null
  created_at: string
  updated_at: string
  gcode_file: GCodeFileBrief
  assigned_printer_name: string | null
}

