export type FarmViewMode = 'simple' | 'advanced'

const STORAGE_KEY = 'jove-farm-view'

export function loadFarmViewMode(): FarmViewMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'advanced' || v === 'simple') return v
  } catch {
    /* ignore */
  }
  return 'simple'
}

export function saveFarmViewMode(mode: FarmViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}
