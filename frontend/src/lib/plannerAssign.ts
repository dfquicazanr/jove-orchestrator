import type { GCodeFile } from '../types/gcode'
import type { Printer } from '../types/printer'
import type { PlannerSessionItem } from '../types/plannerSession'
import type { QueueItem } from '../types/queue'
import { incompatibilityReason } from './plannerCompatibility'

const DEFAULT_PRINT_TIME_SECONDS = 30 * 60

function filamentNeed(file: GCodeFile, wasteFactor: number): number | null {
  const est = file.filament_mass_grams_estimate
  if (est == null) return null
  return est * wasteFactor
}

function jobDurationSeconds(file: GCodeFile, item: PlannerSessionItem): number {
  const fromItem = item.printTimeSeconds
  if (fromItem != null && fromItem > 0) return fromItem
  if (file.print_time_seconds != null && file.print_time_seconds > 0) return file.print_time_seconds
  return DEFAULT_PRINT_TIME_SECONDS
}

type PrinterPlanState = {
  printer: Printer
  queueEndSeconds: number
  remainingFilamentGrams: number
}

function compatibleState(
  state: PrinterPlanState,
  file: GCodeFile,
  item: PlannerSessionItem,
  wasteFactor: number,
): boolean {
  return (
    incompatibilityReason(
      state.printer,
      file,
      item,
      wasteFactor,
      state.remainingFilamentGrams,
    ) == null
  )
}

function sortSessionItems(items: PlannerSessionItem[], filesById: Map<number, GCodeFile>): PlannerSessionItem[] {
  return [...items].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    const fileA = filesById.get(a.gcodeFileId)
    const fileB = filesById.get(b.gcodeFileId)
    const durA = fileA ? jobDurationSeconds(fileA, a) : 0
    const durB = fileB ? jobDurationSeconds(fileB, b) : 0
    if (durB !== durA) return durB - durA
    return a.sessionId.localeCompare(b.sessionId)
  })
}

/** Pre-fill each printer lane with jobs already queued/printing on the farm. */
export function seedPrinterStatesFromQueue(
  states: PrinterPlanState[],
  existingItems: QueueItem[],
  filesById: Map<number, GCodeFile>,
  wasteFactor: number,
): void {
  const byPrinter = new Map<number, QueueItem[]>()
  for (const item of existingItems) {
    if (item.assigned_printer_id == null) continue
    if (item.status !== 'queued' && item.status !== 'printing') continue
    const list = byPrinter.get(item.assigned_printer_id) ?? []
    list.push(item)
    byPrinter.set(item.assigned_printer_id, list)
  }

  for (const state of states) {
    const list = byPrinter.get(state.printer.id)
    if (!list?.length) continue
    const sorted = [...list].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.id - b.id
    })
    for (const q of sorted) {
      const file = filesById.get(q.gcode_file_id) ?? q.gcode_file
      const duration = jobDurationSeconds(file as GCodeFile, {
        sessionId: String(q.id),
        gcodeFileId: q.gcode_file_id,
        printTimeSeconds: file.print_time_seconds,
        priority: q.priority,
        materialPresetId: q.material_preset_id,
        materialPresetName: q.material_preset_name,
        materialColorPresetId: null,
        materialColorPresetName: null,
        matchAnyMaterial: false,
        matchAnyColor: false,
        displayName: file.display_name ?? file.original_filename,
        originalFilename: file.original_filename,
        printKitId: q.print_kit_id,
        kitRunIndex: q.kit_run_index,
        copyLabel: '',
      })
      state.queueEndSeconds += duration
      const need = filamentNeed(file as GCodeFile, wasteFactor)
      if (need != null) {
        state.remainingFilamentGrams = Math.max(0, state.remainingFilamentGrams - need)
      }
    }
  }
}

export type PlannerAssignment = {
  sessionId: string
  assignedPrinterId: number | null
  assignedPrinterName: string | null
}

/**
 * Assign session jobs to printers to minimize total completion time (makespan).
 * Each job goes to the compatible printer that will finish it soonest; filament
 * remaining is tracked as jobs are placed on each spool.
 */
export function assignPlannerSession(
  items: PlannerSessionItem[],
  filesById: Map<number, GCodeFile>,
  printers: Printer[],
  wasteFactor: number,
  existingQueue: QueueItem[] = [],
): PlannerAssignment[] {
  const states: PrinterPlanState[] = printers.map((p) => ({
    printer: p,
    queueEndSeconds: 0,
    remainingFilamentGrams: p.remaining_filament_grams,
  }))

  seedPrinterStatesFromQueue(states, existingQueue, filesById, wasteFactor)

  const assignments = new Map<string, PlannerAssignment>()
  for (const item of items) {
    assignments.set(item.sessionId, {
      sessionId: item.sessionId,
      assignedPrinterId: null,
      assignedPrinterName: null,
    })
  }

  for (const item of sortSessionItems(items, filesById)) {
    const file = filesById.get(item.gcodeFileId)
    if (!file) continue

    const duration = jobDurationSeconds(file, item)
    let best: PrinterPlanState | null = null
    let bestFinish = Infinity

    for (const state of [...states].sort((a, b) => a.printer.id - b.printer.id)) {
      if (!compatibleState(state, file, item, wasteFactor)) continue
      const finish = state.queueEndSeconds + duration
      if (finish < bestFinish) {
        bestFinish = finish
        best = state
      }
    }

    if (best == null) continue

    best.queueEndSeconds = bestFinish
    const need = filamentNeed(file, wasteFactor)
    if (need != null) {
      best.remainingFilamentGrams = Math.max(0, best.remainingFilamentGrams - need)
    }

    assignments.set(item.sessionId, {
      sessionId: item.sessionId,
      assignedPrinterId: best.printer.id,
      assignedPrinterName: best.printer.name,
    })
  }

  return items.map((item) => assignments.get(item.sessionId)!)
}
