export type Printer = {
  id: number
  name: string
  moonraker_base_url: string
  moonraker_api_key_present: boolean
  ha_power_entity_id: string | null
  loaded_material: string
  loaded_color: string
  remaining_filament_grams: number
  last_known_status: string
  last_moonraker_check_at: string | null
  last_moonraker_error: string | null
  created_at: string
  updated_at: string
  /** From live Moonraker object state (SSE); omit on API-only payloads. */
  extruder_actual_c?: number | null
  extruder_target_c?: number | null
  bed_actual_c?: number | null
  bed_target_c?: number | null
}
