export type MaterialPreheatPreset = {
  id: number
  name: string
  hotend_c: number
  bed_c: number
  sort_order: number
}

export const MOCK_PREHEAT_PRESETS: MaterialPreheatPreset[] = [
  { id: 1, name: 'PLA', hotend_c: 210, bed_c: 60, sort_order: 0 },
  { id: 2, name: 'PETG', hotend_c: 240, bed_c: 80, sort_order: 1 },
  { id: 3, name: 'ABS', hotend_c: 250, bed_c: 100, sort_order: 2 },
  { id: 4, name: 'TPU', hotend_c: 220, bed_c: 50, sort_order: 3 },
]
