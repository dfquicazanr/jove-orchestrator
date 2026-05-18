import { normalizePlannerSessionItem } from './plannerRequirements'
import type { PlannerSessionItem } from '../types/plannerSession'

const STORAGE_KEY = 'jove.planner.pendingImport'

export function peekPlannerImport(): PlannerSessionItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<PlannerSessionItem>[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((row) =>
      normalizePlannerSessionItem({
        sessionId: row.sessionId ?? crypto.randomUUID(),
        gcodeFileId: row.gcodeFileId ?? 0,
        displayName: row.displayName ?? '',
        originalFilename: row.originalFilename ?? '',
        ...row,
      }),
    )
  } catch {
    return []
  }
}

export function appendPlannerImport(items: PlannerSessionItem[]): void {
  if (items.length === 0) return
  const merged = [...peekPlannerImport(), ...items]
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
}

export function consumePlannerImport(): PlannerSessionItem[] {
  const items = peekPlannerImport()
  sessionStorage.removeItem(STORAGE_KEY)
  return items
}
