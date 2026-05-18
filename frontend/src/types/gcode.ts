export type GCodeFile = {
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
  material_color_preset_id: number | null
  material_color_preset_name: string | null
  queue_item_count: number
  created_at: string
}
