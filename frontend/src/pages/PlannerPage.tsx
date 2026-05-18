import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { InfoTooltip } from '../components/InfoTooltip'
import { MissingPrintTimeModal } from '../components/MissingPrintTimeModal'
import { PrintTimeline } from '../components/PrintTimeline'
import { FilamentSafetyMarginHelp } from '../lib/filamentSafetyMarginHelp'
import { parseSafetyMarginPercent, percentToWasteFactor } from '../lib/filamentSafetyMargin'
import { formatPrintTime } from '../lib/formatGcodeMeta'
import { assignPlannerSession } from '../lib/plannerAssign'
import { FarmMaterialWarning } from '../components/FarmMaterialWarning'
import { incompatibilityReason } from '../lib/plannerCompatibility'
import {
  applyFileMaterialDefaults,
  normalizePlannerSessionItem,
  resolveSessionItemColor,
} from '../lib/plannerRequirements'
import { consumePlannerImport } from '../lib/plannerSessionStorage'
import { PlannerSessionMaterialFields } from '../components/PlannerSessionMaterialFields'
import { PlannerSessionSummary } from '../components/PlannerSessionSummary'
import { computePlannerSessionSummary } from '../lib/plannerSessionSummary'
import { buildPrinterSchedule, type ScheduleJobInput } from '../lib/printerSchedule'
import { useUnsavedPlannerWarning } from '../hooks/useUnsavedPlannerWarning'
import { FARM_SUCCESS_TOAST_MS, useAutoDismiss } from '../hooks/useAutoDismiss'
import type { GCodeFile } from '../types/gcode'
import type { PlannerSessionItem } from '../types/plannerSession'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { MOCK_PREHEAT_PRESETS } from '../types/materialPreheat'
import type { PrintKit } from '../types/printKit'
import type { Printer } from '../types/printer'
import type { QueueItem } from '../types/queue'

function newSessionId(): string {
  return crypto.randomUUID()
}

function fileToSessionItem(file: GCodeFile, copyIndex: number): PlannerSessionItem {
  return applyFileMaterialDefaults(
    normalizePlannerSessionItem({
      sessionId: newSessionId(),
      gcodeFileId: file.id,
      originalFilename: file.original_filename,
      displayName: file.display_name,
      printTimeSeconds: file.print_time_seconds,
      priority: 0,
      printKitId: null,
      kitRunIndex: null,
      copyLabel: String(copyIndex + 1),
    }),
    file,
  )
}

function sessionToScheduleInput(
  item: PlannerSessionItem,
  assignedPrinterId: number | null,
  status: 'draft' | 'queued',
): ScheduleJobInput {
  return {
    id: item.sessionId,
    assignedPrinterId,
    status,
    priority: item.priority,
    printTimeSeconds: item.printTimeSeconds,
    label: item.displayName,
    gcodeFileId: item.gcodeFileId,
  }
}

