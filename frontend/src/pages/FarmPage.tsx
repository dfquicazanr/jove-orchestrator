import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { FarmViewToggle } from '../components/FarmViewToggle'
import { AddPrinterCard } from '../components/AddPrinterCard'
import { PrinterConnectionModal } from '../components/PrinterConnectionModal'
import { PrinterFilamentModal } from '../components/PrinterFilamentModal'
import { MaterialPreheatSettingsModal } from '../components/MaterialPreheatSettingsModal'
import { PrinterFarmCard } from '../components/PrinterFarmCard'
import { FarmBulkConfirmModal, type FarmBulkConfirmState } from '../components/FarmBulkConfirmModal'
import { SendGcodeModal } from '../components/SendGcodeModal'
import { usePrinterStatusStream, type PrinterLiveUpdate } from '../hooks/usePrinterStatusStream'
import { applyPrinterLiveUpdates } from '../lib/mergePrinterLive'
import { loadFarmViewMode, saveFarmViewMode, type FarmViewMode } from '../lib/farmViewMode'
import { mockPrintersMode } from '../lib/mockPrintersMode'
import type { PrinterControlAction } from '../lib/printerControlActions'
import { parsePreheatPresetId } from '../lib/printerControlActions'
import { MOCK_PRINTERS, isMockPrinter } from '../mocks/mockPrinters'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { MOCK_PREHEAT_PRESETS } from '../types/materialPreheat'
import type { Printer } from '../types/printer'

/** Moonraker looks reachable: live stream says connected, or no live row and status is not clearly down. */
function isPrinterReachableForBulk(p: Printer, live: Map<number, PrinterLiveUpdate>): boolean {
  const u = live.get(p.id)
  if (u?.connected === true) return true
  if (u?.connected === false) return false
  const s = p.last_known_status
  return s !== 'offline' && s !== 'powered_off'
}

type ConnectionModal = {
  type: 'connection'
  mode: 'create' | 'edit'
  printer: Printer | null
  suggestedName?: string
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
  const [preheatSettingsOpen, setPreheatSettingsOpen] = useState(false)
  const [bulkActionsBusy, setBulkActionsBusy] = useState(false)
  const [bulkPreheatPresetId, setBulkPreheatPresetId] = useState('')
  const [bulkConfirm, setBulkConfirm] = useState<FarmBulkConfirmState | null>(null)
  const useMocks = mockPrintersMode()
  const liveStatus = usePrinterStatusStream(!useMocks)

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
      await apiFetch<{ ok: boolean; message?: string | null }>(`/printers/${p.id}/moonraker/ping`, {
        method: 'POST',
      })
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
    setControlFeedback((prev) => {
      const next = { ...prev }
      delete next[p.id]
      return next
    })
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
        case 'power_off':
          res = await apiFetch(`${base}/power/off`, { method: 'POST' })
          break
        default:
          return
      }
      const text = res.message ?? `${p.name}: command sent`
      setActionNotice(text)
      setControlFeedback((prev) => ({ ...prev, [p.id]: { kind: 'ok', text } }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Command failed'
      const friendly =
        msg === 'Not Found'
          ? 'Control API not found — rebuild the API container (`docker compose build api && docker compose up -d api`).'
          : msg
      setActionError(friendly)
      setControlFeedback((prev) => ({ ...prev, [p.id]: { kind: 'err', text: friendly } }))
    } finally {
      setControlBusy(null)
    }
  }

  function reachableMergedPrinters(): Printer[] {
    if (!printers?.length) return []
    return applyPrinterLiveUpdates(printers, liveStatus).filter((p) =>
      isPrinterReachableForBulk(p, liveStatus),
    )
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
      } else {
        await runBulkCooldownOnTargets(pending.targets)
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
                  {reachableMergedPrinters().length} reachable
                </span>
              </div>
              <div className="farm-bulk-panel-actions" role="group" aria-label="Bulk Moonraker commands">
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
            </section>
          ) : null}
          <div className="page-head-toolbar-tail">
            {showFarmGrid && viewMode === 'advanced' && canManagePrinters ? (
              <button
                type="button"
                className="btn sm ghost farm-preset-setup-btn"
                onClick={() => setPreheatSettingsOpen(true)}
              >
                Preheat presets…
              </button>
            ) : null}
            {showFarmGrid ? (
              <FarmViewToggle mode={viewMode} onChange={onViewModeChange} />
            ) : null}
          </div>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}
      {actionNotice ? <p className="success subtle">{actionNotice}</p> : null}

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

      {!printers ? <p>Loading…</p> : null}

      {printers && printers.length === 0 && !canManagePrinters ? (
        <p className="muted">No printers configured yet.</p>
      ) : null}

      {showFarmGrid ? (
        <div
          className={`grid farm-printer-grid${viewMode === 'advanced' ? ' farm-printer-grid-advanced' : ''}`}
        >
          {canManagePrinters ? <AddPrinterCard onClick={openAddPrinter} /> : null}
          {applyPrinterLiveUpdates(printers, liveStatus).map((p) => (
            <PrinterFarmCard
              key={p.id}
              printer={p}
              viewMode={viewMode}
              preheatPresets={preheatPresets}
              moonrakerLive={liveStatus.get(p.id)?.connected}
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

      {preheatSettingsOpen ? (
        <MaterialPreheatSettingsModal
          open
          onClose={() => setPreheatSettingsOpen(false)}
          onSaved={(presets) => setPreheatPresets(presets)}
        />
      ) : null}

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
