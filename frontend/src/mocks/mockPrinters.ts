import type { Printer } from '../types/printer'

const T = '2026-01-01T12:00:00.000Z'

/** Negative IDs are reserved for client-only mock rows (no API writes). */
export function isMockPrinter(p: Pick<Printer, 'id'>): boolean {
  return p.id < 0
}

function row(
  id: number,
  o: Pick<
    Printer,
    | 'name'
    | 'moonraker_base_url'
    | 'loaded_material'
    | 'loaded_color'
    | 'remaining_filament_grams'
    | 'last_known_status'
  > & {
    moonraker_api_key_present?: boolean
    ha_power_entity_id?: string | null
    last_moonraker_check_at?: string | null
    last_moonraker_error?: string | null
    extruder_actual_c?: number | null
    extruder_target_c?: number | null
    bed_actual_c?: number | null
    bed_target_c?: number | null
  },
): Printer {
  const base = {
    id,
    name: o.name,
    moonraker_base_url: o.moonraker_base_url,
    moonraker_api_key_present: o.moonraker_api_key_present ?? false,
    ha_power_entity_id: o.ha_power_entity_id ?? null,
    loaded_material: o.loaded_material,
    loaded_color: o.loaded_color,
    remaining_filament_grams: o.remaining_filament_grams,
    last_known_status: o.last_known_status,
    last_moonraker_check_at: o.last_moonraker_check_at ?? null,
    last_moonraker_error: o.last_moonraker_error ?? null,
    created_at: T,
    updated_at: T,
  }
  type TempKey = 'extruder_actual_c' | 'extruder_target_c' | 'bed_actual_c' | 'bed_target_c'
  const temps: Partial<Pick<Printer, TempKey>> = {}
  for (const key of ['extruder_actual_c', 'extruder_target_c', 'bed_actual_c', 'bed_target_c'] as const) {
    const v = o[key]
    if (typeof v === 'number' && !Number.isNaN(v)) {
      temps[key] = v
    }
  }
  return { ...base, ...temps }
}

/** One card per ``PrinterStatus`` value from the backend, plus an extra ready row for full spiral. */
export const MOCK_PRINTERS: Printer[] = [
  row(-1, {
    name: 'Mock · Ready to print',
    moonraker_base_url: 'http://192.0.2.1:7101',
    loaded_material: 'PLA',
    loaded_color: 'matte white',
    remaining_filament_grams: 1000,
    last_known_status: 'ready',
    extruder_actual_c: 24.5,
    extruder_target_c: 0,
    bed_actual_c: 59.2,
    bed_target_c: 0,
  }),
  row(-2, {
    name: 'Mock · Offline',
    moonraker_base_url: 'http://192.0.2.1:7102',
    loaded_material: 'PETG',
    loaded_color: 'clear',
    remaining_filament_grams: 720,
    last_known_status: 'offline',
  }),
  row(-3, {
    name: 'Mock · Powered off',
    moonraker_base_url: 'http://192.0.2.1:7103',
    loaded_material: 'PLA',
    loaded_color: 'black',
    remaining_filament_grams: 380,
    last_known_status: 'powered_off',
  }),
  row(-4, {
    name: 'Mock · Printing',
    moonraker_base_url: 'http://192.0.2.1:7104',
    loaded_material: 'PLA',
    loaded_color: 'red',
    remaining_filament_grams: 540,
    last_known_status: 'printing',
    extruder_actual_c: 217.8,
    extruder_target_c: 220,
    bed_actual_c: 74.5,
    bed_target_c: 75,
  }),
  row(-5, {
    name: 'Mock · Print finished',
    moonraker_base_url: 'http://192.0.2.1:7105',
    loaded_material: 'PLA',
    loaded_color: 'blue',
    remaining_filament_grams: 45,
    last_known_status: 'finished_awaiting_cleanup',
  }),
  row(-6, {
    name: 'Mock · Error',
    moonraker_base_url: 'http://192.0.2.1:7106',
    loaded_material: 'ABS',
    loaded_color: 'gray',
    remaining_filament_grams: 0,
    last_known_status: 'error',
    last_moonraker_error: 'Example Moonraker error for mock display.',
  }),
  row(-7, {
    name: 'Mock · Full roll (spiral capped)',
    moonraker_base_url: 'http://192.0.2.1:7107',
    loaded_material: 'PLA',
    loaded_color: 'silk gold',
    remaining_filament_grams: 1200,
    last_known_status: 'ready',
    moonraker_api_key_present: true,
  }),
]