export function PlannerPage() {
  const [session, setSession] = useState<PlannerSessionItem[]>([])
  const [files, setFiles] = useState<GCodeFile[]>([])
  const [kits, setKits] = useState<PrintKit[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [materials, setMaterials] = useState<MaterialPreheatPreset[]>([])
  const [assignments, setAssignments] = useState<Map<string, number | null>>(new Map())
  const [previewReady, setPreviewReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [safetyMarginPercent, setSafetyMarginPercent] = useState('0')
  const [optimizing, setOptimizing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [missingTimeOpen, setMissingTimeOpen] = useState(false)
  const [pendingMissingFiles, setPendingMissingFiles] = useState<GCodeFile[]>([])
  const [addFileId, setAddFileId] = useState('')
  const [addCopies, setAddCopies] = useState('1')
  const [addKitId, setAddKitId] = useState('')
  const [addKitCopies, setAddKitCopies] = useState('1')

  const dismissNotice = useCallback(() => setNotice(null), [])
  useAutoDismiss(notice, dismissNotice, FARM_SUCCESS_TOAST_MS)
  useUnsavedPlannerWarning(session.length > 0)

  const filesById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])

  const sessionSummary = useMemo(
    () => computePlannerSessionSummary(session, filesById, materials),
    [session, filesById, materials],
  )

  const loadMeta = useCallback(async () => {
    try {
      const [fileData, kitData, printerData, matData] = await Promise.all([
        apiFetch<GCodeFile[]>('/gcode/files'),
        apiFetch<PrintKit[]>('/kits'),
        apiFetch<Printer[]>('/printers'),
        apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat').catch(() => MOCK_PREHEAT_PRESETS),
      ])
      setFiles(fileData)
      setKits(kitData)
      setPrinters(printerData)
      setMaterials(matData)
      if (!addFileId && fileData[0]) setAddFileId(String(fileData[0].id))
      const imported = consumePlannerImport()
      if (imported.length > 0) {
        setSession((s) => [
          ...s,
          ...imported.map((i) => resolveSessionItemColor(i)),
        ])
        setNotice(`Added ${imported.length} job${imported.length === 1 ? '' : 's'} from kit.`)
      }
    } catch {
      setFiles([])
      setKits([])
      setPrinters([])
    }
  }, [addFileId])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  function addFileToSession() {
    const id = Number(addFileId)
    const file = filesById.get(id)
    const copies = Number(addCopies)
    if (!file || !Number.isInteger(copies) || copies < 1) {
      setError('Choose a file and a valid copy count.')
      return
    }
    setError(null)
    setPreviewReady(false)
    const added: PlannerSessionItem[] = []
    for (let i = 0; i < copies; i++) {
      added.push(fileToSessionItem(file, i))
    }
    setSession((s) => [...s, ...added])
  }

  function addKitToSession() {
    const kitId = Number(addKitId)
    const kit = kits.find((k) => k.id === kitId)
    const runs = Number(addKitCopies)
    if (!kit || !Number.isInteger(runs) || runs < 1) {
      setError('Choose a kit and valid run count.')
      return
    }
    setError(null)
    setPreviewReady(false)
    const added: PlannerSessionItem[] = []
    for (let run = 0; run < runs; run++) {
      for (const line of kit.items) {
        const file = filesById.get(line.gcode_file_id)
        for (let q = 0; q < line.quantity; q++) {
          added.push(
            resolveSessionItemColor(
              normalizePlannerSessionItem({
                sessionId: newSessionId(),
                gcodeFileId: line.gcode_file_id,
                originalFilename: line.gcode_filename,
                displayName: line.gcode_display_name || line.gcode_filename,
                printTimeSeconds: file?.print_time_seconds ?? null,
                priority: 0,
                materialPresetId: line.material_preset_id,
                materialPresetName: line.material_preset_name,
                materialColorPresetId: line.material_color_preset_id,
                materialColorPresetName: line.material_color_preset_name,
                matchAnyMaterial: false,
                matchAnyColor: false,
                printKitId: kit.id,
                kitRunIndex: run,
                copyLabel: `${run + 1}.${q + 1}`,
              }),
            ),
          )
        }
      }
    }
    setSession((s) => [...s, ...added])
  }

  function removeSessionItem(sessionId: string) {
    setPreviewReady(false)
    setSession((s) => s.filter((i) => i.sessionId !== sessionId))
  }

  function duplicateSessionItem(sessionId: string) {
    setPreviewReady(false)
    setSession((s) => {
      const idx = s.findIndex((i) => i.sessionId === sessionId)
      if (idx < 0) return s
      const source = s[idx]
      const duplicate: PlannerSessionItem = {
        ...source,
        sessionId: newSessionId(),
      }
      const next = [...s]
      next.splice(idx + 1, 0, duplicate)
      return next
    })
  }

  function clearSession() {
    if (session.length === 0) return
    if (!window.confirm('Clear this planner session?')) return
    setSession([])
    setAssignments(new Map())
    setPreviewReady(false)
  }

  function filesMissingDuration(forSession: PlannerSessionItem[] = session): GCodeFile[] {
    const seen = new Set<number>()
    const missing: GCodeFile[] = []
    for (const item of forSession) {
      if (item.printTimeSeconds != null && item.printTimeSeconds > 0) continue
      const file = filesById.get(item.gcodeFileId)
      if (!file || seen.has(file.id)) continue
      if (file.print_time_seconds != null && file.print_time_seconds > 0) continue
      seen.add(file.id)
      missing.push(file)
    }
    return missing
  }

  async function runOptimize(sessionOverride?: PlannerSessionItem[]) {
    const workingSession = sessionOverride ?? session
    const pct = parseSafetyMarginPercent(safetyMarginPercent)
    if (pct === null) {
      setError('Safety margin must be a whole number from 0% to 100%.')
      return
    }
    if (workingSession.length === 0) {
      setError('Add at least one print to the session.')
      return
    }
    const missing = filesMissingDuration(workingSession)
    if (missing.length > 0) {
      setPendingMissingFiles(missing)
      setMissingTimeOpen(true)
      return
    }
    setError(null)
    setOptimizing(true)
    try {
      const wf = percentToWasteFactor(pct)
      let existingQueue: QueueItem[] = []
      try {
        existingQueue = await apiFetch<QueueItem[]>('/queue/timeline')
      } catch {
        existingQueue = []
      }
      const result = assignPlannerSession(workingSession, filesById, printers, wf, existingQueue)
      const map = new Map<string, number | null>()
      for (const row of result) map.set(row.sessionId, row.assignedPrinterId)
      setAssignments(map)
      setPreviewReady(true)
      const assigned = result.filter((r) => r.assignedPrinterId != null).length
      const unassigned = result.length - assigned
      setNotice(
        unassigned === 0
          ? `Optimized ${assigned} job${assigned === 1 ? '' : 's'} across printers.`
          : `Assigned ${assigned}; ${unassigned} could not be placed (material, filament, or printer state).`,
      )
    } finally {
      setOptimizing(false)
    }
  }

  function onMissingTimesSaved(updated: GCodeFile[]) {
    const byId = new Map(updated.map((f) => [f.id, f]))
    setFiles((prev) => prev.map((f) => byId.get(f.id) ?? f))
    const nextSession = session.map((item) => {
      const f = byId.get(item.gcodeFileId)
      if (!f) return item
      return { ...item, printTimeSeconds: f.print_time_seconds }
    })
    setSession(nextSession)
    setMissingTimeOpen(false)
    void runOptimize(nextSession)
  }

  async function commitPlan() {
    if (!previewReady || session.length === 0) return
    const assigned = session.filter((i) => assignments.get(i.sessionId) != null)
    if (assigned.length === 0) {
      setError('No jobs were assigned to printers. Adjust filament or materials, then optimize again.')
      return
    }
    setCommitting(true)
    setError(null)
    try {
      await apiFetch('/queue/plan/commit', {
        method: 'POST',
        json: {
          items: assigned.map((item) => ({
            gcode_file_id: item.gcodeFileId,
            assigned_printer_id: assignments.get(item.sessionId),
            priority: item.priority,
            material_preset_id: item.materialPresetId,
            print_kit_id: item.printKitId,
            kit_run_index: item.kitRunIndex,
          })),
        },
      })
      setSession([])
      setAssignments(new Map())
      setPreviewReady(false)
      setNotice(`Scheduled ${assigned.length} job${assigned.length === 1 ? '' : 's'} on the farm. See the dashboard.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not schedule jobs')
    } finally {
      setCommitting(false)
    }
  }

  const scheduleInputs = useMemo((): ScheduleJobInput[] => {
    if (!previewReady) return []
    return session.map((item) => {
      const printerId = assignments.get(item.sessionId) ?? null
      const status = printerId != null ? 'queued' : 'draft'
      return sessionToScheduleInput(item, printerId, status)
    })
  }, [session, assignments, previewReady])

  const { lanes, clips } = useMemo(
    () => buildPrinterSchedule(scheduleInputs, printers),
    [scheduleInputs, printers],
  )

  const assignedCount = useMemo(
    () => [...assignments.values()].filter((id) => id != null).length,
    [assignments],
  )

  function updateSessionItem(sessionId: string, patch: PlannerSessionItem) {
    setPreviewReady(false)
    setSession((rows) => rows.map((r) => (r.sessionId === sessionId ? patch : r)))
  }

  const assignmentSummary = useMemo(() => {
    if (!previewReady || session.length === 0) return null
    const sample = session[0]
    const file = filesById.get(sample.gcodeFileId)
    if (!file) return null
    const pct = parseSafetyMarginPercent(safetyMarginPercent)
    const wf = pct == null ? 1 : percentToWasteFactor(pct)
    const counts = new Map<number, number>()
    for (const pid of assignments.values()) {
      if (pid != null) counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }
    return printers.map((p) => ({
      id: p.id,
      name: p.name,
      jobCount: counts.get(p.id) ?? 0,
      blockedReason: incompatibilityReason(p, file, sample, wf),
    }))
  }, [previewReady, session, filesById, safetyMarginPercent, assignments, printers])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Planner</h1>
          <p className="muted">
            Build a print session, optimize printer assignments, then schedule jobs on the farm. Leaving this
            page discards an unsaved session.
          </p>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? (
        <p className="success subtle farm-action-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="card planner-add-panel">
        <h2>Add to session</h2>
        <div className="planner-add-row">
          <label>
            Library file
            <select value={addFileId} onChange={(e) => setAddFileId(e.target.value)}>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.display_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Copies
            <input type="number" min={1} value={addCopies} onChange={(e) => setAddCopies(e.target.value)} />
          </label>
          <button type="button" className="btn" onClick={addFileToSession}>
            Add file
          </button>
        </div>
        <div className="planner-add-row">
          <label>
            Print kit
            <select value={addKitId} onChange={(e) => setAddKitId(e.target.value)}>
              <option value="">—</option>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kit runs
            <input type="number" min={1} value={addKitCopies} onChange={(e) => setAddKitCopies(e.target.value)} />
          </label>
          <button type="button" className="btn" disabled={!addKitId} onClick={addKitToSession}>
            Add kit
          </button>
        </div>
        <p className="muted small">
          Or pick files in the <Link to="/library">library</Link> / <Link to="/kits">kits</Link> pages and send
          them here.
        </p>
      </section>

      <section className="card">
        <div className="queue-list-head">
          <h2>Session ({session.length})</h2>
          {session.length > 0 ? (
            <button type="button" className="btn subtle" onClick={clearSession}>
              Clear session
            </button>
          ) : null}
        </div>
        {printers.length > 0 ? <FarmMaterialWarning printers={printers} /> : null}
        {session.length === 0 ? (
          <p className="muted">No jobs in this session yet.</p>
        ) : (
          <>
          <PlannerSessionSummary summary={sessionSummary} />
          <table className="table queue-table planner-session-table">
            <thead>
              <tr>
                <th>Print</th>
                <th>Material</th>
                <th>Color</th>
                <th>Duration</th>
                <th>Assigned</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {session.map((item) => {
                const file = filesById.get(item.gcodeFileId)
                const pid = previewReady ? assignments.get(item.sessionId) : null
                const printer = pid != null ? printers.find((p) => p.id === pid) : null
                return (
                  <tr key={item.sessionId}>
                    <td title={item.originalFilename}>{item.displayName}</td>
                    <td className="planner-session-col-material">
                      {file ? (
                        <PlannerSessionMaterialFields
                          part="material"
                          item={item}
                          file={file}
                          materials={materials}
                          disabled={optimizing || committing}
                          onChange={(next) => updateSessionItem(item.sessionId, next)}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="planner-session-col-color">
                      {file ? (
                        <PlannerSessionMaterialFields
                          part="color"
                          item={item}
                          file={file}
                          materials={materials}
                          disabled={optimizing || committing}
                          onChange={(next) => updateSessionItem(item.sessionId, next)}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {formatPrintTime(item.printTimeSeconds)}
                    </td>
                    <td>{previewReady ? (printer?.name ?? '— Unassigned —') : '—'}</td>
                    <td className="planner-session-row-actions">
                      <button
                        type="button"
                        className="btn subtle sm"
                        disabled={optimizing || committing}
                        onClick={() => duplicateSessionItem(item.sessionId)}
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="btn subtle sm"
                        disabled={optimizing || committing}
                        onClick={() => removeSessionItem(item.sessionId)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </>
        )}
      </section>

      <section className="card queue-plan-panel">
        <h2>Optimize prints</h2>
        <p className="muted small">
          Assigns jobs to ready printers with matching material, color, and enough filament, spreading work
          across printers to finish as soon as possible. Override material or color per row, or set either to
          Any.
        </p>
        <div className="queue-plan-controls">
          <label className="queue-waste-label">
            <span className="queue-waste-label-row">
              Filament safety margin
              <InfoTooltip title="Filament safety margin">
                <FilamentSafetyMarginHelp />
              </InfoTooltip>
            </span>
            <span className="queue-percent-field">
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={safetyMarginPercent}
                disabled={optimizing || committing}
                onChange={(e) => setSafetyMarginPercent(e.target.value)}
              />
              <span className="queue-percent-suffix" aria-hidden>
                %
              </span>
            </span>
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={optimizing || committing || session.length === 0}
            onClick={() => void runOptimize()}
          >
            {optimizing ? 'Optimizing…' : 'Optimize prints'}
          </button>
          {previewReady ? (
            <button
              type="button"
              className="btn"
              disabled={committing || assignedCount === 0}
              onClick={() => void commitPlan()}
            >
              {committing ? 'Scheduling…' : `Schedule on farm (${assignedCount})`}
            </button>
          ) : null}
        </div>
      </section>

      {previewReady && assignmentSummary ? (
        <section className="card planner-assignment-summary">
          <h2>Assignment summary</h2>
          <ul className="planner-printer-summary-list">
            {assignmentSummary.map((row) => (
              <li key={row.id}>
                <strong>{row.name}</strong>
                {row.jobCount > 0 ? (
                  <span className="muted">
                    {' '}
                    — {row.jobCount} job{row.jobCount === 1 ? '' : 's'} in this plan
                  </span>
                ) : row.blockedReason ? (
                  <span className="planner-blocked-reason"> — {row.blockedReason}</span>
                ) : (
                  <span className="muted"> — not used</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {previewReady ? (
        <section className="card print-timeline-card">
          <h2>Plan preview</h2>
          <PrintTimeline lanes={lanes} clips={clips} emptyMessage="No assignments to show." />
        </section>
      ) : null}

      <MissingPrintTimeModal
        files={pendingMissingFiles}
        open={missingTimeOpen}
        onClose={() => setMissingTimeOpen(false)}
        onSaved={onMissingTimesSaved}
      />
    </div>
  )
}
