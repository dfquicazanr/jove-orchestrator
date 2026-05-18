export type PrintKitItem = {
  id: number
  gcode_file_id: number
  gcode_filename: string
  gcode_display_name: string
  material_preset_id: number
  material_preset_name: string
  material_color_preset_id: number | null
  material_color_preset_name: string | null
  quantity: number
  sort_order: number
}

export type PrintKit = {
  id: number
  name: string
  description: string | null
  created_at: string
  updated_at: string
  items: PrintKitItem[]
}

export type PrintKitItemDraft = {
  gcode_file_id: number
  material_preset_id: number
  material_color_preset_id: number | null
  quantity: number
}
