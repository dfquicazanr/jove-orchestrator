import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { FarmViewToggle } from '../components/FarmViewToggle'
import { AddPrinterCard } from '../components/AddPrinterCard'
import { PrinterConnectionModal } from '../components/PrinterConnectionModal'
import { PrinterFilamentModal } from '../components/PrinterFilamentModal'
import { FarmMaterialWarning } from '../components/FarmMaterialWarning'
import { FarmLiveDebugPanel } from '../components/FarmLiveDebugPanel'
import { PrinterFarmCard } from '../components/PrinterFarmCard'
import { FarmBulkConfirmModal, type FarmBulkConfirmState } from '../components/FarmBulkConfirmModal'
import { HaPrinterPowerOffModal } from '../components/HaPrinterPowerOffModal'
import { SendGcodeModal } from '../components/SendGcodeModal'
import { DropPrintConfirmModal } from '../components/DropPrintConfirmModal'
import {
  prepareDropPrint,
  rejectReasonBeforeDropPrint,
  type DropPrintPreview,
} from '../lib/dropPrintPrepare'
import { FARM_SUCCESS_TOAST_MS, useAutoDismiss } from '../hooks/useAutoDismiss'
import {
  usePrinterStatusStream,
  type PrinterLiveUpdate,
} from '../hooks/usePrinterStatusStream'
import { applyPrinterLiveUpdates, isPrinterMoonrakerLive } from '../lib/mergePrinterLive'
import { mergeLiveStreamMaps } from '../lib/mergeLiveStreamMaps'
import type { PrinterLiveSyncResponse } from '../lib/dropPrintWake'
import {
  controlActionNeedsMoonraker,
  isPrinterMoonrakerReachable,
} from '../lib/printerReachability'
import { loadFarmViewMode, saveFarmViewMode, type FarmViewMode } from '../lib/farmViewMode'
import { mockPrintersMode } from '../lib/mockPrintersMode'
import type { PrinterControlAction } from '../lib/printerControlActions'
import { parsePreheatPresetId } from '../lib/printerControlActions'
import { MOCK_PRINTERS, isMockPrinter } from '../mocks/mockPrinters'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { MOCK_PREHEAT_PRESETS } from '../types/materialPreheat'
import type { Printer } from '../types/printer'

type ConnectionModal = {
  type: 'connection'
  mode: 'create' | 'edit'
  printer: Printer | null
  suggestedName?: string
  highlightHaPower?: boolean
}
type FilamentModal = { type: 'filament'; printer: Printer }
type SendGcodeModalState = { type: 'sendGcode'; printer: Printer }
type ModalState = ConnectionModal | FilamentModal | SendGcodeModalState | null

type ControlBusy = { printerId: number; action: PrinterControlAction }

export function FarmPage() {
  const { me } = useAuth()
  const isManager = me?.role === 'manager'

  const [printers, setPrinters] = useState<Printer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [controlFeedback, setControlFeedback] = useState<
    Record<number, { kind: 'ok' | 'err'; text: string }>
  >({})
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<FarmViewMode>(() => loadFarmViewMode())
  const [controlBusy, setControlBusy] = useState<ControlBusy | null>(null)
  const [preheatPresets, setPreheatPresets] = useState<MaterialPreheatPreset[]>([])
  const [bulkActionsBusy, setBulkActionsBusy] = useState(false)
  const [bulkPreheatPresetId, setBulkPreheatPresetId] = useState('')
  const [bulkConfirm, setBulkConfirm] = useState<FarmBulkConfirmState | null>(null)
  /** Home Assistant mains power-off — gated behind confirmation modal. */
  const [haPowerOffConfirmPrinter, setHaPowerOffConfirmPrinter] = useState<Printer | null>(null)
  const [dropPrintPreview, setDropPrintPreview] = useState<DropPrintPreview | null>(null)
  const [dropPrintBusy, setDropPrintBusy] = useState(false)
  const useMocks = mockPrintersMode()
  const { live: liveStatus, meta: liveStreamMeta } = usePrinterStatusStream(!useMocks)
  const [livePatches, setLivePatches] = useState<Map<number, PrinterLiveUpdate>>(() => new Map())
  const mergedLive = useMemo(
    () => mergeLiveStreamMaps(liveStatus, livePatches),
    [liveStatus, livePatches],
  )
  const applyLivePatch = useCallback((live: PrinterLiveUpdate) => {
    setLivePatches((prev) => {
      const next = new Map(prev)
      next.set(live.printer_id, live)
      return next
    })
  }, [])
  const controlFeedbackTimers = useRef<Record<number, number>>({})

  useEffect(() => {
    // Drop stale poll patches once SSE has caught up for that printer.
    setLivePatches((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Map(prev)
      for (const [id, patch] of prev) {
        const sse = liveStatus.get(id)
        if (!sse) continue
        const patchTs = typeof patch.ts === 'number' ? patch.ts : null
        const sseTs = typeof sse.ts === 'number' ? sse.ts : null
        if (patchTs !== null && sseTs !== null && sseTs >= patchTs) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [liveStatus])

  const dismissActionNotice = useCallback(() => setActionNotice(null), [])

  useAutoDismiss(actionNotice, dismissActionNotice, FARM_SUCCESS_TOAST_MS)

  const clearPrinterControlFeedback = useCallback((printerId: number) => {
    const t = controlFeedbackTimers.current[printerId]
    if (t !== undefined) {
      window.clearTimeout(t)
      delete controlFeedbackTimers.current[printerId]
    }
    setControlFeedback((prev) => {
      if (!(printerId in prev)) return prev
      const next = { ...prev }
      delete next[printerId]
      return next
    })
  }, [])

  const setPrinterControlFeedback = useCallback(
    (printerId: number, feedback: { kind: 'ok' | 'err'; text: string }) => {
      const existing = controlFeedbackTimers.current[printerId]
      if (existing !== undefined) {
        window.clearTimeout(existing)
        delete controlFeedbackTimers.current[printerId]
      }

      setControlFeedback((prev) => ({ ...prev, [printerId]: feedback }))

      if (feedback.kind === 'ok') {
        controlFeedbackTimers.current[printerId] = window.setTimeout(() => {
          setControlFeedback((prev) => {
            if (prev[printerId]?.kind !== 'ok') return prev
            const next = { ...prev }
            delete next[printerId]
            return next
          })
          delete controlFeedbackTimers.current[printerId]
        }, FARM_SUCCESS_TOAST_MS)
      }
    },
    [],
  )

  useEffect(() => {
    const timers = controlFeedbackTimers.current
    return () => {
      for (const t of Object.values(timers)) {
        window.clearTimeout(t)
      }
    }
  }, [])

  const canManagePrinters = isManager && !useMocks
  const showFarmGrid = printers !== null && (printers.length > 0 || canManagePrinters)

  const loadPrinters = useCallback(async () => {
    setError(null)
    if (useMocks) {
      setPrinters(MOCK_PRINTERS)
      return
    }
    try {
      const data = await apiFetch<Printer[]>('/printers')
      setPrinters(data)
    } catch (e) {
      setPrinters(null)
      setError(e instanceof Error ? e.message : 'Failed to load printers')
    }
  }, [useMocks])

  const loadPreheatPresets = useCallback(async () => {
    if (useMocks) {
      setPreheatPresets(MOCK_PREHEAT_PRESETS)
      return
    }
    try {
      const data = await apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat')
      setPreheatPresets(data)
    } catch {
      setPreheatPresets(MOCK_PREHEAT_PRESETS)
    }
  }, [useMocks])

  useEffect(() => {
    void loadPrinters()
  }, [loadPrinters])

  /** Refresh DB when Moonraker connects; recover if SSE patches stop updating. */
  const prevLiveConnectedRef = useRef<Map<number, boolean>>(new Map())
  useEffect(() => {
    if (useMocks || !printers?.length) return
    let newlyConnected = false
    const now = Date.now() / 1000
    for (const [id, u] of mergedLive) {
      const was = prevLiveConnectedRef.current.get(id) ?? false
      if (u.connected && !was) {
        newlyConnected = true
      }
      const age = u.ts != null ? now - u.ts : Infinity
      if (u.connected && age > 25) {
        void apiFetch<PrinterLiveSyncResponse>(`/printers/${id}/live/sync`, { method: 'POST' })
          .then((sync) => {
            applyLivePatch(sync.live)
            return loadPrinters()
          })
          .catch(() => {
            /* ignore transient sync errors */
          })
      }
      prevLiveConnectedRef.current.set(id, u.connected)
    }
    if (newlyConnected) {
      void loadPrinters()
    }
  }, [mergedLive, useMocks, printers?.length, loadPrinters])

  useEffect(() => {
    void loadPreheatPresets()
  }, [loadPreheatPresets])

  useEffect(() => {
    if (preheatPresets.length === 0) {
      setBulkPreheatPresetId('')
      return
    }
    setBulkPreheatPresetId((prev) => {
      if (prev && preheatPresets.some((x) => String(x.id) === prev)) return prev
      return String(preheatPresets[0].id)
    })
  }, [preheatPresets])

  function onViewModeChange(mode: FarmViewMode) {
    setViewMode(mode)
    saveFarmViewMode(mode)
  }

  async function onSyncMoonraker(p: Printer) {
    if (!isManager) return
    if (isMockPrinter(p)) {
      setActionError('Mock printers are read-only. Remove mock mode to use Sync.')
      return
    }
    setActionError(null)
    setSyncingId(p.id)
    try {
      const sync = await apiFetch<PrinterLiveSyncResponse>(`/printers/${p.id}/live/sync`, {
        method: 'POST',
      })
      applyLivePatch(sync.live)
      await loadPrinters()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncingId(null)
    }
  }

  async function onControlAction(p: Printer, action: PrinterControlAction) {
    if (!canManagePrinters) return
    if (isMockPrinter(p)) {
      setActionError('Mock printers are read-only.')
      return
    }
    setActionError(null)
    setActionNotice(null)
    clearPrinterControlFeedback(p.id)

    if (action === 'power_off') {
      setHaPowerOffConfirmPrinter(p)
      return
    }

    const merged =
      applyPrinterLiveUpdates([p], mergedLive).find((row) => row.id === p.id) ?? p
    if (
      controlActionNeedsMoonraker(action) &&
      !isPrinterMoonrakerReachable(merged, mergedLive)
    ) {
      setActionError(
        `${p.name} is offline — use hardware power or wait for Moonraker before this command.`,
      )
      return
    }

    setControlBusy({ printerId: p.id, action })

    const base = `/printers/${p.id}`
    try {
      let res: { ok: boolean; message?: string | null }
      const preheatId = parsePreheatPresetId(action)
      if (preheatId !== null) {
        const preset = preheatPresets.find((x) => x.id === preheatId)
        if (!preset) {
          throw new Error('Preheat preset not found. Open Preheat presets… and save your materials.')
        }
        res = await apiFetch(`${base}/control/preheat`, {
          method: 'POST',
          json: { hotend_c: preset.hotend_c, bed_c: preset.bed_c },
        })
      } else switch (action) {
        case 'home':
          res = await apiFetch(`${base}/control/home`, {
            method: 'POST',
            json: { axes: 'all' },
          })
          break
        case 'home_xy':
          res = await apiFetch(`${base}/control/home`, {
            method: 'POST',
            json: { axes: 'xy' },
          })
          break
        case 'cooldown':
          res = await apiFetch(`${base}/control/cooldown`, { method: 'POST' })
          break
        case 'cancel_print':
          res = await apiFetch(`${base}/control/print/cancel`, { method: 'POST' })
          break
        case 'pause_print':
          res = await apiFetch(`${base}/control/print/pause`, { method: 'POST' })
          break
        case 'resume_print':
          res = await apiFetch(`${base}/control/print/resume`, { method: 'POST' })
          break
        case 'power_on':
          res = await apiFetch(`${base}/power/on`, { method: 'POST' })
          break
        default:
          return
      }
      const text = res.message ?? `${p.name}: command sent`
      setActionNotice(text)
      setPrinterControlFeedback(p.id, { kind: 'ok', text })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Command failed'
      const friendly =
        msg === 'Not Found'
          ? 'Control API not found — rebuild the API container (`docker compose build api && docker compose up -d api`).'
          : msg
      setActionError(friendly)
      setPrinterControlFeedback(p.id, { kind: 'err', text: friendly })
    } finally {
      setControlBusy(null)
    }
  }

  /** Used after HA power-off confirmation modal — same HTTP + feedback as power_on in onControlAction. */
  async function executeConfirmedHaPrinterPowerOff(p: Printer) {
    setActionError(null)
    setControlBusy({ printerId: p.id, action: 'power_off' })
    const base = `/printers/${p.id}`
    try {
      const res = await apiFetch<{ ok: boolean; message?: string | null }>(`${base}/power/off`, {
        method: 'POST',
      })
      const text = res.message ?? `${p.name}: mains power-off sent`
      setActionNotice(text)
      setPrinterControlFeedback(p.id, { kind: 'ok', text })
      setHaPowerOffConfirmPrinter(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Command failed'
      const friendly =
        msg === 'Not Found'
          ? 'Power API not found — rebuild the API container (`docker compose build api && docker compose up -d api`).'
          : msg
      setActionError(friendly)
      setPrinterControlFeedback(p.id, { kind: 'err', text: friendly })
    } finally {
      setControlBusy(null)
    }
  }

  function reachableMergedPrinters(): Printer[] {
    if (!printers?.length) return []
    return applyPrinterLiveUpdates(printers, mergedLive).filter((p) =>
      isPrinterMoonrakerReachable(p, mergedLive),
    )
  }

  /** Printers with a Home Assistant power entity (mains toggle), regardless of Moonraker reachability. */
  function haPowerLinkedPrinters(): Printer[] {
    if (!printers?.length) return []
    return applyPrinterLiveUpdates(printers, mergedLive).filter((p) => Boolean(p.ha_power_entity_id?.trim()))
  }

  async function runBulkHomeOnTargets(targets: Printer[]) {
    setBulkActionsBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((p) =>
          apiFetch<{ ok: boolean; message?: string | null }>(`/printers/${p.id}/control/home`, {
            method: 'POST',
            json: { axes: 'all' },
          }),
        ),
      )
      const fails: string[] = []
      let ok = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok += 1
        else {
          const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
          fails.push(`${targets[i].name}: ${reason}`)
        }
      })
      if (fails.length === 0) {
        setActionNotice(`Homing started on ${ok} printer(s).`)
      } else {
        setActionError(`Home all: ${fails.length}/${targets.length} failed — ${fails.join(' · ')}`)
        if (ok > 0) setActionNotice(`Homing started on ${ok} printer(s); ${fails.length} failed.`)
      }
    } finally {
      setBulkActionsBusy(false)
    }
  }

  async function runBulkPreheatOnTargets(targets: Printer[], preset: MaterialPreheatPreset) {
    setBulkActionsBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((p) =>
          apiFetch<{ ok: boolean; message?: string | null }>(`/printers/${p.id}/control/preheat`, {
            method: 'POST',
            json: { hotend_c: preset.hotend_c, bed_c: preset.bed_c },
          }),
        ),
      )
      const fails: string[] = []
      let ok = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok += 1
        else {
          const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
          fails.push(`${targets[i].name}: ${reason}`)
        }
      })
      if (fails.length === 0) {
        setActionNotice(`Preheat (${preset.name}) sent to ${ok} printer(s).`)
      } else {
        setActionError(`Preheat all: ${fails.length}/${targets.length} failed — ${fails.join(' · ')}`)
        if (ok > 0) setActionNotice(`Preheat (${preset.name}) sent to ${ok} printer(s); ${fails.length} failed.`)
      }
    } finally {
      setBulkActionsBusy(false)
    }
  }

  async function runBulkCooldownOnTargets(targets: Printer[]) {
    setBulkActionsBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((p) =>
          apiFetch<{ ok: boolean; message?: string | null }>(`/printers/${p.id}/control/cooldown`, {
            method: 'POST',
          }),
        ),
      )
      const fails: string[] = []
      let ok = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok += 1
        else {
          const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
          fails.push(`${targets[i].name}: ${reason}`)
        }
      })
      if (fails.length === 0) {
        setActionNotice(`Cooldown (M104 S0 · M140 S0) sent to ${ok} printer(s).`)
      } else {
        setActionError(`Cooldown all: ${fails.length}/${targets.length} failed — ${fails.join(' · ')}`)
        if (ok > 0) setActionNotice(`Cooldown sent to ${ok} printer(s); ${fails.length} failed.`)
      }
    } finally {
      setBulkActionsBusy(false)
    }
  }

  async function runBulkHaPowerOnTargets(targets: Printer[]) {
    setBulkActionsBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((p) =>
          apiFetch<{ ok: boolean; message?: string | null }>(`/printers/${p.id}/power/on`, {
            method: 'POST',
          }),
        ),
      )
      const fails: string[] = []
      let ok = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok += 1
        else {
          const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
          fails.push(`${targets[i].name}: ${reason}`)
        }
      })
      if (fails.length === 0) {
        setActionNotice(`Home Assistant turn_on sent for ${ok} printer(s).`)
      } else {
        setActionError(`Power on all: ${fails.length}/${targets.length} failed — ${fails.join(' · ')}`)
        if (ok > 0) setActionNotice(`Power on succeeded for ${ok} printer(s); ${fails.length} failed.`)
      }
    } finally {
      setBulkActionsBusy(false)
    }
  }

  async function runBulkHaPowerOffTargets(targets: Printer[]) {
    setBulkActionsBusy(true)
    try {
      const results = await Promise.allSettled(
        targets.map((p) =>
          apiFetch<{ ok: boolean; message?: string | null }>(`/printers/${p.id}/power/off`, {
            method: 'POST',
          }),
        ),
      )
      const fails: string[] = []
      let ok = 0
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok += 1
        else {
          const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
          fails.push(`${targets[i].name}: ${reason}`)
        }
      })
      if (fails.length === 0) {
        setActionNotice(`Home Assistant turn_off sent for ${ok} printer(s).`)
      } else {
        setActionError(`Power off all: ${fails.length}/${targets.length} failed — ${fails.join(' · ')}`)
        if (ok > 0) setActionNotice(`Power off succeeded for ${ok} printer(s); ${fails.length} failed.`)
      }
    } finally {
      setBulkActionsBusy(false)
    }
  }

  function requestBulkHome() {
    if (!canManagePrinters || useMocks) return
    const targets = reachableMergedPrinters()
    setActionError(null)
    setActionNotice(null)
    if (targets.length === 0) {
      setActionError('No reachable printers to home (all offline or not connected).')
      return
    }
    setBulkConfirm({ kind: 'home', targets })
  }

  function requestBulkPreheat() {
    if (!canManagePrinters || useMocks) return
    const preset = preheatPresets.find((x) => String(x.id) === bulkPreheatPresetId)
    if (!preset) {
      setActionError('Choose a preheat preset (configure under Preheat presets…).')
      return
    }
    const targets = reachableMergedPrinters()
    setActionError(null)
    setActionNotice(null)
    if (targets.length === 0) {
      setActionError('No reachable printers to preheat (all offline or not connected).')
      return
    }
    setBulkConfirm({ kind: 'preheat', targets, preset })
  }

  function requestBulkCooldown() {
    if (!canManagePrinters || useMocks) return
    const targets = reachableMergedPrinters()
    setActionError(null)
    setActionNotice(null)
    if (targets.length === 0) {
      setActionError('No reachable printers to cooldown (all offline or not connected).')
      return
    }
    setBulkConfirm({ kind: 'cooldown', targets })
  }

  function requestBulkHaPower(mode: 'on' | 'off') {
    if (!canManagePrinters || useMocks) return
    const targets = haPowerLinkedPrinters()
    setActionError(null)
    setActionNotice(null)
    if (targets.length === 0) {
      setActionError(
        'No printers have a Home Assistant power entity configured (printer Edit → Link Home Assistant power…).',
      )
      return
    }
    setBulkConfirm(mode === 'on' ? { kind: 'ha_power_on', targets } : { kind: 'ha_power_off', targets })
  }

  async function executeConfirmedBulkAction() {
    const pending = bulkConfirm
    if (!pending || !canManagePrinters || useMocks) {
      setBulkConfirm(null)
      return
    }
    setActionError(null)
    setActionNotice(null)
    try {
      if (pending.kind === 'home') {
        await runBulkHomeOnTargets(pending.targets)
      } else if (pending.kind === 'preheat') {
        await runBulkPreheatOnTargets(pending.targets, pending.preset)
      } else if (pending.kind === 'cooldown') {
        await runBulkCooldownOnTargets(pending.targets)
      } else if (pending.kind === 'ha_power_on') {
        await runBulkHaPowerOnTargets(pending.targets)
      } else {
        await runBulkHaPowerOffTargets(pending.targets)
      }
    } finally {
      setBulkConfirm(null)
    }
  }

  function openAddPrinter() {
    setModal({
      type: 'connection',
      mode: 'create',
      printer: null,
      suggestedName: `Printer ${(printers?.length ?? 0) + 1}`,
    })
  }

  async function onDelete(p: Printer) {
    if (!isManager) return
    if (isMockPrinter(p)) {
      setActionError('Mock printers are read-only. Remove mock mode to delete printers.')
      return
    }
    setActionError(null)
    try {
      await apiFetch(`/printers/${p.id}`, { method: 'DELETE' })
      await loadPrinters()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function onDropGcode(p: Printer, file: File) {
    if (!canManagePrinters) return
    if (isMockPrinter(p)) {
      setActionError('Mock printers are read-only.')
      return
    }
    const reject = rejectReasonBeforeDropPrint(p)
    if (reject) {
      setActionError(reject)
      return
    }
    setActionError(null)
    setDropPrintBusy(true)
    try {
      const preview = await prepareDropPrint(p, file, preheatPresets)
      setDropPrintPreview(preview)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not read G-code file')
    } finally {
      setDropPrintBusy(false)
    }
  }

  function onDropPrintCompleted(printerId: number, remainingFilamentGrams: number | null) {
    const name = dropPrintPreview?.printer.name ?? 'Printer'
    setPrinters((prev) => {
      if (!prev) return prev
      return prev.map((row) =>
        row.id === printerId && remainingFilamentGrams != null
          ? { ...row, remaining_filament_grams: remainingFilamentGrams }
          : row,
      )
    })
    setActionNotice(`Print started on ${name}.`)
    void loadPrinters()
    if (!useMocks) {
      void apiFetch<PrinterLiveSyncResponse>(`/printers/${printerId}/live/sync`, { method: 'POST' })
        .then((sync) => applyLivePatch(sync.live))
        .catch(() => {
          /* SSE will catch up */
        })
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-leading">
          <h1>Farm</h1>
        </div>
        <div className="page-head-toolbar">
          {canManagePrinters && printers && printers.length > 0 && !useMocks ? (
            <section
              className="farm-bulk-panel"
              aria-labelledby="farm-bulk-heading"
            >
              <div className="farm-bulk-panel-head">
                <h2 id="farm-bulk-heading" className="farm-bulk-panel-title">
                  Farm-wide
                </h2>
                <span className="farm-bulk-panel-stat muted small" aria-live="polite">
                  {reachableMergedPrinters().length} reachable · {haPowerLinkedPrinters().length} HA power
                </span>
              </div>
              <div className="farm-bulk-panel-actions">
                {reachableMergedPrinters().length > 0 ? (
                  <div
                    className="farm-bulk-moonraker-actions"
                    role="group"
                    aria-label="Bulk Moonraker commands"
                  >
                <button
                  type="button"
                  className="btn sm secondary farm-bulk-home-btn"
                  disabled={bulkActionsBusy || bulkConfirm !== null}
                  onClick={requestBulkHome}
                  title="G28 — run on each reachable printer"
                >
                  Home all
                </button>
                <button
                  type="button"
                  className="btn sm secondary farm-bulk-cooldown-btn"
                  disabled={bulkActionsBusy || bulkConfirm !== null}
                  onClick={requestBulkCooldown}
                  title="M104 S0 and M140 S0 on each reachable printer"
                >
                  Cooldown all
                </button>
                <div className="farm-bulk-preheat-row">
                  <label className="sr-only" htmlFor="farm-bulk-preset">
                    Material preset for bulk preheat
                  </label>
                  <select
                    id="farm-bulk-preset"
                    className="farm-bulk-select"
                    aria-label="Material preset"
                    disabled={(bulkActionsBusy || bulkConfirm !== null) || preheatPresets.length === 0}
                    value={bulkPreheatPresetId}
                    onChange={(e) => setBulkPreheatPresetId(e.target.value)}
                  >
                    {preheatPresets.map((pre) => (
                      <option key={pre.id} value={String(pre.id)}>
                        {pre.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn sm primary farm-bulk-preheat-btn"
                    disabled={
                      bulkActionsBusy ||
                      bulkConfirm !== null ||
                      preheatPresets.length === 0 ||
                      bulkPreheatPresetId === ''
                    }
                    onClick={requestBulkPreheat}
                  >
                    Preheat all
                  </button>
                </div>
                  </div>
                ) : null}
                {reachableMergedPrinters().length > 0 && haPowerLinkedPrinters().length > 0 ? (
                  <div className="farm-bulk-actions-divider" aria-hidden />
                ) : null}
                {haPowerLinkedPrinters().length > 0 ? (
                <div className="farm-bulk-ha-power-row" role="group" aria-label="Hardware power via Home Assistant">
                  <button
                    type="button"
                    className="btn sm secondary farm-bulk-ha-power-on-btn"
                    disabled={bulkActionsBusy || bulkConfirm !== null}
                    onClick={() => requestBulkHaPower('on')}
                    title="Home Assistant turn_on on each printer’s linked entity"
                  >
                    Power on all
                  </button>
                  <button
                    type="button"
                    className="btn sm danger farm-bulk-ha-power-off-btn"
                    disabled={bulkActionsBusy || bulkConfirm !== null}
                    onClick={() => requestBulkHaPower('off')}
                    title="Requires confirmation — turn_off mains-style entities"
                  >
                    Power off all
                  </button>
                </div>
                ) : null}
              </div>
            </section>
          ) : null}
          <div className="page-head-toolbar-tail">
            {showFarmGrid ? (
              <FarmViewToggle mode={viewMode} onChange={onViewModeChange} />
            ) : null}
          </div>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {dropPrintBusy ? (
        <p className="muted small" role="status">
          Reading G-code file…
        </p>
      ) : null}
      {actionError ? <p className="error">{actionError}</p> : null}
      {actionNotice ? (
        <p className="success subtle farm-action-notice" role="status" aria-live="polite">
          {actionNotice}
        </p>
      ) : null}

      {printers && printers.length > 0 ? (
        <FarmMaterialWarning
          printers={applyPrinterLiveUpdates(printers, mergedLive)}
          showPlannerHint={isManager}
        />
      ) : null}

      {viewMode === 'advanced' && !canManagePrinters ? (
        <p className="muted small">
          Controls require a manager account and a live API connection. Viewers see the same cards without
          action buttons.
        </p>
      ) : null}

      {useMocks ? (
        <p className="muted small" role="status">
          Showing <strong>mock printers</strong> (all statuses + filament spirals). Remove{' '}
          <code className="inline-code">?mockPrinters=1</code> from the URL or unset{' '}
          <code className="inline-code">VITE_MOCK_PRINTERS</code> to use the real API. Sync, delete,
          editing these cards, sending G-code, and printer controls are disabled.
        </p>
      ) : null}

      {!isManager ? (
        <p className="muted">You are signed in as a viewer. Printer changes require a manager account.</p>
      ) : null}

      {printers && !useMocks ? (
        <FarmLiveDebugPanel dbPrinters={printers} live={mergedLive} meta={liveStreamMeta} />
      ) : null}

      {!printers ? <p>Loading…</p> : null}

      {printers && printers.length === 0 && !canManagePrinters ? (
        <p className="muted">No printers configured yet.</p>
      ) : null}

      {showFarmGrid ? (
        <div
          className={`grid farm-printer-grid${viewMode === 'advanced' ? ' farm-printer-grid-advanced' : ''}`}
        >
          {canManagePrinters ? <AddPrinterCard onClick={openAddPrinter} /> : null}
          {applyPrinterLiveUpdates(printers, mergedLive).map((p) => (
            <PrinterFarmCard
              key={p.id}
              printer={p}
              viewMode={viewMode}
              preheatPresets={preheatPresets}
              moonrakerLive={isPrinterMoonrakerLive(p, mergedLive)}
              moonrakerReachable={isPrinterMoonrakerReachable(p, mergedLive)}
              isManager={canManagePrinters}
              syncing={syncingId === p.id}
              controlsDisabled={!canManagePrinters}
              controlBusyAction={
                controlBusy?.printerId === p.id ? controlBusy.action : null
              }
              controlFeedback={controlFeedback[p.id] ?? null}
              onControlAction={(x, action) => void onControlAction(x, action)}
              onEditConnection={(x) => {
                if (isMockPrinter(x)) {
                  setActionError('Mock printers are read-only.')
                  return
                }
                setModal({ type: 'connection', mode: 'edit', printer: x })
              }}
              onEditHaPower={(x) => {
                if (isMockPrinter(x)) {
                  setActionError('Mock printers are read-only.')
                  return
                }
                setModal({ type: 'connection', mode: 'edit', printer: x, highlightHaPower: true })
              }}
              onEditFilament={(x) => {
                if (isMockPrinter(x)) {
                  setActionError('Mock printers are read-only.')
                  return
                }
                setModal({ type: 'filament', printer: x })
              }}
              onSendGcode={(x) => {
                if (isMockPrinter(x)) {
                  setActionError('Mock printers are read-only.')
                  return
                }
                setModal({ type: 'sendGcode', printer: x })
              }}
              onDropGcode={canManagePrinters ? (x, file) => void onDropGcode(x, file) : undefined}
              onSync={(x) => void onSyncMoonraker(x)}
              onDelete={(x) => void onDelete(x)}
            />
          ))}
        </div>
      ) : null}

      {modal?.type === 'connection' ? (
        <PrinterConnectionModal
          open
          mode={modal.mode}
          printer={modal.printer}
          highlightHaPower={modal.mode === 'edit' && Boolean(modal.highlightHaPower)}
          suggestedName={modal.mode === 'create' ? modal.suggestedName : undefined}
          onClose={() => setModal(null)}
          onSaved={() => void loadPrinters()}
          onCreatedContinue={
            modal.mode === 'create'
              ? (created) => {
                  setModal({ type: 'filament', printer: created })
                }
              : undefined
          }
        />
      ) : null}

      {modal?.type === 'filament' ? (
        <PrinterFilamentModal
          open
          printer={modal.printer}
          onClose={() => setModal(null)}
          onSaved={() => void loadPrinters()}
        />
      ) : null}

      {modal?.type === 'sendGcode' ? (
        <SendGcodeModal open printer={modal.printer} onClose={() => setModal(null)} />
      ) : null}

      {dropPrintPreview ? (
        <DropPrintConfirmModal
          preview={dropPrintPreview}
          onClose={() => setDropPrintPreview(null)}
          onPrinted={onDropPrintCompleted}
          onFarmRefresh={() => void loadPrinters()}
          onLivePatch={applyLivePatch}
        />
      ) : null}

      <HaPrinterPowerOffModal
        printer={haPowerOffConfirmPrinter}
        busy={controlBusy?.action === 'power_off'}
        onClose={() => {
          if (controlBusy?.action === 'power_off') return
          setHaPowerOffConfirmPrinter(null)
        }}
        onConfirm={(p) => void executeConfirmedHaPrinterPowerOff(p)}
      />

      <FarmBulkConfirmModal
        state={bulkConfirm}
        busy={bulkActionsBusy}
        onClose={() => {
          if (!bulkActionsBusy) setBulkConfirm(null)
        }}
        onConfirm={() => void executeConfirmedBulkAction()}
      />
    </div>
  )
}
